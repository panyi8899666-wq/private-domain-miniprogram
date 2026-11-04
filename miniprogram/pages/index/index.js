const { callFunction, buildErrorState } = require('../../utils/request');

const ICON_MAP = { 'pen-tool': '✏️', 'box': '📦', 'spray': '🖌️', 'file-print': '📄' };

const FALLBACK_SERVICES = [
  { name: '广告设计', desc: '品牌视觉 / 3D效果图 / 标识设计', icon: '✏️' },
  { name: '发光字制作', desc: '吸塑 / 迷你 / 树脂字生产安装', icon: '📦' },
  { name: '喷绘写真', desc: '户内外喷绘 / 写真 / KT板', icon: '🖌️' },
  { name: '印刷品', desc: '名片 / 传单 / 画册印刷', icon: '📄' }
];

function mapServices(list) {
  const arr = (list || []).map((s) => ({
    name: s.name,
    desc: s.desc,
    icon: ICON_MAP[s.icon] || '▪️'
  }));
  return arr.length ? arr : FALLBACK_SERVICES;
}

/**
 * 为首页案例预计算两位序号（1 → '01'、10 → '10'），供 wxml 直接渲染。
 * 目的：避免在 wxml 文本节点使用 `{{index < 9 ? ...}}` 触发编译告警。
 * 仅追加 seq 字段，其余字段原样保留。
 */
function mapWorks(list) {
  return (list || []).map((w, i) =>
    Object.assign({}, w, { seq: (i + 1 < 10 ? '0' : '') + (i + 1) })
  );
}

Page({
  data: {
    loading: true,
    error: null,
    siteName: '正鑫越文化工作室',
    slogan: '',
    heroTitle: '发光字 · 展台美陈 · 户外标识 · 3D设计',
    heroSubtitle: '',
    services: FALLBACK_SERVICES,
    featuredWorks: [],
    process: []
  },

  onLoad() {
    this.fetchHome();
  },

  fetchHome() {
    this.setData({ loading: true, error: null });
    callFunction('getContent', { payload: { scope: 'home' }, showError: false })
      .then((data) => {
        const site = data.site || {};
        this.setData({
          loading: false,
          siteName: site.siteName || '正鑫越文化工作室',
          slogan: site.slogan || '',
          heroTitle: (site.hero && site.hero.title) || '发光字 · 展台美陈 · 户外标识 · 3D设计',
          heroSubtitle: (site.hero && site.hero.subtitle) || '',
          services: mapServices(site.services),
          featuredWorks: mapWorks(data.featuredWorks),
          process: site.process || []
        });
      })
      .catch((err) => {
        this.setData({ loading: false, error: buildErrorState(err) });
      });
  },

  onRetry() { this.fetchHome(); },
  goCustom() { wx.navigateTo({ url: '/pages/custom/custom' }); },
  goShop() { wx.switchTab({ url: '/pages/shop/shop' }); },
  goMaterial() { wx.switchTab({ url: '/pages/material/material' }); },
  goWorks() { wx.switchTab({ url: '/pages/works/works' }); },
  onPreviewWork(e) {
    const work = e.detail.work;
    const imgs = (work && work.images) || [];
    if (imgs.length) wx.previewImage({ current: imgs[0], urls: imgs });
  },

  /** 点击案例卡片：预览该作品图片 */
  onTapCase(e) {
    const i = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.index : -1;
    const list = this.data.featuredWorks || [];
    const work = list[i];
    if (!work) return;
    const imgs = (work.images || []).filter(Boolean);
    if (imgs.length) wx.previewImage({ current: imgs[0], urls: imgs });
  },

  /** 案例封面加载失败：清空该项 images，触发布局回退到「暂无图片」占位 */
  onCaseImageError(e) {
    const i = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.index : -1;
    if (i < 0) return;
    const list = this.data.featuredWorks || [];
    if (!list[i]) return;
    this.setData({ [`featuredWorks[${i}].images`]: [] });
  },

  /** 组装分享标题：站点名 + 首屏主标语（缺省回退站点名） */
  buildShareTitle() {
    const name = this.data.siteName || '正鑫越文化工作室';
    const hero = this.data.heroTitle || '';
    return hero ? name + ' · ' + hero : name;
  },

  /** 分享到会话（R9.1）：标题/路径指向首页；不设置 imageUrl，避免依赖 images/ 大图 */
  onShareAppMessage() {
    return { title: this.buildShareTitle(), path: '/pages/index/index' };
  },

  /** 分享到朋友圈（R9.1）：可分享内容页 */
  onShareTimeline() {
    return { title: this.buildShareTitle(), query: '' };
  }
});