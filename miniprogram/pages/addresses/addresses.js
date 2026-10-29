/**
 * 收货地址管理页（第一批注册入口）
 * - 列表：新增 / 编辑 / 删除 / 设为默认（每次变动即调 saveAddresses 云函数落库，不再只存本地）
 * - 微信导入：wx.chooseAddress 全字段映射（省市区 + 详细地址全存，修复旧版只存占位文案的问题）
 * - 下单读取口径：默认地址优先（utils/profile.getDefaultAddress），服务端 createOrder 按 addressId 取用
 */
const profile = require('../../utils/profile');

function joinDetail(province, city, county, detailInfo) {
  return [province || '', city || '', county || '', detailInfo || ''].join('');
}

Page({
  data: {
    list: [],
    showForm: false,
    editingId: '',
    formName: '',
    formPhone: '',
    region: [],
    formDetailInfo: ''
  },

  onShow() {
    this.refreshList();
  },

  /** 从本地缓存刷新列表（保存后缓存即最新） */
  refreshList() {
    const p = profile.getProfile();
    this.setData({ list: p.addresses });
  },

  /** 持久化：调云函数全量保存，失败则回滚列表显示 */
  persist(list) {
    profile.saveAddresses(list)
      .then((data) => {
        this.setData({ list: (data && data.addresses) || list });
      })
      .catch(() => {
        this.refreshList();
      });
  },

  /** 新增地址：打开空表单 */
  onAdd() {
    this.setData({
      showForm: true,
      editingId: '',
      formName: '',
      formPhone: '',
      region: [],
      formDetailInfo: ''
    });
  },

  /** 编辑地址：表单回填 */
  onEdit(e) {
    const id = e.currentTarget.dataset.id;
    const item = (this.data.list || []).find((a) => a && a.addressId === id);
    if (!item) return;
    this.setData({
      showForm: true,
      editingId: id,
      formName: item.name || '',
      formPhone: item.phone || '',
      region: [item.province || '', item.city || '', item.county || ''].filter(Boolean),
      formDetailInfo: item.detailInfo || ''
    });
  },

  /** 删除地址（二次确认） */
  onDelete(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除地址',
      content: '确定删除这条收货地址吗？',
      confirmText: '删除',
      confirmColor: '#ff5c5c',
      success: (res) => {
        if (!res.confirm) return;
        const list = (this.data.list || []).filter((a) => a && a.addressId !== id);
        this.setData({ list: list });
        this.persist(list);
      }
    });
  },

  /** 设为默认 */
  onSetDefault(e) {
    const id = e.currentTarget.dataset.id;
    const list = (this.data.list || []).map((a) => {
      if (!a) return a;
      return Object.assign({}, a, { isDefault: a.addressId === id });
    });
    this.setData({ list: list });
    this.persist(list);
  },

  /** 微信地址簿导入：全字段映射，旧版丢省市区/详细地址的问题在此修复 */
  onImportWx() {
    wx.chooseAddress({
      success: (res) => {
        const province = res.provinceName || '';
        const city = res.cityName || '';
        const county = res.countyName || '';
        const detailInfo = res.detailInfo || '';
        const item = {
          addressId: 'wx_' + Date.now(),
          name: res.userName || '',
          phone: res.telNumber || '',
          province: province,
          city: city,
          county: county,
          detailInfo: detailInfo,
          detail: joinDetail(province, city, county, detailInfo),
          isDefault: !(this.data.list || []).length
        };
        if (!item.name || !/^1[3-9]\d{9}$/.test(item.phone) || !item.detail) {
          wx.showToast({ title: '导入的地址信息不完整', icon: 'none' });
          return;
        }
        const list = [item].concat(this.data.list || []).slice(0, 10);
        this.setData({ list: list });
        this.persist(list);
        wx.showToast({ title: '已保存地址', icon: 'success' });
      },
      fail: () => {
        // 用户取消，静默处理
      }
    });
  },

  onName(e) { this.setData({ formName: e.detail.value }); },
  onPhone(e) { this.setData({ formPhone: e.detail.value }); },
  onRegionChange(e) { this.setData({ region: e.detail.value || [] }); },
  onDetailInfo(e) { this.setData({ formDetailInfo: e.detail.value }); },
  onCancelForm() { this.setData({ showForm: false }); },

  /** 表单保存：校验后新增或覆盖，落库 */
  onSaveForm() {
    const name = (this.data.formName || '').trim();
    const phone = (this.data.formPhone || '').trim();
    const region = this.data.region || [];
    const detailInfo = (this.data.formDetailInfo || '').trim();
    if (!name) {
      wx.showToast({ title: '请填写收货人姓名', icon: 'none' });
      return;
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      wx.showToast({ title: '请填写正确的 11 位手机号', icon: 'none' });
      return;
    }
    if (!region.length || !detailInfo) {
      wx.showToast({ title: '请选择省市区并填写详细地址', icon: 'none' });
      return;
    }
    const province = region[0] || '';
    const city = region[1] || '';
    const county = region[2] || '';
    const editingId = this.data.editingId;
    const old = (this.data.list || []).find((a) => a && a.addressId === editingId);
    const item = {
      addressId: editingId || 'addr_' + Date.now(),
      name: name,
      phone: phone,
      province: province,
      city: city,
      county: county,
      detailInfo: detailInfo,
      detail: joinDetail(province, city, county, detailInfo),
      isDefault: old ? !!old.isDefault : !(this.data.list || []).length
    };
    let list = this.data.list || [];
    if (editingId) {
      list = list.map((a) => (a && a.addressId === editingId ? item : a));
    } else {
      list = [item].concat(list).slice(0, 10);
    }
    this.setData({ list: list, showForm: false });
    this.persist(list);
  }
});
