/**
 * 手机号与地址展示字段。
 * 脱敏串只放 phoneMasked，绝不写入资料里的 phone。
 * 完整度判断集中在 hasContactPhone，页面不要再各写一套。
 */
const { maskPhone } = require('./format');

function isFullMobile(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
}

function hasContactPhone(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.hasPhone === true) return true;
  return isFullMobile(user.phone);
}

function toDisplayAddress(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const raw = typeof addr.phone === 'string' ? addr.phone.trim() : '';
  let phoneMasked = '';
  if (isFullMobile(raw)) phoneMasked = maskPhone(raw);
  else if (raw.indexOf('*') !== -1) phoneMasked = raw;
  else if (addr.phoneMasked) phoneMasked = String(addr.phoneMasked);
  const province = addr.province || '';
  const city = addr.city || '';
  const county = addr.county || '';
  return {
    addressId: addr.addressId || '',
    name: addr.name || '',
    phoneMasked: phoneMasked,
    province: province,
    city: city,
    county: county,
    regionText: [province, city, county].filter(Boolean).join(' '),
    isDefault: addr.isDefault === true
  };
}

/** 写入本地登录态前归一：去掉脱敏手机号与详细地址。 */
function normalizeUserRecord(user) {
  if (!user || typeof user !== 'object') return user;
  const next = Object.assign({}, user);
  const raw = String(next.phone || '');
  if (raw.indexOf('*') !== -1) {
    if (!next.phoneMasked) next.phoneMasked = raw;
    if (next.hasPhone !== false) next.hasPhone = true;
    next.phone = '';
  } else if (isFullMobile(raw)) {
    next.hasPhone = true;
    if (!next.phoneMasked) next.phoneMasked = maskPhone(raw);
  } else if (next.hasPhone === true) {
    next.phone = '';
  } else {
    next.phone = '';
    next.hasPhone = false;
  }
  if (Array.isArray(next.addresses)) {
    next.addresses = next.addresses.map(toDisplayAddress).filter(Boolean);
  }
  return next;
}

function missingOrderProfile(profile) {
  const p = profile || {};
  const missing = [];
  if (!String(p.realName || '').trim()) missing.push('姓名');
  if (!hasContactPhone(p)) missing.push('手机号');
  const list = Array.isArray(p.addresses) ? p.addresses : [];
  const address = list.find((a) => a && a.isDefault) || list[0];
  if (!address) missing.push('收货地址');
  return missing;
}

module.exports = {
  isFullMobile,
  hasContactPhone,
  toDisplayAddress,
  normalizeUserRecord,
  missingOrderProfile
};
