/**
 * 订单详情页（REQ-036、REQ-031、REQ-032、REQ-038~040）
 * - 订单完整信息 + 状态时间线 + 按状态计算的操作用按钮
 * - 待付款 → 「去支付」createPayment + wx.requestPayment；待报价/待付款 → 「取消订单」cancelOrder
 * - 制作中/已完成 → 「联系商家」wx.makePhoneCall
 * - 数据源：getOrderDetail({ payload: { orderId } })；orderId 取 query.id / query.orderId
 */
const { callFunction } = require('../../utils/request');
const { formatAmount, formatTime, maskPhone } = require('../../utils/format');
const { ORDER_STATUS_TEXT, ORDER_STATUS } = require('../../utils/constants');

/** 商家联系电话（占位号码，上线前替换为官方客服电话） */
const CONTACT_PHONE = '17306983179';

/** 手机号展示脱敏：已含 * 则原样，否则脱敏 */
function displayPhone(phone) {
  const s = String(phone || '');
  if (!s) return '';
  if (s.indexOf('*') !== -1) return s;
  return maskPhone(s);
}

/** 订单概要（明细标题） */
function orderSummary(order) {
  if (!order) return '';
  if (order.type === 'custom') {
    const req = order.customRequirement || {};
    const label = req.materialType || '定制需求';
    return req.quantity ? `${label} ×${req.quantity}` : label;
  }
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length) {
    const it = items[0] || {};
    return it.name || '标准品';
  }
  return '标准品订单';
}

