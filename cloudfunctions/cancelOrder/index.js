/**
 * 云函数：cancelOrder —— 取消订单（REQ-037 / C-CANCEL@1）
 * 入参：event.payload = { orderId }
 * 出参：{ code: 0, data } / 8001 无权操作该订单 / 8002 已支付订单请联系商家 / 8003 订单已取消
 * 规则：仅本人可取消；仅「待付款/待报价」可取消；
 *       已支付/制作中/已完成/已退款/取消后付款 → 8002；已取消 → 8003。
 * 与支付回调的竞态：事务内重读订单再改状态；事务不可用时退化为
 * where status ∈ 可取消状态 的条件更新，避免覆盖已支付结果。
 */
const cloud = require('wx-server-sdk');
const rules = require('./rules');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function cancelPatch(now) {
  return {
    status: 'cancelled',
    timeline: _.push([{ status: 'cancelled', at: now, source: 'customer' }]),
    updatedAt: now
  };
}

async function writeCancelLog(order, from, now) {
  try {
    await orderLogs.add({
      data: {
        orderNo: order.orderNo,
        action: 'cancel',
        from: from,
        to: 'cancelled',
        source: 'customer',
        detail: {},
        createdAt: now
      }
    });
  } catch (err) {
    console.error('[cancelOrder] 日志写入失败', err);
  }
}

async function cancelInTransaction(order, openid) {
  const transaction = await db.startTransaction();
  try {
    const snap = await transaction.collection('orders').doc(order._id).get();
    const current = (snap && snap.data) || null;
    const decision = rules.decideCancel(current, openid);
    if (!decision.ok) {
      await transaction.rollback();
      return { decision: decision };
    }
    const now = Date.now();
    await transaction.collection('orders').doc(order._id).update({ data: cancelPatch(now) });
    await transaction.commit();
    return { decision: decision, now: now };
  } catch (err) {
    try { await transaction.rollback(); } catch (rollbackErr) { /* ignore */ }
    throw err;
  }
}

async function cancelConditional(order, openid) {
  const freshRes = await orders.doc(order._id).get();
  const current = (freshRes && freshRes.data) || order;
  const decision = rules.decideCancel(current, openid);
  if (!decision.ok) return { decision: decision };
  const now = Date.now();
  const upd = await orders.where({
    _id: order._id,
    openid: openid,
    status: _.in(rules.CANCELLABLE)
  }).update({ data: cancelPatch(now) });
  if (rules.updatedCount(upd) < 1) {
    const againRes = await orders.doc(order._id).get();
    const again = (againRes && againRes.data) || current;
    return { decision: rules.decideCancel(again, openid) };
  }
  return { decision: decision, now: now };
}

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail(8001, '无权操作该订单');

    const payload = (event && event.payload) || {};
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';
    if (!orderId) return fail(8001, '无权操作该订单');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) return fail(8001, '无权操作该订单');

    const preview = rules.decideCancel(order, openid);
    if (!preview.ok && preview.code === 8001) return fail(preview.code, preview.message);

    let applied;
    try {
      applied = await cancelInTransaction(order, openid);
    } catch (err) {
      console.error('[cancelOrder] 事务失败，改用条件更新', err);
      applied = await cancelConditional(order, openid);
    }

    if (!applied.decision.ok) return fail(applied.decision.code, applied.decision.message);
    if (!applied.now) return fail(8002, '已支付订单请联系商家');

    await writeCancelLog(order, applied.decision.from, applied.now);
    return ok({ orderId: order._id, orderNo: order.orderNo, status: 'cancelled' });
  } catch (err) {
    console.error('[cancelOrder] error', err);
    return fail(8001, '无权操作该订单');
  }
};
