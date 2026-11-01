/**
 * 云函数：museReply —— 对接设计师回写接口（Muse 侧专用，非小程序前端调用）
 *
 * 调用方式与鉴权同 musePoll：走微信云开发 HTTP API invokeCloudFunction，
 * payload.secret 必须等于云函数环境变量 MUSE_BRIDGE_SECRET。
 *   两道门：① 微信 HTTP API access_token（须 AppSecret，由外部 HTTP 层保证）；
 *           ② 本函数内以常量时间比较（crypto.timingSafeEqual + 定长摘要）校验
 *              payload.secret === process.env.MUSE_BRIDGE_SECRET；环境变量缺失
 *              直接拒绝。校验失败一律返回 7001「无权限」，不透露订单是否存在。
 *
 * 入参：event.payload = { secret, orderId, kind, text }
 *   kind：'ack'（已收到确认）或 'reply'（经工作室确认后的实质回复）。
 *   text：最长 1000 字；价格、方案、制作周期等实质内容由调用方负责，
 *         本函数只做长度与空值校验，不编造内容。
 * 一致性（关键修复）：designerReplies 使用原子追加（db.command.push），不再整体
 *   覆盖；对 clientMessages[].designerSeenAt 的标记以「乐观并发校验（数组长度）+
 *   重试」实现，绝不把并发新增的客户留言覆盖回旧快照。
 * 出参：{ code: 0, data: { orderNo }, message: 'ok' }
 * 失败：7001 无权限（含密钥错、订单不存在），6001 文案不合法。
 */
const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const orderLogs = db.collection('order_logs');

// 回复数组保留上限（C-ORDER-MSG@1）
const MAX_REPLIES = 50;

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

/**
 * 常量时间字符串比较：先对两侧做定长摘要（sha256，天然等长），再用
 * crypto.timingSafeEqual 比较，规避 `!==` 的时序侧信道与长度差异泄漏。
 */
function timingSafeEqualStr(a, b) {
  const hashA = crypto.createHash('sha256').update(typeof a === 'string' ? a : '').digest();
  const hashB = crypto.createHash('sha256').update(typeof b === 'string' ? b : '').digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/** 桥鉴权：环境变量缺失直接拒绝；secret 常量时间比较。 */
function bridgeAuthorized(payload) {
  const expected = process.env.MUSE_BRIDGE_SECRET;
  if (!expected) return false;
  const provided = payload && payload.secret;
  if (typeof provided !== 'string' || !provided) return false;
  return timingSafeEqualStr(provided, expected);
}

/** 读取文档内某个数组字段的最新值（不存在时返回空数组）。 */
async function readArrayField(orderId, field) {
  const res = await orders.doc(orderId).field({ [field]: true }).get();
  const data = res && res.data;
  if (data && Array.isArray(data[field])) return data[field];
  return [];
}

/**
 * 截断数组，仅保留最近 max 条。原子追加之后执行，带长度乐观并发校验与重试；
 * 重试耗尽时放弃截断而不覆盖（绝不丢失并发新增内容）。
 */
async function trimArray(orderId, field, max) {
  try {
    for (let i = 0; i < 3; i++) {
      const arr = await readArrayField(orderId, field);
      if (arr.length <= max) return;
      const trimmed = arr.slice(-max);
      const res = await orders
        .where({ _id: orderId, [field]: _.size(arr.length) })
        .update({ data: { [field]: trimmed } });
      const updated = res && res.stats ? res.stats.updated : 0;
      if (updated > 0) return;
    }
    console.warn('[museReply] trim skipped after concurrent writes', { orderId, field });
  } catch (e) {
    console.error('[museReply] trim error', e);
  }
}

/**
 * 把当前全部客户留言标记为已读（designerSeenAt = now）。
 *
 * 云数据库不支持"原地更新数组内元素的字段"，只能整体写回数组。为避免在
 * 「读取 → 写回」窗口内并发 push 的新留言被旧快照覆盖，这里用乐观并发校验：
 * 写回条件是「数组长度 === 读取时长度」，长度不符则视为发生并发写入并重试；
 * 重试耗尽则跳过标记（宁可不标，也不丢消息；下轮轮询仍会显示为未读）。
 */
async function markMessagesSeen(orderId, now) {
  try {
    for (let i = 0; i < 5; i++) {
      const arr = await readArrayField(orderId, 'clientMessages');
      if (!arr.length) return;
      if (arr.every((m) => !!m.designerSeenAt)) return;
      const marked = arr.map((m) => (
        m.designerSeenAt ? m : Object.assign({}, m, { designerSeenAt: now })
      ));
      const res = await orders
        .where({ _id: orderId, clientMessages: _.size(arr.length) })
        .update({ data: { clientMessages: marked } });
      const updated = res && res.stats ? res.stats.updated : 0;
      if (updated > 0) return;
    }
    console.warn('[museReply] mark seen skipped after concurrent writes', { orderId });
  } catch (e) {
    console.error('[museReply] mark seen error', e);
  }
}

exports.main = async (event) => {
  try {
    const payload = (event && event.payload) || {};
    if (!bridgeAuthorized(payload)) return fail(7001, '无权限');

    const orderId = safeString(payload.orderId, 64);
    const kind = payload.kind === 'ack' ? 'ack' : payload.kind === 'reply' ? 'reply' : '';
    const text = safeString(payload.text, 1000);
    if (!orderId || !kind || !text) return fail(6001, '文案不合法');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) return fail(7001, '无权限');

    const now = Date.now();
    const reply = { from: 'designer', name: 'Muse', kind, text, at: now };

    // 原子追加回复（不整体覆盖数组）；ack 首次写入 designerAckAt
    const update = {
      designerReplies: _.push([reply]),
      updatedAt: now
    };
    if (kind === 'ack' && !order.designerAckAt) update.designerAckAt = now;

    await orders.doc(orderId).update({ data: update });
    await trimArray(orderId, 'designerReplies', MAX_REPLIES);

    // 客户留言全部标记为已读（本回复即是对当前全部留言的回应），原子化避免覆盖并发新增
    await markMessagesSeen(orderId, now);

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