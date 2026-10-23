/**
 * 我的订单页（REQ-034、REQ-035、REQ-037）
 * - 订单列表 + 状态筛选（全部/待报价/待付款/制作中/已完成）+ 触底分页 + 空状态
 * - 数据源：getOrders({ payload: { role:'customer', status?, page, pageSize } })
 * - 点击订单跳 order-detail
 */
const { callFunction } = require('../../utils/request');
const { formatAmount, formatTime } = require('../../utils/format');
const { ORDER_STATUS_FILTERS } = require('../../utils/constants');
const { isLoggedIn, requireLogin } = require('../../utils/auth');

const PAGE_SIZE = 10;

/** 订单概要（标题副文案） */
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
    const spec = it.specName ? ` · ${it.specName}` : '';
    return `${it.name || '标准品'}${spec} ×${it.quantity || 1}`;
  }
  return '标准品订单';
}

/** 订单金额文案（定制待报价显示『待报价』） */
function orderAmountText(order) {
  if (!order) return '';
  if (order.type === 'custom' && order.status === 'pending_quote') return '待报价';
  return formatAmount(order.amount);
}

Page({
  data: {
    filters: ORDER_STATUS_FILTERS,
    activeFilter: '', // 当前筛选状态值
    needLogin: false, // 未登录引导态
    loading: true, // 首次/切换筛选加载中
    loadingMore: false, // 触底加载更多
    loadError: null, // 加载失败态 { error, message, retriable }
    list: [], // 订单列表
    hasMore: false, // 是否还有下一页
    empty: false // 空态（已加载完成且无数据）
  },

  onLoad() {
    this.page = 1;
    this.setData({ activeFilter: '', list: [], hasMore: false, empty: false, loadError: null, loading: true });
  },

  onShow() {
    // 每次进入页面刷新登录态与列表
    if (!isLoggedIn()) {
      this.setData({ needLogin: true, loading: false, list: [], empty: false });
      return;
    }
    if (this.data.needLogin) {
      // 从未登录切换为已登录，重新加载
      this.setData({ needLogin: false });
      this.reload();
    } else if (!this.data.list.length && !this.data.loading && !this.data.loadError) {
      this.reload();
    }
  },

  /** 切换状态筛选 */
  onFilterTap(e) {
    const value = e.currentTarget.dataset.value;
    if (value === this.data.activeFilter) return;
    this.setData({ activeFilter: value });
    this.reload();
  },

  /** 触发登录 */
  goLogin() {
    requireLogin({ message: '查看订单需要登录，是否立即登录？' }).then((ok) => {
      if (ok) {
        this.setData({ needLogin: false });
        this.reload();
      }
    });
  },

  /** 重置并加载第一页 */
  reload() {
    this.page = 1;
    this.setData({ loading: true, loadError: null, list: [], hasMore: false, empty: false });
    this.fetchList();
  },

  /** 为订单附加展示字段，供 WXML 直接渲染 */
  decorate(list) {
    return (list || []).map((order) => ({
      id: order._id || order.orderId || order.orderNo,
      orderNo: order.orderNo || '',
      status: order.status || '',
      type: order.type || 'standard',
      summaryText: orderSummary(order),
      amountText: orderAmountText(order),
      timeText: formatTime(order.createdAt)
    }));
  },

  /** 拉取当前页 */
  fetchList() {
    const payload = { role: 'customer', page: this.page, pageSize: PAGE_SIZE };
    if (this.data.activeFilter) payload.status = this.data.activeFilter;

    callFunction('getOrders', { payload: payload, showError: false })
      .then((data) => {
        const list = this.decorate((data && data.list) || []);
        const hasMore = !!(data && data.hasMore);
        const merged = this.page === 1 ? list : this.data.list.concat(list);
        this.setData({
          loading: false,
          loadingMore: false,
          list: merged,
          hasMore: hasMore,
          empty: merged.length === 0
        });
      })
      .catch((err) => {
        this.setData({
          loading: false,
          loadingMore: false,
          loadError: {
            error: true,
            message: (err && err.message) || '加载失败，请重试',
            retriable: !!(err && err.retriable !== false)
          }
        });
      });
  },

  /** 触底加载更多 */
  onReachBottom() {
    if (this.data.needLogin || this.data.loading || this.data.loadingMore || this.data.loadError || !this.data.hasMore) {
      return;
    }
    this.page += 1;
    this.setData({ loadingMore: true });
    this.fetchList();
  },

  /** 点击订单跳详情 */
  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/order-detail/order-detail?id=' + id });
  },

  /** 去逛逛（空态按钮） */
  goShop() {
    wx.switchTab({ url: '/pages/shop/shop' });
  }
});