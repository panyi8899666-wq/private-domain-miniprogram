/**
 * 作品集页（REQ-016~019）：分类筛选 + work-card 列表 + 触底分页
 */
const { callFunction, buildErrorState } = require('../../utils/request');
const { WORK_CATEGORIES } = require('../../utils/constants');

Page({
  data: {
    loading: true,
    error: null,
    categories: WORK_CATEGORIES,
    activeCategory: '',
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
    callFunction('getContent', {
      payload: { scope: 'works', category: this.data.activeCategory, page, pageSize: this.data.pageSize },
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

  onSelectCategory(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.activeCategory) return;
    this.setData({ activeCategory: id });
    this.fetch(true);
  },

  onReachBottom() {
    this.fetch(false);
  },

  onPreviewWork(e) {
    const work = e.detail.work;
    const imgs = (work && work.images) || [];
    if (imgs.length) wx.previewImage({ current: imgs[0], urls: imgs });
  }
});