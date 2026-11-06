/**
 * 隐私授权：微信隐私接口（需授权时弹自定义同意层）+ 服务端同意记录。
 * 弹层需挂在当前页 <privacy-popup id="privacy-popup" />。
 */
const { callFunction } = require('./request');
const auth = require('./auth');
const { PRIVACY_POLICY_VERSION, hasActiveConsent } = require('./consent');

let popupPromise = null;

function getPopup() {
  try {
    const pages = getCurrentPages();
    const page = pages[pages.length - 1];
    if (!page || typeof page.selectComponent !== 'function') return null;
    return page.selectComponent('#privacy-popup');
  } catch (err) {
    return null;
  }
}

function openPopup() {
  if (popupPromise) return popupPromise;
  const start = (attempt) => {
    const popup = getPopup();
    if (popup && typeof popup.open === 'function') {
      popupPromise = popup.open().then(
        (ok) => {
          popupPromise = null;
          return !!ok;
        },
        () => {
          popupPromise = null;
          return false;
        }
      );
      return popupPromise;
    }
    if (attempt < 3) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(start(attempt + 1)), 50);
      });
    }
    wx.showToast({ title: '请先阅读并同意隐私政策', icon: 'none' });
    return Promise.resolve(false);
  };
  return start(0);
}

/** 由 app.onLaunch 注册。隐私接口被拦截时只记下 resolve，并打开当前页弹层。 */
function bindPrivacyAuthorization() {
  if (typeof wx.onNeedPrivacyAuthorization !== 'function') return;
  wx.onNeedPrivacyAuthorization((resolve) => {
    const app = getApp();
    if (app) app.privacyResolve = resolve;
    openPopup();
  });
}

function saveConsent() {
  return callFunction('savePrivacyConsent', {
    payload: { action: 'agree', version: PRIVACY_POLICY_VERSION },
    loading: true,
    showError: true
  }).then((data) => {
    const prev = auth.getLocalUser() || {};
    const user = Object.assign({}, prev, (data && data.user) || {});
    user.privacyAgreedAt = user.privacyAgreedAt || Date.now();
    user.privacyConsentVersion = PRIVACY_POLICY_VERSION;
    user.privacyWithdrawnAt = 0;
    auth.persistAuth(auth.getOpenid(), user);
    try {
      const app = getApp();
      if (app && typeof app.markPrivacyAgreed === 'function') app.markPrivacyAgreed();
    } catch (err) { /* app 未就绪时忽略 */ }
    return data;
  });
}

function withdrawConsent() {
  return callFunction('savePrivacyConsent', {
    payload: { action: 'withdraw' },
    loading: true,
    showError: true,
    lockKey: 'withdrawPrivacy'
  }).then((data) => {
    const user = (data && data.user) || {
      privacyAgreedAt: 0,
      privacyConsentVersion: '',
      privacyWithdrawnAt: Date.now(),
      privacyDeletionRequestedAt: Date.now(),
      hasPhone: false,
      phone: '',
      phoneMasked: '',
      addresses: []
    };
    auth.persistAuth(auth.getOpenid(), user);
    try {
      const app = getApp();
      if (app && app.globalData) app.globalData.privacyAgreed = false;
      wx.removeStorageSync('privacyAgreed');
    } catch (err) { /* ignore */ }
    return data;
  });
}

/**
 * 资料、地址、下单前调用。
 * 微信侧仍需授权时走 requirePrivacyAuthorize（会触发 onNeedPrivacyAuthorization）；
 * 服务端没有当前版本的同意记录时，同样弹出同意 / 拒绝。
 */
function ensurePrivacyConsent() {
  const serverOk = () => hasActiveConsent(auth.getLocalUser());
  if (typeof wx.getPrivacySetting !== 'function') {
    if (serverOk()) return Promise.resolve(true);
    return openPopup();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(!!ok);
    };
    const afterWx = () => {
      if (serverOk()) {
        finish(true);
        return;
      }
      openPopup().then(finish);
    };
    wx.getPrivacySetting({
      success: (res) => {
        if (res && res.needAuthorization && typeof wx.requirePrivacyAuthorize === 'function') {
          wx.requirePrivacyAuthorize({
            success: () => afterWx(),
            fail: () => finish(false)
          });
          return;
        }
        afterWx();
      },
      fail: () => afterWx()
    });
  });
}

module.exports = {
  PRIVACY_POLICY_VERSION,
  hasActiveConsent,
  bindPrivacyAuthorization,
  openPopup,
  saveConsent,
  withdrawConsent,
  ensurePrivacyConsent
};
