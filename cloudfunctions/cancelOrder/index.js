/**
 * 云函数：cancelOrder —— 取消订单（REQ-037）
 * 入参：event.payload = { orderId }
 * 出参：{ code: 0, data } / 8001 无权操作该订单 / 8002 已支付订单请联系商家 / 9001 无权操作该订单
 * 规则：仅本人可取消；仅「待付款/待报价」可取消；已支付需联系商家
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

const CANCELLABLE = ['pending_payment', 'pending_quote'];

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
    if (order.openid !== openid) return fail(9001, '无权操作该订单');
    if (CANCELLABLE.indexOf(order.status) === -1) return fail(8002, '已支付订单请联系商家');

    const now = Date.now();
    await orders.doc(order._id).update({
      data: {
        status: 'cancelled',
        timeline: _.push([{ status: 'cancelled', at: now, source: 'customer' }]),
        updatedAt: now
      }
    });

    await orderLogs.add({
      data: {
        orderNo: order.orderNo,
        action: 'cancel',
        from: order.status,
        to: 'cancelled',
        source: 'customer',
        detail: {},
        createdAt: now
      }
    });

    return ok({ orderId: order._id, orderNo: order.orderNo, status: 'cancelled' });
  } catch (err) {
    console.error('[cancelOrder] error', err);
    return fail(8001, '无权操作该订单');
  }
};