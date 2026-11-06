/**
 * 云函数：createOrder —— 标准品下单（服务端核算金额）
 * 需求锚点：REQ-023~026、REQ-054、DFX §4.2.1/§4.3.1
 *
 * 入参：event.payload = {
 *   productId, specId, quantity,
 *   addressId | address: { name, phone, detail },
 *   contactPhone?, clientRequestId, privacyAgreed?
 * }
 * 出参：{ code: 0, data: { orderId, orderNo, amount }, message: 'ok' }
 * 失败：5001 商品已更新，请重新选择 / 5002 收货信息不完整 /
 *       5003 下单失败，请重试 / 5004 规格不可生产，请走定制 /
 *       5005 请先同意隐私政策
 *
 * 安全要点：
 *   1) openid 仅取 cloud.getWXContext().OPENID，忽略前端传入；
 *   2) 金额一律服务端核算（规格单价 × 数量 + 运费），忽略前端金额；
 *   3) clientRequestId 幂等键，重复提交只生成一笔订单。
 */
const cloud = require('wx-server-sdk');
const rules = require('./rules');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const products = db.collection('products');
const users = db.collection('users');
const orderLogs = db.collection('order_logs');

function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

function fail(code, message) {
  return { code, data: null, message };
}

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

/** 元 → 分（整数运算，避免浮点误差） */
function toFen(yuan) {
  return Math.round(Number(yuan) * 100);
}

/** 分 → 元 */
function fromFen(fen) {
  return Math.round(fen) / 100;
}

function normalizeQuantity(value) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 9999) return 0;
  return n;
}

/** 运费核算（分）：包邮 / 满额包邮 / 固定运费（REQ-026） */
function calcShippingFen(shipping, goodsFen) {
  if (!shipping || typeof shipping !== 'object') return 0;
  if (shipping.freeShipping === true) return 0;
  const threshold = Number(shipping.freeThreshold);
  if (!isNaN(threshold) && threshold > 0 && fromFen(goodsFen) >= threshold) return 0;
  const fee = Number(shipping.fee);
  return !isNaN(fee) && fee > 0 ? toFen(fee) : 0;
}

/** 生成订单编号：前缀 + yyyyMMddHHmmss + 3 位随机 */
function genOrderNo(prefix) {
  const d = new Date();
  const pad = (n, l) => String(n).padStart(l, '0');
  const ts =
    '' +
    d.getFullYear() +
    pad(d.getMonth() + 1, 2) +
    pad(d.getDate(), 2) +
    pad(d.getHours(), 2) +
    pad(d.getMinutes(), 2) +
    pad(d.getSeconds(), 2);
  return prefix + ts + pad(Math.floor(Math.random() * 1000), 3);
}

/**
 * 联系方式归一：仅接受中国大陆 11 位手机号（^1[3-9]\d{9}$），
 * 口径与 saveAddresses / address-picker / addresses 页完全一致（C-VALIDATE@1）。
 * 入参不合法时回退到已通过校验的收货手机号。
 */
function resolveContactPhone(input, fallback) {
  const p = safeString(input, 20);
  if (/^1[3-9]\d{9}$/.test(p)) return p;
  return fallback || '';
}

/** 兼容 _id / code 查询商品 */
async function findProduct(productId) {
  const res = await products
    .where(_.or([{ _id: productId }, { code: productId }]))
    .limit(1)
    .get();
  return (res.data && res.data[0]) || null;
}

/** 解析收货信息：优先取 payload.address，其次按 addressId 从 users.addresses 取 */
async function resolveAddress(openid, payload) {
  let addr = null;
  if (payload.address && typeof payload.address === 'object') {
    addr = {
      name: safeString(payload.address.name, 30),
      phone: safeString(payload.address.phone, 20),
      detail: safeString(payload.address.detail, 200)
    };
  } else if (payload.addressId) {
    const res = await users.where({ openid }).limit(1).get();
    const user = res.data && res.data[0];
    const list = user && Array.isArray(user.addresses) ? user.addresses : [];
    const found = list.find((a) => a && a.addressId === payload.addressId);
    if (found) {
      addr = {
        name: safeString(found.name, 30),
        phone: safeString(found.phone, 20),
        detail: safeString(found.detail, 200)
      };
    }
  }
  if (!addr || !addr.name || !addr.phone || !addr.detail) return null;
  // 收货手机号统一采用中国大陆 11 位手机号口径（与地址保存一致，收敛原 ^\d{6,15}$）
  if (!/^1[3-9]\d{9}$/.test(addr.phone)) return null;
  return addr;
}

/** 写审计日志（失败不影响主流程） */
async function writeLog(orderNo, action, from, to, source, detail) {
  try {
    await orderLogs.add({
      data: {
        orderNo,
        action,
        from: from || '',
        to: to || '',
        source,
        detail: detail || {},
        createdAt: Date.now()
      }
    });
  } catch (err) {
    console.error('[order_logs] 写入失败', err);
  }
}

