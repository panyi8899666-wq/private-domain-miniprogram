/**
 * 云函数：createPayment —— 调起微信支付
 * 入参：event.payload = { orderId }
 * 出参：{ code: 0, data: { payment }, message } / A001 订单状态已变更 / A002 报价已过期 / A003 支付发起失败
 *
 * 金额口径（C-PAY@1）：以服务端持久化的 orders.amountFen（整数分）为唯一权威；
 *   amountFen 缺失时回退 Math.round(order.amount * 100) 并记录告警；忽略前端传入的任何金额。
 * 支付发起幂等（C-PAY@1）：同一订单固定复用 outTradeNo = orderNo，避免重复统一下单副作用；
 *   每次发起向 orders.payments 原子追加尝试记录（含支付参数，供同窗口内重复发起时复用）。
 * 安全：openid 仅取 getWXContext；仅订单本人且状态为 pending_payment 可发起；密钥不出云函数。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const orders = db.collection('orders');

// 微信预支付参数有效期约 2 小时；窗口内重复发起直接复用上次结果，不重复产生统一下单副作用
const PAYMENT_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

/**
 * 计算订单应付金额（分）：amountFen 为权威；
 * 缺失或非法时回退 amount（元）× 100 并记录告警，便于排查历史脏数据。
 */
function resolveAmountFen(order, orderId) {
  const rawFen = order.amountFen;
  if (rawFen !== undefined && rawFen !== null && isFinite(Number(rawFen))) {
    const fen = Math.round(Number(rawFen));
    if (fen > 0) return fen;
  }
  console.warn('[createPayment] amountFen 缺失或非法，回退 amount*100 orderId=%s amount=%s', orderId, order.amount);
  return Math.round(Number(order.amount) * 100);
}

/**
 * 从 payments 历史中查找可复用的支付结果。
 * 只考察最近一条 matching outTradeNo 记录：命中且未过期则复用，否则视为需要重新下单。
 */
function findReusablePayment(history, outTradeNo, now) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const p = history[i];
    if (!p || p.outTradeNo !== outTradeNo) continue;
    if (p.status === 'created' && p.payment && p.attemptAt && (now - Number(p.attemptAt)) < PAYMENT_CACHE_TTL_MS) {
      return p;
    }
    break;
  }
  return null;
}

/** 原子追加支付尝试记录（审计写入失败不影响支付主流程） */
async function recordPaymentAttempt(orderId, record) {
  try {
    await orders.doc(orderId).update({
      data: { payments: _.push([record]), updatedAt: Date.now() }
    });
  } catch (err) {
    console.error('[createPayment] 支付尝试记录写入失败', err);
  }
}

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail('A001', '订单状态已变更');

    const payload = (event && event.payload) || {};
    const orderId = typeof payload.orderId === 'string' ? payload.orderId : '';
    if (!orderId) return fail('A001', '订单状态已变更');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    // 归属校验：仅订单本人可发起支付
    if (!order || order.openid !== openid) return fail('A001', '订单状态已变更');
    // 状态校验：仅待付款订单可发起
    if (order.status !== 'pending_payment') return fail('A001', '订单状态已变更');

    // 定制订单报价有效期校验
    if (order.type === 'custom' && order.quote && order.quote.validUntil) {
      if (Date.now() > Number(order.quote.validUntil)) {
        return fail('A002', '报价已过期，请重新询价');
      }
    }

    // 金额口径：amountFen 权威，忽略前端金额
    const totalFee = resolveAmountFen(order, orderId);
    if (!(totalFee > 0)) return fail('A003', '支付发起失败，请重试');

    // 支付发起幂等：同一订单固定复用 outTradeNo = orderNo
    const outTradeNo = order.orderNo;
    if (!outTradeNo) return fail('A003', '支付发起失败，请重试');
    const now = Date.now();

    // 窗口内已有成功发起的尝试 → 复用其支付参数，不重复统一下单
    const history = Array.isArray(order.payments) ? order.payments : [];
    const reusable = findReusablePayment(history, outTradeNo, now);
    if (reusable) {
      return ok({ payment: reusable.payment, reused: true });
    }

    let subMchId = process.env.SUB_MCH_ID || process.env.WXPAY_SUB_MCH_ID || '';
    let envId = process.env.ENV_ID || process.env.WXPAY_ENV_ID || '';

    // 构建统一下单参数（不携带任何密钥在客户端）
    const payData = {
      body: '订单 ' + outTradeNo,
      outTradeNo: outTradeNo,
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
      await recordPaymentAttempt(order._id, { attemptAt: now, outTradeNo, status: 'failed', totalFee });
      return fail('A003', '支付发起失败，请重试');
    }

    if (!payRes || !payRes.payment) {
      await recordPaymentAttempt(order._id, { attemptAt: now, outTradeNo, status: 'failed', totalFee });
      return fail('A003', '支付发起失败，请重试');
    }

    // 原子追加尝试记录（含支付参数，供窗口内重复发起时复用）
    await recordPaymentAttempt(order._id, {
      attemptAt: now,
      outTradeNo,
      status: 'created',
      totalFee,
      payment: payRes.payment
    });

    return ok({ payment: payRes.payment });
  } catch (err) {
    console.error('[createPayment] error', err);
    return fail('A003', '支付发起失败，请重试');
  }
};