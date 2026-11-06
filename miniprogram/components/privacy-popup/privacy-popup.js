/**
 * 隐私同意弹层：同意 / 拒绝，并可打开微信后台配置的隐私保护指引。
 * 同意按钮必须是 open-type="agreePrivacyAuthorization"，id 与 resolve 的 buttonId 一致。
 */
const privacy = require('../../utils/privacy');

Component({
  data: {
    visible: false
  },

  methods: {
    noop() {},

    open() {
      if (this._pending) return this._pending;
      this.setData({ visible: true });
      this._pending = new Promise((resolve) => {
        this._done = resolve;
      });
      return this._pending;
    },

    onAgree() {
      const app = getApp();
      if (app && typeof app.privacyResolve === 'function') {
        app.privacyResolve({ buttonId: 'agree-btn', event: 'agree' });
        app.privacyResolve = null;
      }
      privacy.saveConsent()
        .then(() => {
          this.setData({ visible: false });
          this.finish(true);
        })
        .catch(() => {
          wx.showToast({ title: '同意状态保存失败，请重试', icon: 'none' });
        });
    },

    onDecline() {
      const app = getApp();
      if (app && typeof app.privacyResolve === 'function') {
        app.privacyResolve({ event: 'disagree' });
        app.privacyResolve = null;
      }
      this.setData({ visible: false });
      wx.showToast({ title: '需同意隐私政策后才能继续', icon: 'none' });
      this.finish(false);
    },

    finish(ok) {
      const done = this._done;
      this._done = null;
      this._pending = null;
      if (done) done(!!ok);
    }
  }
});
