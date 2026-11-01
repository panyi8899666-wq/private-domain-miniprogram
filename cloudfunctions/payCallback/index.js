/**
 * 云函数：payCallback —— 微信支付结果回调
 * 入参：微信/云开发支付回调 event = { returnCode, resultCode, outTradeNo, transactionId, totalFee(分), timeEnd }
 * 出参：{ errcode, errmsg }（微信支付回调协议：errcode=0 表示处理成功，否则微信会重试）
 *
 * 幂等与异常补偿（C-PAY@1）：
 *   1) 来源防护：平台侧回调 getWXContext().OPENID 为空；若非空则视为小程序端伪造，拒绝处理。
 *   2) 幂等：以 order.payment.transactionId 去重，同一支付流水只处理一次。
 *   3) 金额核对：期望分取 orders.amountFen（缺失回退 amount）；核对不通过不标记已付。
 *   4) 异常补偿：回调到达但订单已 cancelled 或不在 pending_payment 且未支付时，
 *      写 order_logs.action='pay_anomaly' 审计并返回 errcode:0，绝不把未付款订单标记为已付，供人工退款。
 * 说明：真实上线需对微信支付异步通知验签（云开发云调用模式已由平台侧完成验签）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');

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
        to: '',
        source: 'pay_callback',
        detail: detail,
        createdAt: Date.now()
      }
    });
  } catch (err) {
    console.error('[payCallback] 异常支付审计写入失败', err);
  }
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

    // 期望金额（分）：amountFen 权威，缺失时回退 amount 并记录告警
    let expectFen;
    if (order.amountFen !== undefined && order.amountFen !== null && isFinite(Number(order.amountFen))) {
      expectFen = Math.round(Number(order.amountFen));
    } else {
      console.warn('[payCallback] amountFen 缺失或非法，回退 amount*100 orderNo=%s amount=%s', outTradeNo, order.amount);
      expectFen = Math.round(Number(order.amount) * 100);
    }

    const anomalyInfo = { outTradeNo, transactionId, totalFee, expectFen };

    // 异常补偿：订单非待付款状态（已取消 / 已流转）且未标记支付
    if (order.status !== 'pending_payment') {
      // 订单已完成支付（存在支付流水）→ 视为重复回调，幂等返回
      if (order.payment && order.payment.transactionId) {
        return { errcode: 0, errmsg: 'ok' };
      }
      // 未支付但状态异常：写异常支付审计，返回 0（避免微信无意义重试），绝不标记为已付
      console.error('[payCallback] 异常支付：订单状态不可支付', anomalyInfo, { status: order.status });
      await recordAnomaly(order, Object.assign({}, anomalyInfo, { reason: 'status_' + (order.status || 'unknown') }));
      return { errcode: 0, errmsg: 'ok' };
    }

    // 金额核对（分）：不一致时不标记已付，写审计并返回失败（触发重试以便人工介入）
    if (!isFinite(totalFee) || totalFee !== expectFen) {
      console.error('[payCallback] amount mismatch', anomalyInfo);
      await recordAnomaly(order, Object.assign({}, anomalyInfo, { reason: 'amount_mismatch' }));
      return { errcode: -1, errmsg: 'amount mismatch' };
    }

    const now = Date.now();
    await orders.doc(order._id).update({
      data: {
        status: 'making',
        payment: {
          transactionId,
          paidAt: now,
          payAmount: expectFen / 100,
          amountFen: expectFen,
          channel: 'wechat'
        },
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
        detail: anomalyInfo,
        createdAt: now
      }
    });

    return { errcode: 0, errmsg: 'ok' };
  } catch (err) {
    console.error('[payCallback] error', err);
    return { errcode: -1, errmsg: 'internal error' };
  }
};