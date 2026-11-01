/**
 * 商城页（REQ-020、REQ-021）：商品列表 + 触底分页 + 点击跳商品详情
 * T11：分享（R9.1）、搜索入口（R9.3 / C-NAV@1）、三态（加载/空/错误重试，R9.4）、
 *      触底分页路径式局部 setData 优化（R9.6）
 */
const { callFunction, buildErrorState, toastError } = require('../../utils/request');

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
        const patch = {
          loading: false,
          loadingMore: false,
          page: page + 1,
          hasMore: !!data.hasMore
        };
        if (reset) {
          // 首屏：整体替换列表
          patch.list = newList;
        } else {
          // 触底追加：路径式局部 setData，仅更新新增项，避免整表 setData 触发全量重渲染（R9.6）
          const base = this.data.list.length;
          newList.forEach((item, i) => {
            patch['list[' + (base + i) + ']'] = item;
          });
        }
        this.setData(patch);
      })
      .catch((err) => {
        const errState = buildErrorState(err);
        if (reset) {
          // 首屏失败：进入整页错误态，可重试（R9.4）
          this.setData({ loading: false, error: errState });
        } else {
          // 触底追加失败：保留已加载列表，仅轻提示，避免整页被错误态覆盖（防回归）
          this.setData({ loading: false, loadingMore: false });
          toastError(errState.message);
        }
      });
  },

  onRetry() {
    this.fetch(true);
  },

  onReachBottom() {
    this.fetch(false);
  },

  /** 搜索入口（R9.3 / C-NAV@1）：跳转搜索页并限定 scope=shop */
  goSearch() {
    wx.navigateTo({ url: '/pages/search/search?scope=shop' });
  },

  onTapProduct(e) {
    const product = e.detail.product;
    const id = (product && (product.code || product._id)) || '';
    if (id) wx.navigateTo({ url: '/pages/product-detail/product-detail?id=' + id });
  },

  /** 分享到会话（R9.1）：标题/路径指向商城；不设置 imageUrl，避免依赖 images/ 大图 */
  onShareAppMessage() {
    return { title: '正鑫越文化工作室 · 标准品商城', path: '/pages/shop/shop' };
  },

  /** 分享到朋友圈（R9.1）：可分享内容页 */
  onShareTimeline() {
    return { title: '正鑫越文化工作室 · 标准品商城', query: '' };
  }
});