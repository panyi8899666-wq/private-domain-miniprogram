/**
 * 云函数：musePoll —— 对接设计师轮询接口（Muse 侧专用，非小程序前端调用）
 *
 * 调用方式：只能走微信云开发 HTTP API invokeCloudFunction（Muse 侧持 AppSecret 换
 * access_token 后调用），HTTP API 触发的云函数没有微信用户信息，所以本函数不依赖
 * OPENID，改用第二道密钥校验。
 *   两道门：① 微信 HTTP API access_token（须 AppSecret，由外部 HTTP 层保证）；
 *           ② 本函数内以常量时间比较（crypto.timingSafeEqual + 定长摘要）校验
 *              payload.secret === process.env.MUSE_BRIDGE_SECRET；环境变量缺失
 *              直接拒绝。校验失败一律返回 7001「无权限」，不透露订单是否存在。
 *
 * 入参：event.payload = { secret, since? }
 *   since：毫秒时间戳（可选），只返回 updatedAt 大于该值的订单。
 * 出参：{ code: 0, data: { orders: [...], hasMore, nextSince }, message: 'ok' }
 *   每单只回最小字段（C-BRIDGE@1）：订单号、类型、状态、创建/更新时间、需求摘要、
 *   商品明细、客户未读留言、对接回复。绝不回传 openid、客户手机号、收货地址。
 *   Muse 不需要手机号：回复走小程序订单详情，不走电话。
 *
 * 轮询游标（关键修复）：
 *   - `updatedAt > since` 下推到数据库 where（不再先 limit 再内存过滤，避免漏单）；
 *   - 按 updatedAt 升序取一批，保证"最老未处理变更优先"，不会因截断永久漏掉订单；
 *   - 响应补 `hasMore` 与 `nextSince`（nextSince = 本批最大 updatedAt），
 *     Muse 侧可用 nextSince 作为下次 since 续拉。
 *
 * 失败：{ code: 7001, data: null, message: '无权限' }
 */
const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const orders = db.collection('orders');

// 单批最多返回的订单数（与桥侧 5 秒超时约束匹配）
const MAX_BATCH = 20;

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

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

/** 视图映射：只输出契约允许的最小字段，绝不新增 openid / 手机号 / 地址。 */
function toMinimalOrder(o) {
  const req = o.customRequirement || {};
  const unread = (o.clientMessages || []).filter((m) => !m.designerSeenAt);
  return {
    orderId: o._id,
    orderNo: o.orderNo || '',
    type: o.type || '',
    status: o.status || '',
    createdAt: o.createdAt || 0,
    updatedAt: o.updatedAt || 0,
    designerAckAt: o.designerAckAt || 0,
    customRequirement: {
      materialType: req.materialType || '',
      categoryName: req.categoryName || '',
      materialName: req.materialName || '',
      spec: req.spec || null,
      crafts: req.crafts || [],
      size: req.size || '',
      sizeDesc: req.sizeDesc || '',
      area: req.area || null,
      quantity: req.quantity || '',
      installPosition: req.installPosition || '',
      requirement: req.requirement || ''
    },
    items: (o.items || []).map((it) => ({
      name: it.name || '',
      specName: it.specName || '',
      unitPrice: it.unitPrice || 0,
      quantity: it.quantity || 1
    })),
    clientMessagesUnread: unread.map((m) => ({ text: m.text || '', at: m.at || 0 })),
    designerReplies: (o.designerReplies || []).map((r) => ({
      from: r.from || '',
      name: r.name || '',
      kind: r.kind || '',
      text: r.text || '',
      at: r.at || 0
    }))
  };
}

exports.main = async (event) => {
  try {
    const payload = (event && event.payload) || {};
    if (!bridgeAuthorized(payload)) return fail(7001, '无权限');

    const since = Number(payload.since) || 0;

    // 游标下推：updatedAt > since 直接进 where；多取一条用于探测是否还有更多。
    // 升序保证先处理最老的未处理变更，配合 nextSince 续拉不会漏单。
    const res = await orders
      .where({ updatedAt: _.gt(since) })
      .orderBy('updatedAt', 'asc')
      .limit(MAX_BATCH + 1)
      .get();

    const all = res.data || [];
    const hasMore = all.length > MAX_BATCH;
    const batch = hasMore ? all.slice(0, MAX_BATCH) : all;

    const out = batch.map(toMinimalOrder);
    // nextSince 取本批最大 updatedAt；无数据时保持原 since（不回退游标）
    const nextSince = batch.length ? (batch[batch.length - 1].updatedAt || 0) : since;

    return ok({ orders: out, hasMore, nextSince });
  } catch (err) {
    console.error('[musePoll] error', err);
    return fail(7001, '无权限');
  }
};