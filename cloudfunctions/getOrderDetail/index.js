/**
 * 云函数：getOrderDetail —— 订单详情（REQ-036、REQ-031）
 * 入参：event.payload = { orderId }
 * 出参：{ code: 0, data: { order, quote, actions, expiredQuote } } / 9002 无权查看该订单
 * actions 按状态计算：pending_payment→[pay,cancel,contact] pending_quote→[cancel,contact]
 *   making→[contact] completed→[contact,rebuy] cancelled→[rebuy]
 * 隐私：客户侧手机号一律脱敏（contactPhone 与 address.phone，C-PII@1）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const orders = db.collection('orders');
const quotes = db.collection('quotes');
const users = db.collection('users');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

/**
 * 手机号脱敏：173****3179
 * 口径与 login / getPhoneNumber 云函数、utils/format.js#maskPhone 保持一致（C-PII@1），不得另立规则。
 */
function maskPhone(phone) {
  const s = String(phone || '');
  if (/^\d{11}$/.test(s)) return s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-4);
  return s ? '****' : '';
}

/**
 * 订单隐私字段脱敏（C-PII@1）
 * - 非商家（客户）一律脱敏 order.contactPhone 与 order.address.phone；
 * - 商家（users.role==='merchant'）保持明文；
 * - 全程浅拷贝，避免污染查询结果对象。
 */
function maskOrderPii(order, isMerchant) {
  const item = Object.assign({}, order);
  if (isMerchant) return item;
  if (item.contactPhone) item.contactPhone = maskPhone(item.contactPhone);
  if (item.address && typeof item.address === 'object') {
    item.address = Object.assign({}, item.address);
    if (item.address.phone) item.address.phone = maskPhone(item.address.phone);
  }
  return item;
}

function computeActions(order, quote) {
  const s = order.status;
  const actions = [];
  if (s === 'pending_payment') actions.push('pay', 'cancel', 'contact');
  else if (s === 'pending_quote') actions.push('cancel', 'contact');
  else if (s === 'making') actions.push('contact');
  else if (s === 'completed') actions.push('contact', 'rebuy');
  else if (s === 'cancelled') actions.push('rebuy');

  let expiredQuote = false;
  if (order.type === 'custom' && quote && quote.validUntil) {
    if (Date.now() > Number(quote.validUntil)) {
      const idx = actions.indexOf('pay');
      if (idx !== -1) actions.splice(idx, 1);
      expiredQuote = true;
    }
  }
  return { actions, expiredQuote };
}

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail(9002, '无权查看该订单');

    const payload = (event && event.payload) || {};
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';
    if (!orderId) return fail(9002, '无权查看该订单');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) return fail(9002, '无权查看该订单');

    // 归属校验
    let isMerchant = false;
    if (order.openid !== openid) {
      try {
        const uRes = await users.where({ openid }).limit(1).get();
        const u = uRes.data && uRes.data[0];
        isMerchant = !!(u && u.role === 'merchant');
      } catch (e) { /* ignore */ }
      if (!isMerchant) return fail(9002, '无权查看该订单');
    }

    // 最新 active 报价
    let quote = order.quote || null;
    try {
      const qRes = await quotes
        .where({ orderId: order._id, status: 'active' })
        .orderBy('createdAt', 'desc')
        .limit(1)
        .get();
      if (qRes.data && qRes.data[0]) quote = qRes.data[0];
    } catch (e) { /* quotes 集合可能不存在 */ }

    const { actions, expiredQuote } = computeActions(order, quote);

    // 隐私脱敏：客户一律脱敏 contactPhone 与 address.phone；商家保持明文（C-PII@1）
    const detail = maskOrderPii(order, isMerchant);

    return ok({ order: detail, quote, actions, expiredQuote });
  } catch (err) {
    console.error('[getOrderDetail] error', err);
    return fail(9002, '无权查看该订单');
  }
};