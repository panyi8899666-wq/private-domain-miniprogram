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

Page({
  data: {
    loading: true,
    error: null,
    siteName: '潘工·广告物料制作',
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
          siteName: site.siteName || '潘工·广告物料制作',
          slogan: site.slogan || '',
          heroTitle: (site.hero && site.hero.title) || '发光字 · 展台美陈 · 户外标识 · 3D设计',
          heroSubtitle: (site.hero && site.hero.subtitle) || '',
          services: mapServices(site.services),
          featuredWorks: data.featuredWorks || [],
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
  }
});