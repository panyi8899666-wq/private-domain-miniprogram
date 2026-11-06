/**
 * 个人中心页（tabBar，REQ-044、REQ-042、REQ-051、REQ-024）
 * - 头像/昵称区：未登录显示「点击登录」，登录调 login 云函数换取 openid 与用户记录
 * - 我的资料入口、我的订单入口、收货地址管理页（云端落库）、联系商家、对接设计师窗口、隐私协议、退出登录
 */
const auth = require('../../utils/auth');
const privacy = require('../../utils/privacy');
const { maskPhone } = require('../../utils/format');
const { isFullMobile } = require('../../utils/phone');
const { CONTACT } = require('../../utils/constants');

const DEFAULT_AVATAR = '/images/avatar.png';

/** 隐私协议概要文案（REQ-051） */
const PRIVACY_TEXT =
  '为向您提供物料制作与报价下单服务，本小程序会收集您的微信昵称、头像（可选）、' +
  '手机号（仅用于订单联系与发货）及收货地址。我们承诺对以上信息严格保密，仅用于服务提供。' +
  '联系电话：' + CONTACT.phone + '。';

Page({
  data: {
    isLogin: false,
    avatar: DEFAULT_AVATAR,
    nickName: '点击登录',
    phoneMasked: ''
  },

  onShow() {
    this.refreshUser();
  },

  /** 刷新登录态与用户信息展示 */
  refreshUser() {
    const isLogin = auth.isLoggedIn();
    const user = auth.getLocalUser() || {};
    this.setData({
      isLogin: isLogin,
      avatar: (user.avatarUrl || DEFAULT_AVATAR),
      nickName: isLogin ? (user.nickName || '微信用户') : '点击登录',
      phoneMasked: user.phoneMasked || (isFullMobile(user.phone) ? maskPhone(user.phone) : '')
    });
  },

  /** 点击登录（未登录时） */
  onLoginTap() {
    if (this.data.isLogin) return;
    auth
      .login()
      .then(() => {
        this.refreshUser();
      })
      .catch(() => {
        // 登录失败提示由 login 云函数 / request.js 统一处理
      });
  },

  /** 头像加载失败回退默认头像 */
  onAvatarError() {
    if (this.data.avatar !== DEFAULT_AVATAR) {
      this.setData({ avatar: DEFAULT_AVATAR });
    }
  },

  /** 我的资料 */
  goProfile() {
    this.ensureLogin(() => {
      privacy.ensurePrivacyConsent().then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/profile/profile' });
      });
    });
  },

  /** 我的订单 */
  goOrders() {
    this.ensureLogin(() => {
      wx.navigateTo({ url: '/pages/orders/orders' });
    });
  },

  /** 收货地址管理（第一批注册入口：独立管理页，落库到云端） */
  goAddresses() {
    this.ensureLogin(() => {
      privacy.ensurePrivacyConsent().then((ok) => {
        if (ok) wx.navigateTo({ url: '/pages/addresses/addresses' });
      });
    });
  },

  /** 对接设计师窗口 */
  goDesigner() {
    wx.navigateTo({ url: '/pages/designer/designer' });
  },

  /** 联系商家（电话来源统一为 C-CONTACT@1 的 CONTACT.phone） */
  goContact() {
    wx.makePhoneCall({
      phoneNumber: CONTACT.phone,
      fail: () => {
        wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' });
      }
    });
  },

  /** 关于我们（路由约定见 C-NAV@1，页面由 T10 创建） */
  goAbout() {
    wx.navigateTo({
      url: '/pages/about/about',
      fail: () => {
        wx.showToast({ title: '页面建设中', icon: 'none' });
      }
    });
  },

  /** 帮助/售后（路由约定见 C-NAV@1，页面由 T10 创建） */
  goHelp() {
    wx.navigateTo({
      url: '/pages/help/help',
      fail: () => {
        wx.showToast({ title: '页面建设中', icon: 'none' });
      }
    });
  },

  /**
   * 微信客服入口（C-CONTACT@1）
   * 官方标准入口为 WXML 的 <button open-type="contact">，需业务方在微信后台开通客服（外部前置）；
   * 本任务 write_set 仅含 JS 文件，暂未落地该按钮，本方法为 JS 侧入口，待 mine.wxml 绑定
   * bindtap="goCustomerService" 后即可生效。
   * 平台支持企业微信客服会话（wx.openCustomerServiceChat）时优先打开，配置缺失或能力不可用时降级拨打统一客服电话。
   */
  goCustomerService() {
    if (typeof wx.openCustomerServiceChat === 'function') {
      try {
        wx.openCustomerServiceChat({
          extInfo: { url: '' },
          corpId: '',
          url: '',
          fail: () => {
            this.goContact();
          }
        });
        return;
      } catch (e) {
        // 平台能力或客服配置不可用，降级到电话客服
      }
    }
    this.goContact();
  },

  /** 隐私协议查看：优先打开微信后台配置的隐私保护指引 */
  goPrivacy() {
    if (typeof wx.openPrivacyContract === 'function') {
      wx.openPrivacyContract({
        fail: () => {
          wx.showModal({
            title: '隐私政策',
            content: PRIVACY_TEXT,
            showCancel: false,
            confirmText: '我知道了'
          });
        }
      });
      return;
    }
    wx.showModal({
      title: '隐私政策',
      content: PRIVACY_TEXT,
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  /** 撤回隐私同意，并提交资料删除申请（订单与支付记录需商家人工处理） */
  onWithdrawPrivacy() {
    if (!this.data.isLogin) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '撤回同意并申请删除',
      content: '撤回后将无法继续下单，并清除已保存的资料与地址。历史订单里的联系方式需商家人工删除。确定继续吗？',
      confirmText: '确定撤回',
      cancelText: '取消',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (!res.confirm) return;
        privacy.withdrawConsent()
          .then(() => {
            this.refreshUser();
            wx.showToast({ title: '已撤回并提交删除申请', icon: 'none' });
          })
          .catch(() => {});
      }
    });
  },

  /** 退出登录 */
  onLogout() {
    if (!this.data.isLogin) return;
    wx.showModal({
      title: '退出登录',
      content: '确定退出当前账号吗？',
      confirmText: '退出',
      cancelText: '取消',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (res.confirm) {
          auth.logout();
          this.refreshUser();
        }
      }
    });
  },

  /** 登录态校验：未登录则引导登录后执行回调 */
  ensureLogin(callback) {
    auth.requireLogin({ message: '该功能需要登录后使用，是否立即登录？' }).then((ok) => {
      if (ok) {
        this.refreshUser();
        callback();
      }
    });
  }
});