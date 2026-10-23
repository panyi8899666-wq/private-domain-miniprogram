/**
 * 云函数：payCallback —— 微信支付结果回调（REQ-039、REQ-040、REQ-054）
 * 入参：微信/云开发支付回调 event = { returnCode, resultCode, outTradeNo, transactionId, totalFee(分), timeEnd }
 * 出参：{ errcode, errmsg }（微信支付回调协议：errcode=0 表示处理成功，否则微信会重试）
 * 安全：幂等（订单号+流水号）、金额核对（分）
 * 说明：真实上线需对微信支付异步通知验签（云开发云调用模式已由平台侧完成验签）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');

exports.main = async (event) => {
  try {
    // 来源防护（REQ-054）：微信支付结果通知为平台侧后台回调，此时 getWXContext().OPENID 为空。
    // 若 OPENID 非空，说明是本小程序端伪造调用，直接拒绝，防止伪造支付成功。
    // 上线前还需：① 在云开发控制台将本函数配置为不允许小程序端直接调用；
    //            ② 追加微信支付 v3 异步通知验签（需商户号 APIv3 密钥）。
    const wxContext = cloud.getWXContext();
    if (wxContext && wxContext.OPENID) {
      console.error('[payCallback] 疑似小程序端伪造调用，OPENID=%s', wxContext.OPENID);
      return { errcode: -1, errmsg: 'invalid source' };
    }

    const returnCode = event && event.returnCode;
    const resultCode = event && event.resultCode;
    const outTradeNo = event && event.outTradeNo;
    const transactionId = event && event.transactionId;
    const totalFee = Number(event && event.totalFee);

    if (returnCode && returnCode !== 'SUCCESS') return { errcode: 0, errmsg: 'ok' };
    if (resultCode && resultCode !== 'SUCCESS') return { errcode: 0, errmsg: 'ok' };
    if (!outTradeNo) return { errcode: -1, errmsg: 'missing outTradeNo' };

    const res = await orders.where({ orderNo: outTradeNo }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) {
      console.error('[payCallback] order not found:', outTradeNo);
      return { errcode: -1, errmsg: 'order not found' };
    }

    // 幂等：同一支付流水已处理
    if (order.payment && order.payment.transactionId && order.payment.transactionId === transactionId) {
      return { errcode: 0, errmsg: 'ok' };
    }
    // 订单已流转（不在待付款）视为幂等成功
    if (order.status !== 'pending_payment') {
      return { errcode: 0, errmsg: 'ok' };
    }

    // 金额核对（以服务端持久化的金额分 amountFen 为准，避免浮点误差）
    const expectFen = order.amountFen !== undefined ? Number(order.amountFen) : Math.round(Number(order.amount) * 100);
    if (!isFinite(totalFee) || totalFee !== expectFen) {
      console.error('[payCallback] amount mismatch', { orderNo: outTradeNo, expectFen, totalFee });
      return { errcode: -1, errmsg: 'amount mismatch' };
    }

    const now = Date.now();
    await orders.doc(order._id).update({
      data: {
        status: 'making',
        payment: { transactionId, paidAt: now, payAmount: expectFen / 100, channel: 'wechat' },
        timeline: _.push([{ status: 'making', at: now, source: 'pay_callback' }]),
        updatedAt: now
      }
    });

    await orderLogs.add({
      data: {
        orderNo: outTradeNo,
        action: 'pay',
        from: 'pending_payment',
        to: 'making',
        source: 'pay_callback',
        detail: { transactionId, totalFee },
        createdAt: now
      }
    });

    return { errcode: 0, errmsg: 'ok' };
  } catch (err) {
    console.error('[payCallback] error', err);
    return { errcode: -1, errmsg: 'internal error' };
  }
};