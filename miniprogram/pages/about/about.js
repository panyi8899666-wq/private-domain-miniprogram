/**
 * 关于我们 / 工作室介绍（C-NAV@1 · R9.5）
 *
 * 内容：品牌名（正鑫越文化工作室）、业务范围（广告物料制作）、服务能力与联系方式。
 * 联系方式：优先读取统一常量 utils/constants.js#CONTACT（C-CONTACT@1，由 T9 提供）；
 *          常量缺失时做空值兜底，不硬编码任何号码。
 *
 * 合规：本页不展示个人收款码 / 加好友二维码 / 转账引导（R8.1）。
 * 素材：本页未引用任何本地图片资源（miniprogram/images 未 checkout）；
 *      如需品牌 Logo / 插图，需用户提供素材后再接入（标注：需用户提供素材）。
 */
const constants = require('../../utils/constants');

/** 统一联系方式（C-CONTACT@1）；常量未就绪时为空对象，保证页面不报错且不硬编码号码 */
const CONTACT = constants.CONTACT || {};

Page({
  data: {
    brandName: '正鑫越文化工作室',
    businessScope: '广告物料制作',
    slogan: '专注广告物料制作与视觉落地',
    intro:
      '正鑫越文化工作室专注广告物料制作，业务覆盖发光字、灯箱标识、喷绘写真、印刷品、' +
      '户外标识与 3D 设计等，从设计打样到生产安装提供一站式服务。',
    services: [
      { name: '发光字制作', desc: '吸塑 / 平面 / 围边 / 迷你字等工艺，室内外均可' },
      { name: '灯箱与标识字', desc: '灯箱、招牌与标识字，兼顾夜间效果与耐久' },
      { name: '喷绘写真', desc: '户内外喷绘、写真、KT 板等物料制作' },
      { name: '印刷品', desc: '名片、传单、画册等印刷类物料' },
      { name: '户外标识', desc: '户外导向标识与安装' },
      { name: '3D 设计与展台美陈', desc: '品牌视觉、3D 效果图与展台美陈' }
    ],
    contact: {
      name: CONTACT.name || '正鑫越文化工作室',
      phone: CONTACT.phone || '',
      hasPhone: !!CONTACT.phone
    }
  },

  /** 拨打联系方式：读取统一常量，缺失时提示待配置（不硬编码号码） */
  onCall() {
    const phone = (this.data.contact && this.data.contact.phone) || '';
    if (!phone) {
      wx.showToast({ title: '客服电话待配置', icon: 'none' });
      return;
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: () => wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' })
    });
  },

  /** 去商城逛逛（复用既有 tabBar 页面） */
  goShop() {
    wx.switchTab({ url: '/pages/shop/shop' });
  },

  /** 去定制下单 */
  goCustom() {
    wx.navigateTo({ url: '/pages/custom/custom' });
  }
});