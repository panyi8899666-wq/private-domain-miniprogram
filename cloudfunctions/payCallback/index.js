/**
 * 云函数：payCallback —— 微信支付结果回调
 * 入参：微信/云开发支付回调 event = { returnCode, resultCode, outTradeNo, transactionId, totalFee(分), timeEnd }
 * 出参：{ errcode, errmsg }（微信支付回调协议：errcode=0 表示处理成功，否则微信会重试）
 *
 * 幂等与异常补偿（C-PAY@1）：
 *   1) 来源防护：平台侧回调 getWXContext().OPENID 为空；若非空则视为小程序端伪造，拒绝处理。
 *   2) 幂等：以 transactionId 为 payment_records._id，同一支付流水只落账一次。
 *   3) 金额核对：期望分取 orders.amountFen（缺失回退 amount）；核对不通过不标记已付。
 *   4) 状态迁移使用事务（失败时退化为 where status == 期望值 的条件更新），避免与取消订单互相覆盖。
 *   5) 已取消订单收到成功支付：写入 paid_after_cancel（待人工退款），不改回制作中。
 * 说明：真实上线需对微信支付异步通知验签（云开发云调用模式已由平台侧完成验签）。
 */
const cloud = require('wx-server-sdk');
const rules = require('./rules');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');
const paymentRecords = db.collection('payment_records');

/**
 * 写入异常支付审计（pay_anomaly）。
 * 以 transactionId 去重，避免微信重试导致重复审计；写入失败不影响回调返回。
 */
async function recordAnomaly(order, detail) {
  try {
    const dup = await orderLogs
      .where({ orderNo: order.orderNo, action: 'pay_anomaly', 'detail.transactionId': detail.transactionId })
      .limit(1)
      .get();
    if (dup.data && dup.data.length) return;

    await orderLogs.add({
      data: {
        orderNo: order.orderNo || '',
        action: 'pay_anomaly',
        from: order.status || '',
        to: detail.toStatus || '',
        source: 'pay_callback',
        detail: detail,
        createdAt: Date.now()
      }
    });
  } catch (err) {
    console.error('[payCallback] 异常支付审计写入失败', err);
  }
}

async function findOrderByTradeNo(outTradeNo) {
  const byNo = await orders.where({ orderNo: outTradeNo }).limit(1).get();
  const direct = byNo.data && byNo.data[0];
  if (direct) return direct;
  const byPay = await orders.where({ payOutTradeNo: outTradeNo }).limit(1).get();
  return (byPay.data && byPay.data[0]) || null;
}

function expectFenOf(order, outTradeNo) {
  const rawFen = order.amountFen;
  if (rawFen !== undefined && rawFen !== null && isFinite(Number(rawFen)) && Math.round(Number(rawFen)) > 0) {
    return Math.round(Number(rawFen));
  }
  console.warn('[payCallback] amountFen 缺失或非法，回退 amount*100 orderNo=%s amount=%s', outTradeNo, order.amount);
  return rules.resolveAmountFen(order);
}

function paymentPatch(action, payment, now) {
  const status = action === 'paid_after_cancel' ? 'paid_after_cancel' : 'making';
  const data = {
    status: status,
    payment: Object.assign({}, payment, action === 'paid_after_cancel' ? { exception: 'paid_after_cancel' } : {}),
    timeline: _.push([{ status: status, at: now, source: 'pay_callback' }]),
    updatedAt: now
  };
  if (action === 'paid_after_cancel') {
    data.payException = 'paid_after_cancel';
    data.refundRequired = true;
  }
  return data;
}

async function writePayLog(orderNo, action, from, detail, now) {
  const to = action === 'paid_after_cancel' ? 'paid_after_cancel' : 'making';
  try {
    await orderLogs.add({
      data: {
        orderNo: orderNo,
        action: action === 'paid_after_cancel' ? 'pay_after_cancel' : 'pay',
        from: from || '',
        to: to,
        source: 'pay_callback',
        detail: detail,
        createdAt: now
      }
    });
  } catch (err) {
    console.error('[payCallback] 支付日志写入失败', err);
  }
}

async function claimPaymentRecord(transactionId, order, action, totalFee, now) {
  if (!transactionId) return;
  try {
    await paymentRecords.add({
      data: {
        _id: String(transactionId),
        orderNo: order.orderNo || '',
        orderId: order._id,
        totalFee: totalFee,
        action: action,
        createdAt: now
      }
    });
  } catch (err) {
    // 同一流水重复写入：事务路径已保证与订单更新同生共死；此处只避免条件更新路径重复报错
    console.warn('[payCallback] payment_records 已存在或写入失败', err && err.message);
  }
}

function callbackResult(decision, order, anomalyInfo) {
  if (decision.action === 'idempotent') return { errcode: 0, errmsg: 'ok' };
  if (decision.action === 'amount_mismatch') {
    return { errcode: -1, errmsg: 'amount mismatch', anomaly: true, reason: 'amount_mismatch' };
  }
  if (decision.action === 'anomaly') {
    return { errcode: 0, errmsg: 'ok', anomaly: true, reason: decision.reason || 'status_unknown' };
  }
  return null;
}

