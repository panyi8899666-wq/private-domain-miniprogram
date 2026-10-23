/**
 * 商品卡片（商城列表，REQ-020）
 * 展示：封面图（images[0] 或 image，加载失败回退占位图）、名称、价格「¥xx 起」、销量。
 * 点击触发 tap 事件，detail 透传 product 对象。
 */
const PLACEHOLDER = '/images/placeholder.png';

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 商品对象：{ name, priceFrom, image, images, sales } */
    product: {
      type: Object,
      value: {}
    }
  },

  data: {
    cover: ''
  },

  observers: {
    product(product) {
      const p = product || {};
      const first = Array.isArray(p.images) && p.images.length ? p.images[0] : '';
      this.setData({ cover: first || p.image || PLACEHOLDER });
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { product: this.data.product });
    },

    onImageError() {
      if (this.data.cover !== PLACEHOLDER) {
        this.setData({ cover: PLACEHOLDER });
      }
    }
  }
});