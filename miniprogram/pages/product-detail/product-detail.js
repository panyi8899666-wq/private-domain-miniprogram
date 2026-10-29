/**
 * 商品详情页（REQ-021、REQ-022、REQ-023、REQ-026）
 * - 数据源：getProducts({ action: 'detail', productId })；productId 取 query.id / query.productId
 * - 集成 spec-picker（规格选择 + 数量）与 address-picker（收货信息）
 * - 应付金额为「前端展示」，仅用于下单前预览，最终以服务端核算为准（REQ-054）
 * - 「立即购买」未选规格时置灰；提交调用 createOrder，成功跳订单详情
 */
const { callFunction } = require('../../utils/request');
const { formatAmount } = require('../../utils/format');
const { requireLogin } = require('../../utils/auth');
const profile = require('../../utils/profile');

const PLACEHOLDER = '/images/placeholder.png';

/** 生成幂等键 clientRequestId，防重复下单（REQ-025） */
function genClientRequestId(prefix) {
  return (
    (prefix || 'po') +
    '_' +
    Date.now() +
    '_' +
    Math.random().toString(36).slice(2, 10)
  );
}

Page({
  data: {
    loading: true, // 初始加载中
    loadingError: null, // 加载失败态 { error, message, retriable }
    product: null,
    images: [], // 商品图列表（取 images 数组）
    priceFromText: '', // 「¥xx 起」列表价
    specs: [], // 规格数组 [{ specId, name, price, stockLimit? }]
    selectedSpecId: '', // 已选规格
    quantity: 1, // 数量
    address: null, // 收货信息 { name, phone, detail, addressId? }
    // 前端金额核算（仅展示）
    goodsAmountText: '¥0',
    shippingText: '¥0',
    amountText: '¥0',
    canBuy: false, // 是否满足下单条件（已选规格）
    submitting: false // 下单提交中（锁定按钮）
  },

  onLoad(query) {
    this.productId = (query && (query.id || query.productId)) || '';
    if (!this.productId) {
      this.setData({
        loading: false,
        loadingError: { error: true, message: '缺少商品参数，无法加载', retriable: false }
      });
      return;
    }
    this.fetchDetail();
  },

  /** 拉取商品详情 */
  fetchDetail() {
    this.setData({ loading: true, loadingError: null });
    callFunction('getProducts', {
      action: 'detail',
      payload: { productId: this.productId },
      showError: false
    })
      .then((data) => {
        const product = (data && data.product) || null;
        if (!product) {
          this.setData({
            loading: false,
            loadingError: { error: true, message: '商品不存在或已下架', retriable: false }
          });
          return;
        }
        this.applyProduct(product);
      })
      .catch((err) => {
        this.setData({
          loading: false,
          loadingError: {
            error: true,
            message: (err && err.message) || '加载失败，请重试',
            retriable: !!(err && err.retriable !== false)
          }
        });
      });
  },

  /** 渲染商品数据 */
  applyProduct(product) {
    const specs = Array.isArray(product.specs) ? product.specs : [];
    const images = Array.isArray(product.images) && product.images.length
      ? product.images
      : [product.image || PLACEHOLDER];

    // 默认不选规格：未选规格时「立即购买」置灰（REQ-022）
    const defaultSpecId = '';

    this.setData({
      loading: false,
      product: product,
      images: images,
      specs: specs,
      priceFromText: formatAmount(product.priceFrom),
      selectedSpecId: defaultSpecId,
      quantity: 1
    });
    this.recalcAmount();
  },

  /** 规格/数量变更回调（spec-picker） */
  onSpecChange(e) {
    const d = (e && e.detail) || {};
    const patch = {};
    if (d.specId !== undefined) patch.selectedSpecId = d.specId;
    if (d.quantity !== undefined) {
      const q = parseInt(d.quantity, 10);
      if (!isNaN(q) && q >= 1) patch.quantity = q;
    }
    if (Object.keys(patch).length) {
      this.setData(patch, () => this.recalcAmount());
    }
  },

  /** 收货信息选择回调（address-picker） */
  onAddressSelect(e) {
    const d = (e && e.detail) || {};
    const address = {
      name: d.name || '',
      phone: d.phone || '',
      detail: d.detail || '',
      addressId: d.addressId || d.id || ''
    };
    this.setData({ address: address });
  },

  /** 前端金额核算（仅展示，最终以服务端为准） */
  recalcAmount() {
    const { specs, selectedSpecId, quantity, product } = this.data;
    const spec = specs.find((s) => s && s.specId === selectedSpecId);
    if (!spec) {
      this.setData({
        goodsAmountText: '¥0',
        shippingText: '¥0',
        amountText: '¥0',
        canBuy: false
      });
      return;
    }
    const unitPrice = Number(spec.price) || 0;
    const goods = unitPrice * quantity;

    // 运费核算（与服务端 calcShippingFen 一致逻辑，REQ-026）
    const shipping = (product && product.shipping) || {};
    let shippingFee = 0;
    let shippingText = '包邮';
    if (!shipping.freeShipping) {
      const threshold = Number(shipping.freeThreshold);
      const fee = Number(shipping.fee);
      if (!isNaN(threshold) && threshold > 0 && goods >= threshold) {
        shippingFee = 0;
        shippingText = '包邮';
      } else if (!isNaN(fee) && fee > 0) {
        shippingFee = fee;
        shippingText = formatAmount(fee);
      } else {
        shippingText = '包邮';
      }
    }
    const total = goods + shippingFee;

    this.setData({
      goodsAmountText: formatAmount(goods),
      shippingText: shippingText,
      amountText: formatAmount(total),
      canBuy: true
    });
  },

  /** 图片加载失败回退占位图（列表式渲染时逐个替换） */
  onImageError(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    if (images[index] && images[index] !== PLACEHOLDER) {
      images[index] = PLACEHOLDER;
      this.setData({ images: images });
    }
  },

  /** 立即购买 */
  onBuy() {
    if (this.data.submitting) return;
    const { specs, selectedSpecId, quantity } = this.data;
    let address = this.data.address;
    // 第一批注册入口：未选收货信息时，优先用客户默认地址预填
    if (!address || !address.name || !address.phone || !address.detail) {
      const d = profile.getDefaultAddress();
      if (d) {
        address = { name: d.name, phone: d.phone, detail: d.detail, addressId: d.addressId };
        this.setData({ address: address });
      }
    }
    const spec = specs.find((s) => s && s.specId === selectedSpecId);
    if (!spec) {
      wx.showToast({ title: '请先选择规格', icon: 'none' });
      return;
    }
    if (!address || !address.name || !address.phone || !address.detail) {
      wx.showToast({ title: '请填写收货信息', icon: 'none' });
      return;
    }

    // 下单前登录引导（REQ-023 前置）
    requireLogin({ message: '下单需要登录，是否立即登录？' }).then((ok) => {
      if (!ok) return;
      // 第一批注册入口：资料不全（姓名/手机号/收货地址）先引导补齐
      profile.requireOrderProfile().then((ready) => {
        if (ready) this.submitOrder(spec);
      });
    });
  },

  /** 提交下单 */
  submitOrder(spec) {
    const { quantity, address } = this.data;
    const clientRequestId = genClientRequestId('po');
    const lockKey = 'createOrder:' + this.productId + ':' + spec.specId;

    this.setData({ submitting: true });
    callFunction('createOrder', {
      payload: {
        productId: this.productId,
        specId: spec.specId,
        quantity: quantity,
        address: { name: address.name, phone: address.phone, detail: address.detail },
        clientRequestId: clientRequestId
      },
      lockKey: lockKey,
      loading: true,
      showError: true
    })
      .then((data) => {
        this.setData({ submitting: false });
        const orderId = (data && data.orderId) || '';
        wx.showToast({ title: '下单成功', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/order-detail/order-detail?id=' + orderId });
        }, 600);
      })
      .catch((err) => {
        this.setData({ submitting: false });
        // 规格不可生产 → 引导走定制（REQ-022 异常场景）
        if (err && err.code === 5004) {
          wx.showModal({
            title: '规格不可生产',
            content: '该规格暂不可生产，可提交定制需求，商家将为您报价。',
            confirmText: '去定制',
            cancelText: '取消',
            success: (res) => {
              if (res.confirm) {
                wx.navigateTo({ url: '/pages/custom/custom' });
              }
            }
          });
        }
        // 其余错误已由 request.js 统一 toast「下单失败，请重试」等文案
      });
  },

  /** 分享（REQ-005） */
  onShareAppMessage() {
    const product = this.data.product || {};
    return {
      title: product.name || '潘工·广告物料制作',
      path: '/pages/product-detail/product-detail?id=' + this.productId,
      imageUrl: this.data.images[0] || ''
    };
  }
});