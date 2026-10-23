/**
 * 登录与手机号授权（REQ-042、REQ-043、REQ-050）
 * - login()：调用 login 云函数获取 openid 与用户记录（openid 仅由云端返回）
 * - getPhoneNumber()：处理授权按钮回调，解密手机号并返回脱敏结果
 * - requireLogin()：登录态检查，浏览类放行、交易类引导登录
 * - 拒绝授权降级：暴露手动填写联系方式的能力
 */
const { callFunction } = require('./request.js');

/** 安全获取 App 实例（模块加载期 app 可能尚未就绪） */
function getAppInstance() {
  try {
    return getApp();
  } catch (err) {
    return null;
  }
}

/** 读取本地缓存的 openid */
function getOpenid() {
  const app = getAppInstance();
  if (app && app.globalData && app.globalData.openid) return app.globalData.openid;
  try {
    return wx.getStorageSync('openid') || '';
  } catch (err) {
    return '';
  }
}

/** 读取本地缓存的用户记录 */
function getLocalUser() {
  const app = getAppInstance();
  if (app && app.globalData && app.globalData.user) return app.globalData.user;
  try {
    return wx.getStorageSync('user') || null;
  } catch (err) {
    return null;
  }
}

/** 是否已登录 */
function isLoggedIn() {
  return !!getOpenid();
}

/** 写入登录态到内存与本地缓存 */
function persistAuth(openid, user) {
  const app = getAppInstance();
  if (app && app.globalData) {
    app.globalData.openid = openid || '';
    app.globalData.user = user || null;
  }
  try {
    wx.setStorageSync('openid', openid || '');
    wx.setStorageSync('user', user || null);
  } catch (err) {
    console.warn('[auth] 缓存登录态失败', err);
  }
}

/**
 * 登录：调用 login 云函数换取 openid 与用户记录。
 * 仅需用户确认授权，无需账号密码（REQ-042）。
 * @param {object} [profile] 可选的昵称/头像（用户拒绝授权时可不传）
 * @returns {Promise<{openid:string, user:object}>}
 */
function login(profile) {
  const payload = {};
  if (profile && profile.nickName) payload.nickName = profile.nickName;
  if (profile && profile.avatarUrl) payload.avatarUrl = profile.avatarUrl;

  return callFunction('login', {
    payload: payload,
    showError: true
  }).then((data) => {
    const openid = (data && data.openid) || '';
    const user = (data && data.user) || null;
    persistAuth(openid, user);
    return { openid: openid, user: user };
  });
}

/**
 * 登录态检查：已登录直接放行；未登录弹出引导并尝试登录。
 * @param {object} [options]
 * @param {string} [options.message='该功能需要登录后使用'] 引导文案
 * @param {boolean} [options.silent=false] 静默模式（不发 toast，仅返回布尔）
 * @returns {Promise<boolean>} 是否已具备登录态
 */
function requireLogin(options) {
  const opts = options || {};
  if (isLoggedIn()) return Promise.resolve(true);

  return new Promise((resolve) => {
    wx.showModal({
      title: '需要登录',
      content: opts.message || '该功能需要登录后使用，是否立即登录？',
      confirmText: '立即登录',
      cancelText: '暂不',
      success: (res) => {
        if (!res.confirm) {
          resolve(false);
          return;
        }
        login()
          .then(() => resolve(true))
          .catch(() => {
            if (!opts.silent) {
              wx.showToast({ title: '登录失败，请重试', icon: 'none' });
            }
            resolve(false);
          });
      },
      fail: () => resolve(false)
    });
  });
}

/**
 * 处理手机号授权按钮回调，解密并返回脱敏手机号（REQ-043、REQ-050）。
 * 前置：必须由用户主动点击授权按钮触发。
 * @param {object} e 授权按钮事件，e.detail.cloudID
 * @returns {Promise<{phone:string, phoneMasked:string}>}
 */
function getPhoneNumber(e) {
  const cloudID = e && e.detail && e.detail.cloudID;
  if (!cloudID) {
    return Promise.reject({
      code: 2001,
      message: '未获取到授权凭证，请重试',
      retriable: true
    });
  }
  return callFunction('getPhoneNumber', {
    payload: { cloudID: cloudID },
    showError: true
  }).then((data) => {
    // 授权成功后同步更新本地用户记录中的手机号
    const user = getLocalUser() || {};
    if (data && data.phone) {
      user.phone = data.phone;
      persistAuth(getOpenid(), user);
    }
    return data || {};
  });
}

/**
 * 拒绝手机号授权时的降级：允许手动填写联系方式（REQ-050）。
 * 页面据此切换到手动输入表单，不影响下单流程。
 * @returns {{manualInput:boolean, hint:string}}
 */
function useManualContact() {
  return {
    manualInput: true,
    hint: '未授权手机号，请手动填写联系电话'
  };
}

/** 退出登录（清空本地登录态，主要用于调试） */
function logout() {
  persistAuth('', null);
}

module.exports = {
  login,
  getPhoneNumber,
  requireLogin,
  isLoggedIn,
  getOpenid,
  getLocalUser,
  useManualContact,
  logout,
  persistAuth
};