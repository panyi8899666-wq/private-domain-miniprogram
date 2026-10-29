/**
 * 个人中心页（tabBar，REQ-044、REQ-042、REQ-051、REQ-024）
 * - 头像/昵称区：未登录显示「点击登录」，登录调 login 云函数换取 openid 与用户记录
 * - 我的资料入口、我的订单入口、收货地址管理页（云端落库）、联系商家、对接设计师窗口、隐私协议、退出登录
 */
const auth = require('../../utils/auth');
const { maskPhone } = require('../../utils/format');

/** 商家联系电话（占位号码，上线前替换为官方客服电话） */
const CONTACT_PHONE = '17306983179';
const DEFAULT_AVATAR = '/images/avatar.png';

/** 隐私协议概要文案（REQ-051） */
const PRIVACY_TEXT =
  '为向您提供物料制作与报价下单服务，本小程序会收集您的微信昵称、头像（可选）、' +
  '手机号（仅用于订单联系与发货）及收货地址。我们承诺对以上信息严格保密，仅用于服务提供。' +
  '联系电话：' + CONTACT_PHONE + '。';

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
      phoneMasked: user.phone ? maskPhone(user.phone) : ''
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
      wx.navigateTo({ url: '/pages/profile/profile' });
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
      wx.navigateTo({ url: '/pages/addresses/addresses' });
    });
  },

  /** 对接设计师窗口 */
  goDesigner() {
    wx.navigateTo({ url: '/pages/designer/designer' });
  },

  /** 联系商家 */
  goContact() {
    wx.makePhoneCall({
      phoneNumber: CONTACT_PHONE,
      fail: () => {
        wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' });
      }
    });
  },

  /** 隐私协议查看 */
  goPrivacy() {
    wx.showModal({
      title: '隐私政策',
      content: PRIVACY_TEXT,
      showCancel: false,
      confirmText: '我知道了'
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