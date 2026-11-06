/**
 * 云函数：getAddresses —— 按需读取当前用户的完整收货地址
 * 登录接口只回展示字段（无街道门牌、无明文手机号）。
 * 地址管理与下单确认时再调用本函数取完整地址，调用方不应把它写入长期缓存。
 * 入参：event.payload 可空
 * 出参：{ code: 0, data: { addresses } } / 1001 未登录
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

exports.main = async () => {
  try {
    const wxContext = cloud.getWXContext();
    const openid = wxContext && wxContext.OPENID;
    if (!openid) return fail(1001, '请先登录');

    const existing = await users.where({ openid }).orderBy('_id', 'asc').limit(1).get();
    const user = existing.data && existing.data[0];
    const list = user && Array.isArray(user.addresses) ? user.addresses : [];
    const addresses = list.filter(Boolean).map((a) => ({
      addressId: safeString(a.addressId, 60),
      name: safeString(a.name, 30),
      phone: safeString(a.phone, 20),
      province: safeString(a.province, 20),
      city: safeString(a.city, 20),
      county: safeString(a.county, 20),
      detailInfo: safeString(a.detailInfo, 200),
      detail: safeString(a.detail, 200),
      isDefault: a.isDefault === true
    }));
    return ok({ addresses: addresses });
  } catch (err) {
    console.error('[getAddresses] error', err);
    return fail(1001, '请先登录');
  }
};
