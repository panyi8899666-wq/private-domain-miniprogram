/**
 * 对接设计师窗口（Muse）
 * - 展示对接设计师身份、职责与对接流程，是客户与后台对接的完整入口页
 * - 入口聚合：去定制下单、查看我的订单、联系商家（全部复用既有流程）
 * - 对接为异步订单留言（订单详情“对接留言”区），不是实时聊天；
 *   需求与报价仍走既有订单流程，最终方案与交付由工作室确认
 */
const { DESIGNER } = require('../../utils/constants');

/** 商家联系电话：与 mine / order-detail 既有商家电话一致，不新增联系方式 */
const CONTACT_PHONE = '17306983179';

Page({
  data: {
    designer: DESIGNER,
    steps: [
      {
        no: '01',
        title: '提交需求',
        desc: '在定制页提交材质、规格、工艺与数量，或在商城直接下单。'
      },
      {
        no: '02',
        title: 'Muse 整理对接',
        desc: '把需求整理成正式需求单，对接报价与进度跟进。'
      },
      {
        no: '03',
        title: '工作室确认',
        desc: '最终方案、报价与交付由工作室确认后进入制作。'
      },
      {
        no: '04',
        title: '跟进到交付',
        desc: '按订单详情里的进度跟进，直至订单完成。'
      }
    ],
    faqs: [
      {
        q: 'Muse 是谁？',
        a: '对接设计师，负责需求整理、报价对接与进度跟进；最终方案与交付由工作室确认。'
      },
      {
        q: '能在小程序里直接和 Muse 实时聊天吗？',
        a: '不能实时聊天，但下单后可以在订单详情的“对接留言”里留言，对接设计师会按订单回复；报价与方案仍需工作室确认后发出。'
      },
      {
        q: '报价由谁定？',
        a: '报价走既有报价流程，最终由工作室确认；本页不显示价格。'
      },
      {
        q: '制作周期能在这里承诺吗？',
        a: '不能。制作周期须与生产确认后再回复，本页不单独承诺。'
      }
    ]
  },

  /** 去定制下单 */
  goCustom() {
    wx.navigateTo({ url: '/pages/custom/custom' });
  },

  /** 查看我的订单 */
  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' });
  },

  /** 联系商家（复用既有电话沟通入口） */
  goContact() {
    wx.makePhoneCall({
      phoneNumber: CONTACT_PHONE,
      fail: () => {
        wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' });
      }
    });
  }
});
