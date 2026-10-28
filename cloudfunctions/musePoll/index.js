/**
 * 云函数：musePoll —— 对接设计师轮询接口（Muse 侧专用，非小程序前端调用）
 *
 * 调用方式：只能走微信云开发 HTTP API invokeCloudFunction（Muse 侧持 AppSecret 换
 * access_token 后调用），HTTP API 触发的云函数没有微信用户信息，所以本函数不依赖
 * OPENID，改用第二道密钥校验。
 *
 * 入参：event.payload = { secret, since? }
 *   secret：必须等于云函数环境变量 MUSE_BRIDGE_SECRET，否则一律返回 7001，
 *           不透露是密钥错还是订单不存在。
 *   since：毫秒时间戳（可选），只返回 updatedAt 大于该值的订单，最多 20 单。
 * 出参：{ code: 0, data: { orders: [...] }, message: 'ok' }
 *   每单只回最小字段：订单号、类型、状态、创建时间、更新时间、需求摘要、
 *   商品明细、客户未读留言、对接回复。绝不回传 openid 与客户手机号。
 *   Muse 不需要手机号：回复走小程序订单详情，不走电话。
 *
 * 失败：{ code: 7001, data: null, message: '无权限' }
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const orders = db.collection('orders');

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
    const since = Number(payload.since) || 0;

    const res = await orders
      .orderBy('updatedAt', 'desc')
      .limit(20)
      .get();
    const list = (res.data || []).filter((o) => Number(o.updatedAt || 0) > since);

    const out = list.map((o) => {
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
        designerReplies: o.designerReplies || []
      };
    });

    return ok({ orders: out });
  } catch (err) {
    console.error('[musePoll] error', err);
    return fail(7001, '无权限');
  }
};
