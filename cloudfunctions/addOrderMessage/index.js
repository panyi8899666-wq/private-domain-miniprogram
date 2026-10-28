/**
 * 云函数：addOrderMessage —— 客户在订单详情里给对接设计师留言
 *
 * 入参：event.payload = { orderId, text }
 * 安全：openid 取云开发上下文；仅订单本人或商家（users.role==='merchant'）
 *       可留言；留言最长 500 字；留言只追加，不改订单状态与金额。
 * 出参：{ code: 0, data: { at }, message: 'ok' }
 * 失败：9002 无权操作，6001 留言不合法。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const orders = db.collection('orders');
const users = db.collection('users');
const orderLogs = db.collection('order_logs');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) return fail(9002, '无权操作');

    const payload = (event && event.payload) || {};
    const orderId = safeString(payload.orderId, 64);
    const text = safeString(payload.text, 500);
    if (!orderId || !text) return fail(6001, '留言不合法');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) return fail(9002, '无权操作');

    let isMerchant = false;
    if (order.openid !== openid) {
      try {
        const uRes = await users.where({ openid }).limit(1).get();
        const u = uRes.data && uRes.data[0];
        isMerchant = !!(u && u.role === 'merchant');
      } catch (e) { /* ignore */ }
      if (!isMerchant) return fail(9002, '无权操作');
    }

    const now = Date.now();
    const messages = Array.isArray(order.clientMessages) ? order.clientMessages : [];
    messages.push({ from: 'customer', text, at: now, designerSeenAt: null });

    await orders.doc(orderId).update({
      data: { clientMessages: messages.slice(-50), updatedAt: now }
    });
    try {
      await orderLogs.add({
        data: {
          orderNo: order.orderNo || '',
          action: 'customer_message',
          from: order.status || '',
          to: order.status || '',
          source: 'customer',
          detail: {},
          createdAt: now
        }
      });
    } catch (e) { /* ignore */ }

    return ok({ at: now });
  } catch (err) {
    console.error('[addOrderMessage] error', err);
    return fail(9002, '无权操作');
  }
};
