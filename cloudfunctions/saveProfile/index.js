/**
 * 云函数：saveProfile —— 保存客户注册资料（第一批注册入口）
 * 需求锚点：客户注册资料页（姓名/公司/类型/行业/开票）
 *
 * 入参：event.payload = {
 *   realName: string (必填，≤20),
 *   company?: string (≤60),
 *   customerType?: 'personal' | 'company',
 *   industry?: string (≤30),
 *   invoiceTitle?: string (≤60),
 *   taxNo?: string (15/18/20 位字母数字，传空表示不填),
 *   phone?: string (11 位手机号，仅作拒绝授权时的手动联系方式兜底)
 * }
 * 出参：{ code: 0, data: { user }, message: 'ok' }
 * 失败：1001 未登录 / 2002 参数非法
 *
 * 安全要点：
 *   1) openid 仅取 cloud.getWXContext().OPENID，忽略前端传入；
 *   2) 只写白名单字段，role / addresses / privacyAgreedAt 等一律不动；
 *   3) 用户记录不存在时先要求登录，不擅自建档。
 */
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const users = db.collection('users');

function ok(data) {
  return { code: 0, data: data === undefined ? null : data, message: 'ok' };
}

function fail(code, message) {
  return { code, data: null, message };
}

function safeString(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

/** 手机号脱敏：173****3179 */
function maskPhone(phone) {
  const s = String(phone || '');
  if (/^\d{11}$/.test(s)) return s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-4);
  return s ? '****' : '';
}

/** 对外返回的用户信息（手机号一律脱敏，与 login 云函数同口径） */
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

exports.main = async (event) => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) {
      console.error('[saveProfile] 无法获取 OPENID');
      return fail(1001, '请先登录');
    }

    const payload = (event && event.payload) || {};
    const realName = safeString(payload.realName, 20);
    if (!realName) {
      return fail(2002, '请填写真实姓名');
    }
    const customerType = payload.customerType === 'company' ? 'company' : 'personal';
    const taxNo = safeString(payload.taxNo, 20).toUpperCase().replace(/[\s-]/g, '');
    if (taxNo && !/^(?:[0-9A-Z]{15}|[0-9A-Z]{18}|[0-9A-Z]{20})$/.test(taxNo)) {
      return fail(2002, '税号格式不正确（15 / 18 / 20 位字母数字）');
    }
    const phone = safeString(payload.phone, 20);
    if (phone && !/^1[3-9]\d{9}$/.test(phone)) {
      return fail(2002, '手机号格式不正确');
    }

    const patch = {
      realName: realName,
      company: safeString(payload.company, 60),
      customerType: customerType,
      industry: safeString(payload.industry, 30),
      invoiceTitle: safeString(payload.invoiceTitle, 60),
      taxNo: taxNo,
      updatedAt: Date.now()
    };

    const existing = await users.where({ openid }).limit(1).get();
    if (!existing.data || !existing.data.length) {
      return fail(1001, '请先登录');
    }
    const user = existing.data[0];
    // 手动联系方式仅在用户未授权手机号时兜底，绝不覆盖已授权号码
    if (phone && !user.phone) patch.phone = phone;

    await users.doc(user._id).update({ data: patch });
    const updated = Object.assign({}, user, patch);
    return ok({ user: toPublicUser(updated) });
  } catch (err) {
    console.error('[saveProfile] 保存失败', err);
    return fail(2002, '保存失败，请重试');
  }
};