async function finishDecision(decision, order, anomalyInfo) {
  const early = callbackResult(decision, order, anomalyInfo);
  if (!early) return null;
  if (early.anomaly) {
    console.error('[payCallback] 异常支付', anomalyInfo, { status: order.status, reason: early.reason });
    await recordAnomaly(order, Object.assign({}, anomalyInfo, { reason: early.reason, status: order.status }));
  }
  return { errcode: early.errcode, errmsg: early.errmsg };
}

async function applyInTransaction(order, input) {
  const transaction = await db.startTransaction();
  try {
    const snap = await transaction.collection('orders').doc(order._id).get();
    const current = (snap && snap.data) || order;
    const decision = rules.decidePayCallback(current, input);
    const early = callbackResult(decision);
    if (early) {
      if (decision.action === 'idempotent') await transaction.commit();
      else await transaction.rollback();
      return { current: current, decision: decision, committed: decision.action === 'idempotent' };
    }
    const now = Date.now();
    const payment = {
      transactionId: input.transactionId,
      paidAt: now,
      payAmount: input.expectFen / 100,
      amountFen: input.expectFen,
      channel: 'wechat'
    };
    await transaction.collection('orders').doc(order._id).update({
      data: paymentPatch(decision.action, payment, now)
    });
    if (input.transactionId) {
      await transaction.collection('payment_records').add({
        data: {
          _id: String(input.transactionId),
          orderNo: current.orderNo || order.orderNo || '',
          orderId: order._id,
          totalFee: input.totalFee,
          action: decision.action,
          createdAt: now
        }
      });
    }
    await transaction.commit();
    return { current: current, decision: decision, committed: true, now: now };
  } catch (err) {
    try { await transaction.rollback(); } catch (rollbackErr) { /* 已结束则忽略 */ }
    throw err;
  }
}

async function applyConditional(order, input) {
  const freshRes = await orders.doc(order._id).get();
  const current = (freshRes && freshRes.data) || order;
  const decision = rules.decidePayCallback(current, input);
  const early = callbackResult(decision);
  if (early) return { current: current, decision: decision, committed: decision.action === 'idempotent' };

  const now = Date.now();
  const payment = {
    transactionId: input.transactionId,
    paidAt: now,
    payAmount: input.expectFen / 100,
    amountFen: input.expectFen,
    channel: 'wechat'
  };
  const expected = decision.action === 'paid_after_cancel' ? 'cancelled' : 'pending_payment';
  const upd = await orders.where({ _id: order._id, status: expected }).update({
    data: paymentPatch(decision.action, payment, now)
  });
  if (rules.updatedCount(upd) < 1) {
    const againRes = await orders.doc(order._id).get();
    const again = (againRes && againRes.data) || current;
    if (input.transactionId && again.payment && again.payment.transactionId === input.transactionId) {
      const action = again.status === 'paid_after_cancel' ? 'paid_after_cancel' : 'mark_paid';
      return { current: again, decision: { action: action }, committed: true, now: now };
    }
    const againDecision = rules.decidePayCallback(again, input);
    if (againDecision.action === 'idempotent') {
      return { current: again, decision: againDecision, committed: true };
    }
    if (againDecision.action === 'paid_after_cancel' && decision.action !== 'paid_after_cancel') {
      const fix = await orders.where({ _id: order._id, status: 'cancelled' }).update({
        data: paymentPatch('paid_after_cancel', payment, now)
      });
      if (rules.updatedCount(fix) > 0) {
        await claimPaymentRecord(input.transactionId, again, 'paid_after_cancel', input.totalFee, now);
        return { current: again, decision: againDecision, committed: true, now: now };
      }
    }
    return { current: again, decision: againDecision, committed: false };
  }
  await claimPaymentRecord(input.transactionId, current, decision.action, input.totalFee, now);
  return { current: current, decision: decision, committed: true, now: now };
}

exports.main = async (event) => {
  try {
    // 来源防护：微信支付结果通知为平台侧后台回调，此时 getWXContext().OPENID 为空。
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

    const order = await findOrderByTradeNo(outTradeNo);
    if (!order) {
      console.error('[payCallback] order not found:', outTradeNo);
      return { errcode: -1, errmsg: 'order not found' };
    }

    const expectFen = expectFenOf(order, outTradeNo);
    const anomalyInfo = { outTradeNo, transactionId, totalFee, expectFen };
    const input = { transactionId: transactionId, totalFee: totalFee, expectFen: expectFen };

    let applied;
    try {
      applied = await applyInTransaction(order, input);
    } catch (err) {
      console.error('[payCallback] 事务失败，改用条件更新', err);
      applied = await applyConditional(order, input);
    }

    const done = await finishDecision(applied.decision, applied.current || order, anomalyInfo);
    if (done) return done;
    if (!applied.committed) {
      await recordAnomaly(applied.current || order, Object.assign({}, anomalyInfo, {
        reason: 'status_' + ((applied.current && applied.current.status) || 'unknown')
      }));
      return { errcode: 0, errmsg: 'ok' };
    }

    await writePayLog(
      order.orderNo || outTradeNo,
      applied.decision.action,
      (applied.current && applied.current.status) || order.status,
      anomalyInfo,
      applied.now || Date.now()
    );
    return { errcode: 0, errmsg: 'ok' };
  } catch (err) {
    console.error('[payCallback] error', err);
    return { errcode: -1, errmsg: 'internal error' };
  }
};
