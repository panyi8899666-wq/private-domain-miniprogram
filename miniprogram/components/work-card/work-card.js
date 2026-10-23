/**
 * 作品卡片（作品集列表，REQ-018）
 * 展示：封面图（images[0] 或 image，加载失败回退占位图）、名称、分类标签、简介。
 * 点击触发表单通知，detail 透传 work 对象。
 */
const PLACEHOLDER = '/images/placeholder.png';

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 作品对象：{ name, note, categoryName, image, images } */
    work: {
      type: Object,
      value: {}
    }
  },

  data: {
    /** 当前渲染的封面图地址 */
    cover: ''
  },

  observers: {
    work(work) {
      const w = work || {};
      const first = Array.isArray(w.images) && w.images.length ? w.images[0] : '';
      this.setData({ cover: first || w.image || PLACEHOLDER });
    }
  },

  methods: {
    onTap() {
      this.triggerEvent('tap', { work: this.data.work });
    },

    /** 图片加载失败，回退占位图 */
    onImageError() {
      if (this.data.cover !== PLACEHOLDER) {
        this.setData({ cover: PLACEHOLDER });
      }
    }
  }
});