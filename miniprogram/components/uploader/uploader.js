/**
 * 图片上传器（REQ-028）：选图（相册/拍照）、预览、删除、数量上限。
 * 说明：当前使用 wx.chooseMedia 临时路径占位，投产时改用 wx.cloud.uploadFile 上传云存储返回 fileID。
 */
Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    fileIds: { type: Array, value: [] },
    maxCount: { type: Number, value: 9 }
  },

  data: {
    list: []
  },

  observers: {
    fileIds(val) {
      this.setData({ list: Array.isArray(val) ? val : [] });
    }
  },

  methods: {
    onChoose() {
      const current = this.data.list;
      const max = this.data.maxCount;
      if (current.length >= max) {
        wx.showToast({ title: '最多上传 ' + max + ' 张', icon: 'none' });
        return;
      }
      const remain = max - current.length;
      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const temps = (res.tempFiles || []).map((f) => f.tempFilePath).filter(Boolean);
          const next = current.concat(temps).slice(0, max);
          this.setData({ list: next });
          this.triggerEvent('change', { fileIds: next });
        }
      });
    },
    onPreview(e) {
      const url = e.currentTarget.dataset.url;
      wx.previewImage({ current: url, urls: this.data.list });
    },
    onRemove(e) {
      const idx = e.currentTarget.dataset.index;
      const next = this.data.list.slice();
      next.splice(idx, 1);
      this.setData({ list: next });
      this.triggerEvent('change', { fileIds: next });
    }
  }
});