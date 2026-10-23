/**
 * 商城页（REQ-020、REQ-021）：商品列表 + 触底分页 + 点击跳商品详情
 */
const { callFunction, buildErrorState } = require('../../utils/request');

Page({
  data: {
    loading: true,
    error: null,
    list: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loadingMore: false
  },

  onLoad() {
    this.fetch(true);
  },

  fetch(reset) {
    if (reset) {
      this.setData({ loading: true, error: null, list: [], page: 1, hasMore: true });
    } else if (this.data.loadingMore || !this.data.hasMore) {
      return;
    }
    const page = this.data.page;
    this.setData({ loadingMore: !reset });
    callFunction('getProducts', {
      payload: { action: 'list', page, pageSize: this.data.pageSize },
      showError: false
    })
      .then((data) => {
        const newList = data.list || [];
        this.setData({
          loading: false,
          loadingMore: false,
          list: reset ? newList : this.data.list.concat(newList),
          page: page + 1,
          hasMore: !!data.hasMore
        });
      })
      .catch((err) => {
        this.setData({ loading: false, loadingMore: false, error: buildErrorState(err) });
      });
  },

  onRetry() {
    this.fetch(true);
  },

  onReachBottom() {
    this.fetch(false);
  },

  onTapProduct(e) {
    const product = e.detail.product;
    const id = (product && (product.code || product._id)) || '';
    if (id) wx.navigateTo({ url: '/pages/product-detail/product-detail?id=' + id });
  }
});