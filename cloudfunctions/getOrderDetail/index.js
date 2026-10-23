/**
 * 云函数：getOrderDetail —— 订单详情（REQ-036、REQ-031）
 * 入参：event.payload = { orderId }
 * 出参：{ code: 0, data: { order, quote, actions, expiredQuote } } / 9002 无权查看该订单
 * actions 按状态计算：pending_payment→[pay,cancel,contact] pending_quote→[cancel,contact]
 *   making→[contact] completed→[contact,rebuy] cancelled→[rebuy]
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const orders = db.collection('orders');
const quotes = db.collection('quotes');
const users = db.collection('users');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function maskPhone(phone) {
  if (typeof phone !== 'string') return '';
  const d = phone.replace(/\D/g, '');
  if (d.length !== 11) return phone ? phone.slice(0, 3) + '****' : '';
  return d.slice(0, 3) + '****' + d.slice(7);
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

    const detail = Object.assign({}, order);
    if (!isMerchant && detail.contactPhone) detail.contactPhone = maskPhone(detail.contactPhone);

    return ok({ order: detail, quote, actions, expiredQuote });
  } catch (err) {
    console.error('[getOrderDetail] error', err);
    return fail(9002, '无权查看该订单');
  }
};