Page({
  data: {
    loading: true,
    loadError: null, // { error, message, retriable }
    hasOrder: false,
    order: null, // 装饰后的订单对象
    // 操作按钮标志位（按状态计算）
    canPay: false,
    canCancel: false,
    canContact: false,
    paying: false,
    cancelling: false
  },

  onLoad(query) {
    this.orderId = (query && (query.id || query.orderId)) || '';
    if (!this.orderId) {
      this.setData({
        loading: false,
        loadError: { error: true, message: '缺少订单参数', retriable: false }
      });
      return;
    }
    this.fetchDetail();
  },

  fetchDetail() {
    this.setData({ loading: true, loadError: null });
    callFunction('getOrderDetail', {
      payload: { orderId: this.orderId },
      showError: false
    })
      .then((data) => {
        const order = (data && data.order) || null;
        if (!order) {
          this.setData({
            loading: false,
            loadError: { error: true, message: '订单不存在', retriable: false }
          });
          return;
        }
        this.applyOrder(order, data);
      })
      .catch((err) => {
        this.setData({
          loading: false,
          loadError: {
            error: true,
            message: (err && err.message) || '加载失败，请重试',
            retriable: !!(err && err.retriable !== false)
          }
        });
      });
  },

  /** 装饰并渲染订单 */
  applyOrder(order, raw) {
    const status = order.status || '';
    const type = order.type || 'standard';
    const canPay = status === ORDER_STATUS.PENDING_PAYMENT;
    const canCancel =
      status === ORDER_STATUS.PENDING_PAYMENT || status === ORDER_STATUS.PENDING_QUOTE;
    const canContact =
      status === ORDER_STATUS.MAKING ||
      status === ORDER_STATUS.COMPLETED ||
      status === ORDER_STATUS.CANCELLED;

    // 状态时间线（接口单独返回 timeline 时优先，退化用 order.timeline）
    const timeline = this.decorateTimeline(
      Array.isArray(raw && raw.timeline) && raw.timeline.length
        ? raw.timeline
        : order.timeline || []
    );

    // 明细
    const items = (order.items || []).map((it, idx) => ({
      key: 'it_' + idx,
      name: it.name || '',
      specName: it.specName || '',
      unitPrice: it.unitPrice != null ? formatAmount(it.unitPrice) : '',
      quantity: it.quantity || 1
    }));

    const customRequirement = order.customRequirement || {};
    const referenceFileIds = Array.isArray(customRequirement.referenceFileIds)
      ? customRequirement.referenceFileIds
      : [];

    const address = order.address || {};
    const quote = order.quote || null;

    const decorated = {
      orderNo: order.orderNo || '',
      status: status,
      statusText: ORDER_STATUS_TEXT[status] || status || '未知',
      type: type,
      typeText: type === 'custom' ? '定制需求' : '标准品',
      summary: orderSummary(order),
      amountText:
        type === 'custom' && status === ORDER_STATUS.PENDING_QUOTE
          ? '待报价'
          : formatAmount(order.amount),
      createdAtText: formatTime(order.createdAt),
      items: items,
      customRequirement: {
        materialType: customRequirement.materialType || '',
        size: customRequirement.size || '',
        quantity: customRequirement.quantity || '',
        installPosition: customRequirement.installPosition || '',
        requirement: customRequirement.requirement || ''
      },
      referenceFileIds: referenceFileIds,
      hasReference: referenceFileIds.length > 0,
      address: {
        name: address.name || '',
        phone: displayPhone(address.phone),
        phoneRaw: address.phone || '',
        detail: address.detail || ''
      },
      hasAddress: !!(address.name || address.phone || address.detail),
      contactPhoneText: displayPhone(order.contactPhone),
      quote: {
        amount: quote ? formatAmount(quote.amount) : '',
        description: (quote && quote.description) || '',
        quotedAt: quote ? formatTime(quote.quotedAt) : '',
        validUntil: quote ? formatTime(quote.validUntil) : ''
      },
      hasQuote: !!quote,
      timeline: timeline
    };

    this.setData({
      loading: false,
      hasOrder: true,
      order: decorated,
      canPay: canPay,
      canCancel: canCancel,
      canContact: canContact
    });
  },

  /** 时间线装饰 */
  decorateTimeline(timeline) {
    return (timeline || []).map((t, idx) => ({
      key: 'tl_' + idx,
      status: t.status || '',
      statusText: ORDER_STATUS_TEXT[t.status] || t.status || '状态更新',
      at: t.at != null ? formatTime(t.at) : ''
    }));
  },

  /** 参考图预览 */
  previewRef(e) {
    const index = Number(e.currentTarget.dataset.index);
    const fileIds = this.data.order.referenceFileIds || [];
    if (!fileIds.length) return;

    // 云存储 fileID 需要先换临时链接再预览
    if (fileIds[0] && fileIds[0].indexOf('cloud://') === 0 && wx.cloud && wx.cloud.getTempFileURL) {
      wx.cloud
        .getTempFileURL({ fileList: fileIds })
        .then((res) => {
          const urls = (res.fileList || []).map((f) => f.tempFileURL || f.fileID).filter(Boolean);
          if (urls.length) {
            wx.previewImage({ urls: urls, current: urls[Math.min(index, urls.length - 1)] });
          }
        })
        .catch(() => {
          wx.showToast({ title: '图片加载失败', icon: 'none' });
        });
      return;
    }
    wx.previewImage({ urls: fileIds, current: fileIds[Math.min(index, fileIds.length - 1)] });
  },

  /** 去支付 */
  onPay() {
    if (this.data.paying) return;
    this.setData({ paying: true });
    callFunction('createPayment', {
      payload: { orderId: this.orderId },
      lockKey: 'pay:' + this.orderId,
      loading: true,
      showError: true
    })
      .then((data) => {
        const payment = (data && data.payment) || data || {};
        const payParams = {
          timeStamp: String(payment.timeStamp || ''),
          nonceStr: payment.nonceStr || '',
          package: payment.package || '',
          signType: payment.signType || 'RSA',
          paySign: payment.paySign || ''
        };
        this.setData({ paying: false });
        if (!payParams.package || !payParams.paySign) {
          wx.showToast({ title: '支付参数异常，请重试', icon: 'none' });
          return;
        }
        this.requestPayment(payParams);
      })
      .catch(() => {
        this.setData({ paying: false });
        // 错误文案已由 request.js 统一 toast（A003 支付发起失败等）
      });
  },

  /** 调起微信支付（官方 API） */
  requestPayment(payParams) {
    wx.requestPayment({
      ...payParams,
      success: () => {
        wx.showToast({ title: '支付成功', icon: 'success' });
        setTimeout(() => this.fetchDetail(), 800); // 以服务端状态刷新为准
      },
      fail: () => {
        // 取消/失败：订单保持待付款，可重新支付（REQ-040）
        wx.showToast({ title: '支付未完成，可在订单中重新支付', icon: 'none', duration: 2200 });
      }
    });
  },

  /** 取消订单（二次确认） */
  onCancel() {
    if (this.data.cancelling) return;
    wx.showModal({
      title: '取消订单',
      content: '确定取消该订单吗？取消后不可恢复。',
      confirmText: '确定取消',
      cancelText: '再想想',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (!res.confirm) return;
        this.doCancel();
      }
    });
  },

  doCancel() {
    this.setData({ cancelling: true });
    callFunction('cancelOrder', {
      payload: { orderId: this.orderId },
      lockKey: 'cancel:' + this.orderId,
      loading: true,
      showError: true
    })
      .then(() => {
        this.setData({ cancelling: false });
        wx.showToast({ title: '订单已取消', icon: 'success' });
        setTimeout(() => this.fetchDetail(), 800);
      })
      .catch(() => {
        this.setData({ cancelling: false });
        // 错误文案已由 request.js 统一 toast（8001 无权操作 / 8002 已支付请联系商家）
      });
  },

  /** 联系商家 */
  onContact() {
    wx.makePhoneCall({
      phoneNumber: CONTACT_PHONE,
      fail: () => {
        wx.showToast({ title: '拨号失败，请稍后重试', icon: 'none' });
      }
    });
  }
});