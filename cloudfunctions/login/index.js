/**
 * 云函数：login —— 获取可信 openid 并在 users 集合 upsert 用户记录
 * 需求锚点：REQ-042、REQ-053、REQ-054
 *
 * 入参：event.payload = { nickName?: string, avatarUrl?: string }
 * 出参：{ code: 0, data: { openid, user }, message: 'ok' }
 *       失败：{ code: 1001, data: null, message: '登录失败，请重试' }
 *
 * 安全要点（DFX §4.3.1）：
 *   openid 只能通过 cloud.getWXContext().OPENID 获取，绝不接受前端传入。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const users = db.collection('users');

/** 统一成功响应 */
function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

/** 统一失败响应 */
function fail(code, message) {
  return { code, data: null, message };
}

/** 手机号脱敏：173****3179（REQ-050 / DFX §4.3.4） */
function maskPhone(phone) {
  const s = String(phone || '');
  if (/^\d{11}$/.test(s)) return s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-4);
  return s ? '****' : '';
}

/** 对外返回的用户信息（手机号一律脱敏） */
function toPublicUser(user) {
  return {
    openid: user.openid,
    nickName: user.nickName || '',
    avatarUrl: user.avatarUrl || '',
    phone: maskPhone(user.phone),
    hasPhone: !!user.phone,
    role: user.role || 'customer',
    realName: user.realName || '',
    company: user.company || '',
    customerType: user.customerType || 'personal',
    industry: user.industry || '',
    invoiceTitle: user.invoiceTitle || '',
    taxNo: user.taxNo || '',
    addresses: Array.isArray(user.addresses) ? user.addresses : [],
    privacyAgreedAt: user.privacyAgreedAt || 0
  };
}

/** 截断并做类型归一 */
function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

exports.main = async (event) => {
  try {
    // openid 仅来自云开发上下文，忽略前端传入的任何 openid 字段
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) {
      console.error('[login] 无法获取 OPENID');
      return fail(1001, '登录失败，请重试');
    }

    const payload = (event && event.payload) || {};
    const nickName = safeString(payload.nickName, 60);
    const avatarUrl = safeString(payload.avatarUrl, 500);
    const now = Date.now();

    const existing = await users.where({ openid }).limit(1).get();
    let user;

    if (existing.data && existing.data.length) {
      user = existing.data[0];
      const patch = { updatedAt: now };
      if (nickName) patch.nickName = nickName;
      if (avatarUrl) patch.avatarUrl = avatarUrl;
      await users.doc(user._id).update({ data: patch });
      user = Object.assign({}, user, patch);
    } else {
      const doc = {
        openid,
        nickName,
        avatarUrl,
        phone: '',
        realName: '',
        company: '',
        customerType: 'personal',
        industry: '',
        invoiceTitle: '',
        taxNo: '',
        addresses: [],
        role: 'customer', // 商家角色需在云开发控制台手动设置 users.role='merchant'
        privacyAgreedAt: 0,
        createdAt: now,
        updatedAt: now
      };
      const added = await users.add({ data: doc });
      user = Object.assign({ _id: added._id }, doc);
    }

    console.log('[login] ok openid=%s', openid);
    return ok({ openid, user: toPublicUser(user) });
  } catch (err) {
    console.error('[login] error', err);
    return fail(1001, '登录失败，请重试');
  }
};