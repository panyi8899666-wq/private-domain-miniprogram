/**
 * 云函数：createPayment —— 调起微信支付（REQ-038、REQ-049）
 * 入参：event.payload = { orderId }
 * 出参：{ code: 0, data: { payment }, message } / A001 订单状态已变更 / A002 报价已过期 / A003 支付发起失败
 * 安全：openid 仅取 getWXContext；金额取 orders.amount（服务端），忽略前端；密钥不出云函数
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const orders = db.collection('orders');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail('A001', '订单状态已变更');

    const payload = (event && event.payload) || {};
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';
    if (!orderId) return fail('A001', '订单状态已变更');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order || order.openid !== openid) return fail('A001', '订单状态已变更');
    if (order.status !== 'pending_payment') return fail('A001', '订单状态已变更');

    // 定制订单报价有效期校验
    if (order.type === 'custom' && order.quote && order.quote.validUntil) {
      if (Date.now() > Number(order.quote.validUntil)) {
        return fail('A002', '报价已过期，请重新询价');
      }
    }

    const amount = Number(order.amount);
    if (!(amount > 0)) return fail('A003', '支付发起失败，请重试');
    const totalFee = Math.round(amount * 100); // 元 → 分

    let subMchId = process.env.SUB_MCH_ID || process.env.WXPAY_SUB_MCH_ID || '';
    let envId = process.env.ENV_ID || process.env.WXPAY_ENV_ID || '';

    // 构建统一下单参数（不携带任何密钥在客户端）
    const payData = {
      body: '订单 ' + order.orderNo,
      outTradeNo: order.orderNo,
      spbillCreateIp: '127.0.0.1',
      totalFee: totalFee,
      functionName: 'payCallback'
    };
    if (subMchId) payData.subMchId = subMchId;
    if (envId) payData.envId = envId;

    let payRes;
    try {
      payRes = await cloud.cloudPay.unifiedOrder(payData);
    } catch (e) {
      console.error('[createPayment] unifiedOrder error', e);
      return fail('A003', '支付发起失败，请重试');
    }

    if (!payRes || !payRes.payment) return fail('A003', '支付发起失败，请重试');

    return ok({ payment: payRes.payment });
  } catch (err) {
    console.error('[createPayment] error', err);
    return fail('A003', '支付发起失败，请重试');
  }
};