/**
 * 收货地址选择器（REQ-024）：展示地址或占位，点击弹手动填写表单（电话校验 11 位）
 */
Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    address: { type: Object, value: null }
  },

  data: {
    show: false,
    name: '',
    phone: '',
    detail: ''
  },

  methods: {
    noop() {},
    onOpen() {
      const a = this.data.address || {};
      this.setData({ show: true, name: a.name || '', phone: a.phone || '', detail: a.detail || '' });
    },
    onName(e) { this.setData({ name: e.detail.value }); },
    onPhone(e) { this.setData({ phone: e.detail.value }); },
    onDetail(e) { this.setData({ detail: e.detail.value }); },
    onCancel() { this.setData({ show: false }); },
    onSubmit() {
      const name = (this.data.name || '').trim();
      const phone = (this.data.phone || '').trim();
      const detail = (this.data.detail || '').trim();
      if (!name) { wx.showToast({ title: '请填写收货人姓名', icon: 'none' }); return; }
      if (!/^1[3-9]\d{9}$/.test(phone)) { wx.showToast({ title: '请填写正确的11位手机号', icon: 'none' }); return; }
      if (!detail) { wx.showToast({ title: '请填写详细地址', icon: 'none' }); return; }
      this.setData({ show: false });
      this.triggerEvent('select', { name, phone, detail });
    }
  }
});