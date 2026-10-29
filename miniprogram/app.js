/**
 * 小程序全局入口
 * - 云开发初始化
 * - 全局登录态与用户信息缓存
 * - 隐私同意状态检查（REQ-051）
 *
 * ⚠️ 部署前必须将 CLOUD_ENV_ID 替换为真实的云开发环境 ID，详见 miniprogram/README.md
 */
const CLOUD_ENV_ID = 'cloud1-d0get66qf4fc7987f'; // 2026-10-29 填入微信体验版环境 ID

App({
  globalData: {
    /** 云开发环境 ID（微信体验版环境） */
    envId: CLOUD_ENV_ID,
    /** 当前用户 openid（由云端返回，前端不得自行生成） */
    openid: '',
    /** 当前用户记录（users 集合） */
    user: null,
    /** 是否已同意隐私政策 */
    privacyAgreed: false,
    /** 系统信息，供全面屏安全区适配使用 */
    systemInfo: null,
    /** 顶部状态栏高度（px） */
    statusBarHeight: 20
  },

  onLaunch() {
    this.initCloud();
    this.collectSystemInfo();
    this.restoreLocalAuth();
    this.checkPrivacyAgreed();
  },

  /**
   * 初始化云开发能力。
   * 若环境 ID 仍为占位值，仅打印告警而不中断启动（便于无云环境时预览静态页面）。
   */
  initCloud() {
    if (!wx.cloud) {
      console.error('[app] 当前基础库版本过低，无法使用云开发能力，请升级微信版本');
      return;
    }
    if (!CLOUD_ENV_ID || CLOUD_ENV_ID === 'YOUR_ENV_ID') {
      console.warn('[app] 云开发环境 ID 尚未配置，请在 miniprogram/app.js 中替换 CLOUD_ENV_ID');
    }
    try {
      wx.cloud.init({
        env: CLOUD_ENV_ID,
        traceUser: true
      });
    } catch (err) {
      console.error('[app] 云开发初始化失败', err);
    }
  },

  /** 采集系统信息，供页面做全面屏安全区适配（DFX §4.5.4） */
  collectSystemInfo() {
    try {
      const info = wx.getSystemInfoSync();
      this.globalData.systemInfo = info;
      this.globalData.statusBarHeight = info.statusBarHeight || 20;
    } catch (err) {
      console.warn('[app] 获取系统信息失败', err);
    }
  },

  /** 从本地缓存恢复登录态（openid / user / 隐私同意标记） */
  restoreLocalAuth() {
    try {
      const openid = wx.getStorageSync('openid') || '';
      const user = wx.getStorageSync('user') || null;
      const privacyAgreed = !!wx.getStorageSync('privacyAgreed');
      this.globalData.openid = openid;
      this.globalData.user = user;
      this.globalData.privacyAgreed = privacyAgreed;
    } catch (err) {
      console.warn('[app] 恢复本地登录态失败', err);
    }
  },

  /** 检查隐私同意状态，未同意标记供页面展示隐私弹层（REQ-051） */
  checkPrivacyAgreed() {
    if (!this.globalData.privacyAgreed) {
      console.info('[app] 用户尚未同意隐私政策，将在需要采集信息的页面进行告知');
    }
  },

  /** 记录隐私同意状态（本地缓存 + 标记），云端落库由页面调用云函数完成 */
  markPrivacyAgreed() {
    this.globalData.privacyAgreed = true;
    try {
      wx.setStorageSync('privacyAgreed', true);
    } catch (err) {
      console.warn('[app] 写入隐私同意标记失败', err);
    }
  }
});