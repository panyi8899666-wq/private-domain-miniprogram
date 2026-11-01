/**
 * 云函数：addOrderMessage —— 客户在订单详情里给对接设计师留言
 *
 * 入参：event.payload = { orderId, text }
 * 安全：openid 取云开发上下文；仅订单本人或商家（users.role==='merchant'）
 *       可留言；留言最长 500 字；留言只追加，不改订单状态与金额。
 * 一致性（关键修复）：使用云数据库原子追加（db.command.push），不再使用
 *       "读取整数组 → 改 → 整体 update" 的读改写方式（并发下会丢消息）。
 *       数组保留最近 50 条：截断发生在原子追加之后，且以"重读最新快照 + 数组
 *       长度乐观并发校验 + 重试"实现，绝不把并发新增的消息回退为写入前的旧快照。
 * 出参：{ code: 0, data: { at }, message: 'ok' }
 * 失败：9002 无权操作，6001 留言不合法。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');
const users = db.collection('users');
const orderLogs = db.collection('order_logs');

// 留言数组保留上限（C-ORDER-MSG@1）
const MAX_MESSAGES = 50;

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

/** 读取文档内某个数组字段的最新值（不存在时返回空数组）。 */
async function readArrayField(orderId, field) {
  const res = await orders.doc(orderId).field({ [field]: true }).get();
  const data = res && res.data;
  if (data && Array.isArray(data[field])) return data[field];
  return [];
}

/**
 * 截断数组，仅保留最近 max 条。
 *
 * 关键点：原子 push 之后重新读取最新快照，再用「数组长度 = 读取时长度」作为
 * 乐观并发条件（db.command.size）执行写入。若两次读取之间发生并发追加，长度
 * 条件不匹配、更新的影响行数为 0，则重试读取；重试耗尽时"放弃截断而不覆盖"，
 * 宁可暂时略多于上限，也绝不丢失并发新增的留言（下次留言时会再次尝试截断）。
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
    console.warn('[addOrderMessage] trim skipped after concurrent writes', { orderId, field });
  } catch (e) {
    // 截断失败不影响留言落库（消息已原子追加成功）
    console.error('[addOrderMessage] trim error', e);
  }
}

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) return fail(9002, '无权操作');

    const payload = (event && event.payload) || {};
    const orderId = safeString(payload.orderId, 64);
    const text = safeString(payload.text, 500);
    if (!orderId || !text) return fail(6001, '留言不合法');

    const res = await orders.where({ _id: orderId }).limit(1).get();
    const order = res.data && res.data[0];
    if (!order) return fail(9002, '无权操作');

    let isMerchant = false;
    if (order.openid !== openid) {
      try {
        const uRes = await users.where({ openid }).limit(1).get();
        const u = uRes.data && uRes.data[0];
        isMerchant = !!(u && u.role === 'merchant');
      } catch (e) { /* ignore */ }
      if (!isMerchant) return fail(9002, '无权操作');
    }

    const now = Date.now();
    const message = { from: 'customer', text, at: now, designerSeenAt: null };

    // 原子追加：只把新留言 push 进数组，不整体覆盖（并发安全）
    await orders.doc(orderId).update({
      data: {
        clientMessages: _.push([message]),
        updatedAt: now
      }
    });
    // 追加成功后再基于最新快照做上限截断
    await trimArray(orderId, 'clientMessages', MAX_MESSAGES);

    try {
      await orderLogs.add({
        data: {
          orderNo: order.orderNo || '',
          action: 'customer_message',
          from: order.status || '',
          to: order.status || '',
          source: 'customer',
          detail: {},
          createdAt: now
        }
      });
    } catch (e) { /* ignore */ }

    return ok({ at: now });
  } catch (err) {
    console.error('[addOrderMessage] error', err);
    return fail(9002, '无权操作');
  }
};