/**
 * 云函数：submitQuote —— 商家报价 / 拒绝报价（REQ-030、REQ-032、REQ-046）
 * 入参：event.payload = { orderId, action: 'quote'|'reject', amount?, description?, validUntil?, rejectReason? }
 * 出参：{ code, data, message }
 * 错误码：7001 无权限 / 7002 金额必须为正数 / 7003 报价失败，请重试
 * 安全：openid 仅取 cloud.getWXContext().OPENID；商家操作校验 users.role==='merchant'
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const quotes = db.collection('quotes');
const users = db.collection('users');
const orderLogs = db.collection('order_logs');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

async function getUserRole(openid) {
  const res = await users.where({ openid }).limit(1).get();
  const user = res.data && res.data[0];
  return user ? user.role || 'customer' : 'customer';
}

async function findOrder(orderId) {
  const res = await orders.where({ _id: orderId }).limit(1).get();
  return (res.data && res.data[0]) || null;
}

async function writeLog(orderNo, action, from, to, source, detail) {
  await orderLogs.add({
    data: { orderNo, action, from, to, source, detail: detail || {}, createdAt: Date.now() }
  });
}

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail(7001, '无权限');

    const payload = (event && event.payload) || {};
    const orderId = safeString(payload.orderId, 64);
    const action = payload.action;
    if (!orderId || (action !== 'quote' && action !== 'reject')) return fail(7001, '无权限');

    const role = await getUserRole(openid);
    const now = Date.now();

    if (action === 'quote') {
      if (role !== 'merchant') return fail(7001, '无权限');

      const amount = Number(payload.amount);
      if (!(amount > 0)) return fail(7002, '金额必须为正数');

      const order = await findOrder(orderId);
      if (!order) return fail(7003, '报价失败，请重试');
      if (order.status !== 'pending_quote' && order.status !== 'pending_payment') {
        return fail(7003, '报价失败，请重试');
      }

      const description = safeString(payload.description, 500);
      const validUntil = Number(payload.validUntil) || 0;

      // 保留历史报价
      await quotes.add({
        data: {
          orderId: order._id,
          orderNo: order.orderNo,
          amount,
          description,
          validUntil,
          status: 'active',
          byMerchant: openid,
          createdAt: now
        }
      });

      // 更新订单：以最新报价为准，转「待付款」
      await orders.doc(order._id).update({
        data: {
          amount,
          status: 'pending_payment',
          quote: { amount, description, validUntil, status: 'active' },
          timeline: _.push([{ status: 'pending_payment', at: now, source: 'merchant' }]),
          updatedAt: now
        }
      });

      await writeLog(order.orderNo, 'quote', order.status, 'pending_payment', 'merchant', { amount });

      return ok({ orderId: order._id, orderNo: order.orderNo, amount, status: 'pending_payment' });
    }

    // reject：客户或商家拒绝报价
    const order = await findOrder(orderId);
    if (!order) return fail(7003, '报价失败，请重试');
    const isCustomer = order.openid === openid;
    const isMerchant = role === 'merchant';
    if (!isCustomer && !isMerchant) return fail(7001, '无权限');

    const rejectReason = safeString(payload.rejectReason, 500);
    const prev = order.quote || {};
    const source = isMerchant ? 'merchant' : 'customer';

    await orders.doc(order._id).update({
      data: {
        status: 'pending_quote',
        quote: {
          amount: prev.amount || 0,
          description: prev.description || '',
          validUntil: prev.validUntil || 0,
          status: 'rejected'
        },
        rejectReason,
        timeline: _.push([{ status: 'pending_quote', at: now, source }]),
        updatedAt: now
      }
    });

    // 将最近一条 active 报价标记为 rejected
    const activeRes = await quotes
      .where({ orderId: order._id, status: 'active' })
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();
    const active = activeRes.data && activeRes.data[0];
    if (active) {
      await quotes.doc(active._id).update({ data: { status: 'rejected', rejectReason } });
    }

    await writeLog(order.orderNo, 'reject_quote', order.status, 'pending_quote', source, { rejectReason });

    return ok({ orderId: order._id, orderNo: order.orderNo, status: 'pending_quote' });
  } catch (err) {
    console.error('[submitQuote] error', err);
    return fail(7003, '报价失败，请重试');
  }
};