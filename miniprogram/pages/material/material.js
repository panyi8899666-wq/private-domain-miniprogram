/**
 * 物料百科 / 材质库浏览页（广告物料下单系统）
 * - 加载材质库（getContent scope='material_library'），展示 5 大类 + 子类 + 材质
 * - 点击材质 → 跳配置式下单页（custom）并带上 category + materialCode 预填
 * - 顶部「定制下单」入口
 */
const { callFunction, buildErrorState } = require('../../utils/request');

Page({
  data: {
    loading: true,
    error: null,
    categories: [],
    activeCategory: '',
    activeCategoryName: '',
    subCategories: []
  },

  onLoad() {
    this.fetch();
  },

  fetch() {
    this.setData({ loading: true, error: null });
    callFunction('getContent', {
      payload: { scope: 'material_library', page: 1, pageSize: 50 },
      showError: false
    })
      .then((data) => {
        const categories = data.list || [];
        const first = categories[0] || null;
        this.setData({
          loading: false,
          categories: categories,
          activeCategory: first ? first.code : '',
          activeCategoryName: first ? first.category : '',
          subCategories: first ? first.subCategories || [] : []
        });
      })
      .catch((err) => {
        this.setData({ loading: false, error: buildErrorState(err) });
      });
  },

  onRetry() {
    this.fetch();
  },

  onCategoryTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    const cat = this.data.categories[index];
    if (!cat) return;
    this.setData({
      activeCategory: cat.code,
      activeCategoryName: cat.category,
      subCategories: cat.subCategories || []
    });
  },

  /** 点击材质 → 进入配置式下单并预填 */
  goConfig(e) {
    const ds = e.currentTarget.dataset;
    const category = ds.category || '';
    const code = ds.code || '';
    wx.navigateTo({
      url: '/pages/custom/custom?category=' + category + '&materialCode=' + code
    });
  },

  /** 直接进入定制下单（不预填） */
  goCustom() {
    wx.navigateTo({ url: '/pages/custom/custom' });
  }
});