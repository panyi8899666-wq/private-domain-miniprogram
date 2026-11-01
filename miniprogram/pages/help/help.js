/**
 * 帮助 / 售后 / 常见问题（C-NAV@1 · R9.2、R9.5）
 *
 * 内容：下单流程、配置式下单说明、常见问题与售后联系方式。
 * 联系方式：读取统一常量 utils/constants.js#CONTACT（C-CONTACT@1，由 T9 提供）；
 *          常量缺失时做空值兜底，不硬编码任何号码。
 *
 * 合规：本页不承诺具体价格或制作周期（与 designer 页口径一致），
 *      不展示收款码 / 二维码 / 转账引导（R8.1）。
 * 素材：本页未引用任何本地图片资源（miniprogram/images 未 checkout）；如需插图需用户提供素材。
 */
const constants = require('../../utils/constants');

/** 统一联系方式（C-CONTACT@1）；常量未就绪时为空对象，保证页面不报错且不硬编码号码 */
const CONTACT = constants.CONTACT || {};

Page({
  data: {
    steps: [
      { no: '01', title: '浏览与选择', desc: '在作品集、商城或材质百科了解物料与案例。' },
      { no: '02', title: '配置式下单', desc: '在商城或材质页选择规格与数量，直接提交订单。' },
      { no: '03', title: '提交定制需求', desc: '定制页填写材质、工艺与数量并上传参考图，等待报价。' },
      { no: '04', title: '支付与跟进', desc: '确认报价后完成支付，按订单详情跟进制作与交付。' }
    ],
    configTips: [
      '配置式下单 = 选择材质 → 选择规格 / 数量 → 提交订单，价格由系统按规格单价 × 数量 + 运费核算。',
      '所选规格不可生产时，请改在「定制」页提交需求，由工作室对接报价。',
      '提交前请确认收货信息完整，避免下单被拦截。'
    ],
    faqs: [
      {
        q: '如何下单？',
        a: '在商城或材质百科选择物料，进入配置式下单页选择规格与数量后提交；定制需求请在「定制」页提交。',
        open: false
      },
      {
        q: '什么是配置式下单？',
        a: '按系统内置规格直接下单，价格由服务端核算，无需等待人工报价。',
        open: false
      },
      {
        q: '定制需求怎么提交？',
        a: '在「定制」页填写材质、数量并上传参考图，提交后由工作室对接报价。',
        open: false
      },
      {
        q: '支持哪些支付方式？',
        a: '仅支持微信官方支付，不提供其他收款方式。',
        open: false
      },
      {
        q: '价格与制作周期能在这里确认吗？',
        a: '不能。价格与周期须与生产确认后由工作室统一回复，本页不作承诺。',
        open: false
      },
      {
        q: '如何售后？',
        a: '优先通过「我的订单 → 订单详情 → 对接留言」留言并保留订单号，也可通过在线客服或电话联系。',
        open: false
      }
    ],
    afterSale: [
      '售后请优先在订单详情的「对接留言」中说明问题，并保留订单号便于核对。',
      '也可通过本页「在线客服」或「拨打电话」联系工作室统一对接。',
      '已支付订单如需退改，请联系工作室协商处理。'
    ],
    contact: {
      name: CONTACT.name || '正鑫越文化工作室',
      phone: CONTACT.phone || '',
      hasPhone: !!CONTACT.phone
    }
  },

  /** 展开 / 收起某条常见问题 */
  onToggleFaq(e) {
    const index = Number(e.currentTarget.dataset.index);
    const faqs = this.data.faqs.map((item, i) => {
      if (i !== index) return item;
      return { q: item.q, a: item.a, open: !item.open };
    });
    this.setData({ faqs: faqs });
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

  /** 去定制下单 */
  goCustom() {
    wx.navigateTo({ url: '/pages/custom/custom' });
  },

  /** 查看我的订单 */
  goOrders() {
    wx.navigateTo({ url: '/pages/orders/orders' });
  }
});