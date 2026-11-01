/**
 * 云函数：getOrders —— 订单列表（REQ-034、REQ-045）
 * 入参：event.payload = { status?, page?, pageSize? }
 * 出参：{ code: 0, data: { list, total, hasMore, page, pageSize } } / 9001 加载失败
 * 权限：客户仅见本人订单（openid 过滤），商家（role=merchant）见全部；
 *       客户侧手机号一律脱敏（contactPhone 与 address.phone，C-PII@1）。
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const orders = db.collection('orders');
const users = db.collection('users');

function ok(data) { return { code: 0, data: data === undefined ? null : data, message: 'ok' }; }
function fail(code, message) { return { code, data: null, message }; }

function toInt(value, def) {
  const n = parseInt(value, 10);
  return isNaN(n) ? def : n;
}

/**
 * 手机号脱敏：173****3179
 * 口径与 login / getPhoneNumber 云函数、utils/format.js#maskPhone 保持一致（C-PII@1），不得另立规则。
 */
function maskPhone(phone) {
  const s = String(phone || '');
  if (/^\d{11}$/.test(s)) return s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-4);
  return s ? '****' : '';
}

/**
 * 订单隐私字段脱敏（C-PII@1）
 * - 非商家（客户）一律脱敏 order.contactPhone 与 order.address.phone；
 * - 商家（users.role==='merchant'）保持明文；
 * - 全程浅拷贝，避免污染查询结果对象。
 */
function maskOrderPii(order, isMerchant) {
  const item = Object.assign({}, order);
  if (isMerchant) return item;
  if (item.contactPhone) item.contactPhone = maskPhone(item.contactPhone);
  if (item.address && typeof item.address === 'object') {
    item.address = Object.assign({}, item.address);
    if (item.address.phone) item.address.phone = maskPhone(item.address.phone);
  }
  return item;
}

function sanitizeList(list, isMerchant) {
  return (list || []).map((o) => maskOrderPii(o, isMerchant));
}

exports.main = async (event) => {
  try {
    const openid = cloud.getWXContext().OPENID;
    if (!openid) return fail(9001, '加载失败，请重试');

    const payload = (event && event.payload) || {};
    const page = Math.max(1, toInt(payload.page, 1));
    const pageSize = Math.min(50, Math.max(1, toInt(payload.pageSize, 10)));

    // 判定商家身份
    let isMerchant = false;
    try {
      const uRes = await users.where({ openid }).limit(1).get();
      const u = uRes.data && uRes.data[0];
      isMerchant = !!(u && u.role === 'merchant');
    } catch (e) { /* users 集合可能不存在，按客户处理 */ }

    const where = {};
    if (!isMerchant) where.openid = openid;
    const status = payload.status;
    if (status && status !== 'all') where.status = status;

    const countRes = await orders.where(where).count();
    const listRes = await orders
      .where(where)
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get();

    const list = sanitizeList(listRes.data || [], isMerchant);
    const total = countRes.total || 0;

    return ok({ list, total, hasMore: page * pageSize < total, page, pageSize });
  } catch (err) {
    console.error('[getOrders] error', err);
    return fail(9001, '加载失败，请重试');
  }
};