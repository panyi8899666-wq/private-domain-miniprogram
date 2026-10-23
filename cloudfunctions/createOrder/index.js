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
 *       5003 下单失败，请重试 / 5004 规格不可生产，请走定制
 *
 * 安全要点：
 *   1) openid 仅取 cloud.getWXContext().OPENID，忽略前端传入；
 *   2) 金额一律服务端核算（规格单价 × 数量 + 运费），忽略前端金额；
 *   3) clientRequestId 幂等键，重复提交只生成一笔订单。
 */
const cloud = require('wx-server-sdk');

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

function resolveContactPhone(input, fallback) {
  const p = safeString(input, 20);
  if (/^\d{6,15}$/.test(p)) return p;
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
  if (!/^\d{6,15}$/.test(addr.phone)) return null;
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
      privacyAgreed: payload.privacyAgreed === true,
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

    console.log('[createOrder] ok orderNo=%s amount=%s qty=%d', orderNo, amount, quantity);
    return ok({ orderId: added._id, orderNo, amount });
  } catch (err) {
    console.error('[createOrder] error', err);
    return fail(5003, '下单失败，请重试');
  }
};