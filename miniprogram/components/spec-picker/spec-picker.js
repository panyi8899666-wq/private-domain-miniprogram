/**
 * 规格选择器（REQ-022）：规格 chip 选择 + 数量加减（min 1，max = stockLimit 或 999）
 */
Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    specs: { type: Array, value: [] },
    selectedSpecId: { type: String, value: '' },
    quantity: { type: Number, value: 1 }
  },

  data: {
    activeSpecId: '',
    maxBuy: 999
  },

  observers: {
    selectedSpecId(val) {
      this.setData({ activeSpecId: val });
    },
    'specs, activeSpecId'(specs) {
      const list = Array.isArray(specs) ? specs : [];
      const spec = list.find((s) => s.specId === this.data.activeSpecId) || list[0] || null;
      const maxBuy = spec && spec.stockLimit && spec.stockLimit > 0 ? spec.stockLimit : 999;
      this.setData({ maxBuy });
    },
    quantity(q) {
      let n = Number(q) || 1;
      if (n < 1) n = 1;
      if (n > this.data.maxBuy) n = this.data.maxBuy;
      if (n !== q) this.setData({ quantity: n });
    }
  },

  methods: {
    onSelectSpec(e) {
      const idx = e.currentTarget.dataset.index;
      const spec = this.data.specs[idx];
      if (!spec) return;
      const maxBuy = spec.stockLimit && spec.stockLimit > 0 ? spec.stockLimit : 999;
      this.setData({ activeSpecId: spec.specId, maxBuy, quantity: 1 });
      this.triggerEvent('change', { specId: spec.specId, quantity: 1 });
    },
    onMinus() {
      let q = Number(this.data.quantity) || 1;
      q = Math.max(1, q - 1);
      this.setData({ quantity: q });
      this.triggerEvent('change', { quantity: q });
    },
    onPlus() {
      let q = Number(this.data.quantity) || 1;
      if (q >= this.data.maxBuy) {
        wx.showToast({ title: '最多购买 ' + this.data.maxBuy + ' 件', icon: 'none' });
        return;
      }
      q = q + 1;
      this.setData({ quantity: q });
      this.triggerEvent('change', { quantity: q });
    }
  }
});