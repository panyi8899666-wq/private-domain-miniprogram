/**
 * 客户注册资料与下单前校验（第一批注册入口）
 * - getProfile()：从本地用户缓存读客户资料（登录云函数返回的公开字段）
 * - getDefaultAddress()：取默认收货地址（无默认时取第一条）
 * - checkOrderReady()：下单三项必备：姓名、手机号、收货地址
 * - requireOrderProfile()：资料不全时弹窗引导去资料页补齐，返回 false 中断下单
 * - saveProfile() / saveAddresses()：调云函数保存并合并本地缓存（手机号脱敏不覆盖本地完整号）
 */
const auth = require('./auth');
const { callFunction } = require('./request');

/** 从本地缓存读客户资料（未登录返回空资料） */
function getProfile() {
  const u = auth.getLocalUser() || {};
  return {
    realName: u.realName || '',
    company: u.company || '',
    customerType: u.customerType || 'personal',
    industry: u.industry || '',
    invoiceTitle: u.invoiceTitle || '',
    taxNo: u.taxNo || '',
    phone: u.phone || '',
    addresses: Array.isArray(u.addresses) ? u.addresses : []
  };
}

/** 默认收货地址（无默认标记时取第一条） */
function getDefaultAddress() {
  const list = getProfile().addresses;
  if (!list.length) return null;
  return list.find((a) => a && a.isDefault) || list[0];
}

/**
 * 下单前资料检查
 * @returns {{ok:boolean, missing:string[]}} missing 为缺失项中文名
 */
function checkOrderReady() {
  const p = getProfile();
  const missing = [];
  if (!p.realName) missing.push('姓名');
  if (!p.phone) missing.push('手机号');
  if (!getDefaultAddress()) missing.push('收货地址');
  return { ok: missing.length === 0, missing: missing };
}

/**
 * 下单前资料校验：未登录先走登录引导；资料不全弹窗引导去资料页
 * @returns {Promise<boolean>} 是否可继续下单
 */
function requireOrderProfile() {
  if (!auth.isLoggedIn()) {
    return auth.requireLogin({ message: '下单需要登录后使用，是否立即登录？' }).then((ok) => {
      if (!ok) return false;
      return requireOrderProfile();
    });
  }
  const checked = checkOrderReady();
  if (checked.ok) return Promise.resolve(true);
  return new Promise((resolve) => {
    wx.showModal({
      title: '请先完善客户资料',
      content: '下单需要：' + checked.missing.join('、') + '，去完善后即可下单。',
      confirmText: '去完善',
      cancelText: '暂不',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({ url: '/pages/profile/profile' });
        }
        resolve(false);
      },
      fail: () => resolve(false)
    });
  });
}

/** 合并云端返回的公开用户信息到本地缓存（脱敏手机号不覆盖本地完整号） */
function mergeUser(patch) {
  const user = auth.getLocalUser() || {};
  const localPhone = user.phone || '';
  Object.assign(user, patch || {});
  if (patch && patch.phone && patch.phone.indexOf('*') >= 0 && /^\d{11}$/.test(localPhone)) {
    user.phone = localPhone;
  }
  auth.persistAuth(auth.getOpenid(), user);
}

/** 保存客户资料（姓名/公司/类型/行业/开票），服务端校验 */
function saveProfile(payload) {
  return callFunction('saveProfile', {
    payload: payload || {},
    loading: true,
    showError: true,
    lockKey: 'saveProfile'
  }).then((data) => {
    if (data && data.user) mergeUser(data.user);
    return data;
  });
}

/** 全量保存收货地址列表（服务端校验与默认归一） */
function saveAddresses(addresses) {
  return callFunction('saveAddresses', {
    payload: { addresses: addresses || [] },
    loading: true,
    showError: true,
    lockKey: 'saveAddresses'
  }).then((data) => {
    const user = auth.getLocalUser() || {};
    user.addresses = (data && data.addresses) || [];
    auth.persistAuth(auth.getOpenid(), user);
    return data;
  });
}

module.exports = {
  getProfile,
  getDefaultAddress,
  checkOrderReady,
  requireOrderProfile,
  saveProfile,
  saveAddresses
};
