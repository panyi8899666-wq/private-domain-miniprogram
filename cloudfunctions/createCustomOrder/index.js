/**
 * 云函数：createCustomOrder —— 定制需求提交（生成「待报价」订单）
 * 需求锚点：REQ-027~029、REQ-043、REQ-053
 *
 * 入参：event.payload = {
 *   materialType, size?, quantity, installPosition?, requirement?,
 *   contactPhone?, referenceFileIds?: string[], clientRequestId, privacyAgreed?
 * }
 * 出参：{ code: 0, data: { orderId, orderNo }, message: 'ok' }
 * 失败：{ code: 6001, data: null, message: '请填写必填项' }
 *       { code: 6002, data: null, message: '提交失败，请重试' }
 *
 * 安全要点：openid 仅取云开发上下文；clientRequestId 幂等防重复提交。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const orders = db.collection('orders');
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

function normalizeQuantity(value) {
  const n = parseInt(value, 10);
  if (isNaN(n) || n < 1 || n > 9999) return 0;
  return n;
}

/** 归一化参考图 fileID 列表（仅接受云存储 fileID，最多 9 张） */
function normalizeFileIds(input) {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v) => typeof v === 'string' && v.indexOf('cloud://') === 0)
    .slice(0, 9);
}

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
    if (!openid) return fail(6002, '提交失败，请重试');

    const payload = (event && event.payload) || {};
    const materialType = safeString(payload.materialType, 40);
    const quantity = normalizeQuantity(payload.quantity);
    const clientRequestId = safeString(payload.clientRequestId, 64);

    // 必填校验（REQ-027：物料类型、数量必填）
    if (!materialType || !quantity || !clientRequestId) {
      return fail(6001, '请填写必填项');
    }

    // 幂等：同一 clientRequestId 重复提交复用已有订单
    const dup = await orders.where({ openid, clientRequestId }).limit(1).get();
    if (dup.data && dup.data.length) {
      const exist = dup.data[0];
      return ok({ orderId: exist._id, orderNo: exist.orderNo, duplicated: true });
    }

    // 结构化材质配置（来自物料配置器），兼容旧的自由文本模式
    const spec = payload.spec && typeof payload.spec === 'object' ? {
      thickness: safeString(payload.spec.thickness, 40),
      size: safeString(payload.spec.size, 80),
      color: safeString(payload.spec.color, 40)
    } : null;

    const requirement = {
      materialType,
      category: safeString(payload.category, 40),
      categoryName: safeString(payload.categoryName, 40),
      materialName: safeString(payload.materialName, 60),
      materialCode: safeString(payload.materialCode, 60),
      spec,
      crafts: Array.isArray(payload.crafts)
        ? payload.crafts.slice(0, 20).map((c) => safeString(c, 40)).filter(Boolean)
        : [],
      size: safeString(payload.size, 100),
      sizeDesc: safeString(payload.sizeDesc, 100),
      area: Number(payload.area) > 0 ? Number(payload.area) : null,
      quantity,
      installPosition: safeString(payload.installPosition, 100),
      requirement: safeString(payload.requirement || payload.remark, 500),
      referenceFileIds: normalizeFileIds(payload.referenceFileIds)
    };

    const contactPhone = safeString(payload.contactPhone, 20);
    const orderNo = genOrderNo('D');

    const orderDoc = {
      orderNo,
      type: 'custom',
      openid,
      amount: 0,
      status: 'pending_quote',
      items: [],
      customRequirement: requirement,
      contactPhone: /^\d{6,15}$/.test(contactPhone) ? contactPhone : '',
      clientRequestId,
      privacyAgreed: payload.privacyAgreed === true,
      // 对接设计师：新订单默认由 Muse 对接；留言与回复走 musePoll / museReply 桥
      designer: { name: 'Muse', role: '对接设计师' },
      designerReplies: [],
      clientMessages: [],
      designerAckAt: null,
      payments: [],
      timeline: [{ status: 'pending_quote', at: now, source: 'customer' }],
      createdAt: now,
      updatedAt: now
    };

    const added = await orders.add({ data: orderDoc });
    await writeLog(orderNo, 'create', '', 'pending_quote', 'customer', {
      type: 'custom',
      materialType,
      quantity
    });

    console.log('[createCustomOrder] ok orderNo=%s materialType=%s', orderNo, materialType);
    return ok({ orderId: added._id, orderNo });
  } catch (err) {
    console.error('[createCustomOrder] error', err);
    return fail(6002, '提交失败，请重试');
  }
};