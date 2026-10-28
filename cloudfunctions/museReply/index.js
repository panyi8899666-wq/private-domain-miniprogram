/**
 * 云函数：museReply —— 对接设计师回写接口（Muse 侧专用，非小程序前端调用）
 *
 * 调用方式与鉴权同 musePoll：走微信云开发 HTTP API invokeCloudFunction，
 * payload.secret 必须等于云函数环境变量 MUSE_BRIDGE_SECRET。
 *
 * 入参：event.payload = { secret, orderId, kind, text }
 *   kind：'ack'（已收到确认，固定安全文案之外的自动回复）或 'reply'（经工作室
 *         确认后的实质回复；本函数不判断确认状态，确认流程在 Muse 侧执行，
 *         即：实质回复必须先由 pan 在对话里点头，Muse 侧才调用本函数）。
 *   text：最长 1000 字；价格、方案、制作周期等实质内容由调用方负责，
 *         本函数只做长度与空值校验，不编造内容。
 * 出参：{ code: 0, data: { orderNo }, message: 'ok' }
 * 失败：7001 无权限（含密钥错、订单不存在），6001 文案不合法。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

exports.main = async (event) => {
  try {
    const payload = (event && event.payload) || {};
    if (!process.env.MUSE_BRIDGE_SECRET || payload.secret !== process.env.MUSE_BRIDGE_SECRET) {
      return fail(7001, '无权限');
    }
    const orderId = safeString(payload.orderId, 64);
    const kind = payload.kind === 'ack' ? 'ack' : payload.kind === 'reply' ? 'reply' : '';
    const text = safeString(payload.text, 1000);
    if (!orderId || !kind || !text) return fail(6001, '文案不合法');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) return fail(7001, '无权限');

    const now = Date.now();
    const reply = { from: 'designer', name: 'Muse', kind, text, at: now };
    const replies = Array.isArray(order.designerReplies) ? order.designerReplies : [];
    replies.push(reply);
    // 客户留言全部标记为已读：本回复即是对当前全部留言的回应
    const clientMessages = (order.clientMessages || []).map((m) => (
      m.designerSeenAt ? m : Object.assign({}, m, { designerSeenAt: now })
    ));

    const update = {
      designerReplies: replies.slice(-50),
      clientMessages,
      updatedAt: now
    };
    if (kind === 'ack' && !order.designerAckAt) update.designerAckAt = now;

    await orders.doc(orderId).update({ data: update });
    try {
      await orderLogs.add({
        data: {
          orderNo: order.orderNo || '',
          action: 'designer_reply',
          from: order.status || '',
          to: order.status || '',
          source: 'designer',
          detail: { kind },
          createdAt: now
        }
      });
    } catch (e) { /* 日志失败不影响回复落库 */ }

    return ok({ orderNo: order.orderNo || '' });
  } catch (err) {
    console.error('[museReply] error', err);
    return fail(7001, '无权限');
  }
};
