/**
 * 关键词搜索页（C-NAV@1 · R9.3 / R9.4）
 *
 * 入口：由作品集 / 商城 / 材质百科页跳转（入口由 T11 负责），支持
 *   ?scope=works|shop|material&kw=xxx
 *
 * 数据来源（均为既有只读云函数，取数后本地按关键词过滤）：
 *   scope=works    → getContent  { payload: { scope: 'works', page, pageSize } }
 *   scope=material → getContent  { payload: { scope: 'material' } }
 *   scope=shop     → getProducts { payload: { action: 'list', page, pageSize } }
 * 无结果用 empty-state 展示；具备加载态与错误重试态。
 *
 * 素材：本页不引用任何本地图片资源（miniprogram/images 未 checkout）；
 *      图标使用纯文本符号，如需图形图标需用户提供素材。
 */
const { callFunction, buildErrorState } = require('../../utils/request');

/** 可搜索 scope 与展示名（与 C-NAV@1 约定一致：works | shop | material） */
const SCOPES = [
  { value: 'works', label: '作品' },
  { value: 'shop', label: '商品' },
  { value: 'material', label: '材质' }
];
const DEFAULT_SCOPE = 'works';
const PAGE_SIZE = 50; // 云函数单页上限
const MAX_PAGES = 5; // 本地过滤最多拉取页数，避免无限请求

/** 各 scope 参与关键词匹配的字段（顶层层级） */
const SEARCH_FIELDS = {
  works: ['name', 'note', 'categoryName', 'alt'],
  shop: ['name', 'description', 'category'],
  material: ['name', 'title', 'intro', 'type']
};

/** 关键词归一（去首尾空白） */
function normalizeKw(kw) {
  return String(kw === undefined || kw === null ? '' : kw).trim();
}

/** scope 归一，非法值回退默认 scope */
function normalizeScope(scope) {
  const v = String(scope || '').toLowerCase();
  for (let i = 0; i < SCOPES.length; i++) {
    if (SCOPES[i].value === v) return v;
  }
  return DEFAULT_SCOPE;
}

Page({
  data: {
    scopes: SCOPES,
    scope: DEFAULT_SCOPE,
    kw: '',
    inputKw: '',
    prompt: true,
    loading: false,
    error: null,
    results: [],
    searched: false
  },

  onLoad(options) {
    const opts = options || {};
    const scope = normalizeScope(opts.scope);
    const kw = normalizeKw(opts.kw);
    this.setData({ scope: scope, kw: kw, inputKw: kw, prompt: !kw });
    if (kw) this.search();
  },

  onInput(e) {
    this.setData({ inputKw: e.detail.value });
  },

  /** 清空关键词与结果，回到引导态 */
  onClear() {
    this.setData({
      inputKw: '',
      kw: '',
      results: [],
      searched: false,
      prompt: true,
      error: null
    });
  },

  onScopeTap(e) {
    const scope = e.currentTarget.dataset.scope;
    if (!scope || scope === this.data.scope) return;
    this.setData({ scope: scope });
    if (normalizeKw(this.data.inputKw)) this.search();
  },

  onSearch() {
    this.search();
  },

  onRetry() {
    this.search();
  },

  /** 执行搜索：拉取远端数据 → 本地过滤 → 渲染结果/空态 */
  search() {
    const kw = normalizeKw(this.data.inputKw);
    if (!kw) {
      this.setData({ prompt: true, kw: '', results: [], searched: false, loading: false, error: null });
      return;
    }
    const scope = this.data.scope;
    this.setData({ loading: true, error: null, prompt: false, kw: kw, results: [], searched: false });
    this.loadRemote(scope)
      .then((list) => {
        this.setData({
          loading: false,
          results: this.filterList(scope, list, kw),
          searched: true
        });
      })
      .catch((err) => {
        this.setData({ loading: false, error: buildErrorState(err) });
      });
  },

  /**
   * 拉取远端原始列表（本地过滤前）。
   * material 为一次性返回；works / shop 支持分页，按 hasMore 续拉但不超过 MAX_PAGES。
   */
  loadRemote(scope) {
    if (scope === 'material') {
      return callFunction('getContent', { payload: { scope: 'material' }, showError: false }).then(
        (data) => (data && data.list) || []
      );
    }
    const all = [];
    const fetchPage = (page) => {
      const isShop = scope === 'shop';
      const name = isShop ? 'getProducts' : 'getContent';
      const payload = isShop
        ? { action: 'list', page: page, pageSize: PAGE_SIZE }
        : { scope: scope, page: page, pageSize: PAGE_SIZE };
      return callFunction(name, { payload: payload, showError: false }).then((data) => {
        const list = (data && data.list) || [];
        for (let i = 0; i < list.length; i++) all.push(list[i]);
        if (data && data.hasMore && list.length > 0 && page < MAX_PAGES) {
          return fetchPage(page + 1);
        }
        return all;
      });
    };
    return fetchPage(1);
  },

  /** 本地关键词过滤：字段拼接后做大小写不敏感包含匹配 */
  filterList(scope, list, kw) {
    const key = kw.toLowerCase();
    const fields = SEARCH_FIELDS[scope] || ['name'];
    return (list || []).filter((item) => {
      if (!item) return false;
      let hay = '';
      for (let i = 0; i < fields.length; i++) {
        const v = item[fields[i]];
        if (v !== undefined && v !== null) hay += String(v) + ' ';
      }
      return hay.toLowerCase().indexOf(key) !== -1;
    });
  },

  /** 作品结果：点击预览大图 */
  onPreviewWork(e) {
    const work = e.detail.work;
    const imgs = (work && work.images) || [];
    if (imgs.length) wx.previewImage({ current: imgs[0], urls: imgs });
  },

  /** 商品结果：跳转商品详情 */
  onTapProduct(e) {
    const product = e.detail.product;
    const id = (product && (product.code || product._id)) || '';
    if (id) wx.navigateTo({ url: '/pages/product-detail/product-detail?id=' + id });
  },

  /** 材质结果：跳转物料百科（tabBar 页，使用 switchTab） */
  onTapMaterial() {
    wx.switchTab({ url: '/pages/material/material' });
  },

  /** 去商城（空态引导） */
  goShop() {
    wx.switchTab({ url: '/pages/shop/shop' });
  }
});