exports.main = async (event) => {
  const now = Date.now();
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) return fail(5003, '下单失败，请重试');

    const payload = (event && event.payload) || {};
    const productId = safeString(payload.productId, 64);
    const specId = safeString(payload.specId, 64);
    const clientRequestId = safeString(payload.clientRequestId, 64);
    if (!productId || !specId || !clientRequestId) {
      return fail(5001, '商品已更新，请重新选择');
    }

    // 幂等：同一 clientRequestId 重复提交直接复用已有订单
    const dup = await orders.where({ openid, clientRequestId }).limit(1).get();
    if (dup.data && dup.data.length) {
      const exist = dup.data[0];
      return ok({ orderId: exist._id, orderNo: exist.orderNo, amount: exist.amount, duplicated: true });
    }

    const consentUser = await users.where({ openid }).limit(1).get();
    const consent = consentUser.data && consentUser.data[0];
    if (!rules.hasActiveConsent(consent)) {
      return fail(5005, '请先同意隐私政策');
    }

    const quantity = normalizeQuantity(payload.quantity);
    if (!quantity) return fail(5001, '商品已更新，请重新选择');

    const product = await findProduct(productId);
    if (!product || product.status !== 'on') {
      return fail(5001, '商品已更新，请重新选择');
    }

    const specs = Array.isArray(product.specs) ? product.specs : [];
    const spec = specs.find((s) => s && s.specId === specId);
    if (!spec) return fail(5001, '商品已更新，请重新选择');

    const unitPrice = Number(spec.price);
    if (isNaN(unitPrice) || unitPrice < 0) return fail(5001, '商品已更新，请重新选择');

    const stockLimit = Number(spec.stockLimit);
    if (!isNaN(stockLimit) && stockLimit > 0 && quantity > stockLimit) {
      return fail(5004, '规格不可生产，请走定制');
    }

    const address = await resolveAddress(openid, payload);
    if (!address) return fail(5002, '收货信息不完整');

    // —— 金额服务端核算：金额 = 规格单价 × 数量 + 运费（忽略前端金额）——
    const unitPriceFen = toFen(unitPrice);
    const goodsFen = unitPriceFen * quantity;
    const shippingFen = calcShippingFen(product.shipping, goodsFen);
    const amountFen = goodsFen + shippingFen;
    if (amountFen <= 0) return fail(5001, '商品已更新，请重新选择');
    const amount = fromFen(amountFen);

    const contactPhone = resolveContactPhone(payload.contactPhone, address.phone);
    const orderNo = genOrderNo('S');

    const orderDoc = {
      orderNo,
      type: 'standard',
      openid,
      amount,
      amountFen,
      shippingFee: fromFen(shippingFen),
      status: 'pending_payment',
      items: [
        {
          productId: product._id,
          code: product.code || '',
          name: product.name || '',
          specId: spec.specId,
          specName: spec.name || '',
          unitPrice,
          quantity
        }
      ],
      address,
      contactPhone,
      clientRequestId,
      privacyAgreed: true,
      privacyConsentVersion: consent.privacyConsentVersion || rules.PRIVACY_POLICY_VERSION,
      privacyAgreedAt: consent.privacyAgreedAt || 0,
      // 对接设计师：新订单默认由 Muse 对接；留言与回复走 musePoll / museReply 桥
      designer: { name: 'Muse', role: '对接设计师' },
      designerReplies: [],
      clientMessages: [],
      designerAckAt: null,
      payments: [],
      timeline: [{ status: 'pending_payment', at: now, source: 'customer' }],
      createdAt: now,
      updatedAt: now
    };

    const added = await orders.add({ data: orderDoc });
    await writeLog(orderNo, 'create', '', 'pending_payment', 'customer', {
      type: 'standard',
      amount
    });

    // 幂等并发兜底（C-VALIDATE@1）：写入后回查一次，若并发首次提交产生了重复
    // 订单，则以「该 (openid, clientRequestId) 下最小 _id」为权威记录返回，并
    // 清理多余重复记录。所有并发请求选取权威的准则一致，故不会互相删除权威记录，
    // 最终保证同一幂等键始终复用同一笔订单。建议为 orders 建 (openid,
    // clientRequestId) 复合唯一索引作最终兜底（计划 O5，运维侧）。
    const recheck = await orders
      .where({ openid, clientRequestId })
      .orderBy('_id', 'asc')
      .limit(20)
      .get();
    const rows = (recheck && recheck.data) || [];
    if (rows.length) {
      const canonical = rows[0];
      if (rows.length > 1) {
        const dupOrderNos = rows.slice(1).map((r) => r.orderNo).filter(Boolean);
        try {
          await orders
            .where({ openid, clientRequestId, _id: _.gt(canonical._id) })
            .remove();
        } catch (cleanupErr) {
          console.warn('[createOrder] 清理并发重复订单失败', cleanupErr);
        }
        // 尽力清理重复订单遗留的建单日志（失败不影响主流程）
        for (let i = 0; i < dupOrderNos.length; i++) {
          try {
            await orderLogs.where({ orderNo: dupOrderNos[i], action: 'create' }).remove();
          } catch (logErr) {
            console.warn('[createOrder] 清理重复订单日志失败', logErr);
          }
        }
        console.log('[createOrder] 命中幂等复用 orderNo=%s', canonical.orderNo);
        return ok({
          orderId: canonical._id,
          orderNo: canonical.orderNo,
          amount: canonical.amount,
          duplicated: true
        });
      }
    }

    console.log('[createOrder] ok orderNo=%s amount=%s qty=%d', orderNo, amount, quantity);
    return ok({ orderId: added._id, orderNo, amount });
  } catch (err) {
    console.error('[createOrder] error', err);
    return fail(5003, '下单失败，请重试');
  }
};