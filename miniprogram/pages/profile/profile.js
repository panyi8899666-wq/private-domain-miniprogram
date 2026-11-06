/**
 * 客户注册资料页（第一批注册入口）
 * - 必填：真实姓名；手机号：微信授权优先，拒绝授权时手动填写兜底
 * - 可选：公司、客户类型（个人/企业）、行业、开票抬头、税号
 * - 保存走 saveProfile 云函数（服务端校验）；成功后回退上一页（下单流程中即回订单页）
 */
const auth = require('../../utils/auth');
const profile = require('../../utils/profile');
const privacy = require('../../utils/privacy');
const { maskPhone } = require('../../utils/format');
const { isFullMobile, hasContactPhone } = require('../../utils/phone');

Page({
  data: {
    realName: '',
    company: '',
    customerType: 'personal',
    industry: '',
    invoiceTitle: '',
    taxNo: '',
    phone: '',
    phoneMasked: '',
    manualPhone: '',
    manualInput: false,
    saving: false
  },

  onShow() {
    privacy.ensurePrivacyConsent().then((ok) => {
      if (!ok) {
        wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/mine/mine' }) });
        return;
      }
      this.refreshForm();
    });
  },

  /** 从本地缓存回填表单（不拉云端，保存后缓存即最新） */
  refreshForm() {
    const p = profile.getProfile();
    const phone = isFullMobile(p.phone) ? p.phone : '';
    this.setData({
      realName: p.realName,
      company: p.company,
      customerType: p.customerType,
      industry: p.industry,
      invoiceTitle: p.invoiceTitle,
      taxNo: p.taxNo,
      phone: phone,
      phoneMasked: p.phoneMasked || (phone ? maskPhone(phone) : ''),
      manualInput: false
    });
  },

  onRealName(e) { this.setData({ realName: e.detail.value }); },
  onCompany(e) { this.setData({ company: e.detail.value }); },
  onIndustry(e) { this.setData({ industry: e.detail.value }); },
  onInvoiceTitle(e) { this.setData({ invoiceTitle: e.detail.value }); },
  onTaxNo(e) { this.setData({ taxNo: e.detail.value }); },
  onManualPhone(e) { this.setData({ manualPhone: e.detail.value }); },
  onTypeChange(e) { this.setData({ customerType: e.detail.value }); },

  /** 手机号授权（button open-type=getPhoneNumber，与定制页同口径） */
  onGetPhoneNumber(e) {
    auth.getPhoneNumber(e)
      .then((data) => {
        const phone = isFullMobile(data && data.phone) ? data.phone : '';
        const masked = (data && data.phoneMasked) || '';
        if (!phone && !(data && data.hasPhone)) {
          this.setData({ manualInput: true });
          wx.showToast({ title: '手机号不可用，请手动填写', icon: 'none' });
          return;
        }
        this.setData({
          phone: phone,
          phoneMasked: masked || (phone ? maskPhone(phone) : ''),
          manualInput: false
        });
      })
      .catch(() => {
        this.setData({ manualInput: true });
        wx.showToast({ title: '未获得授权，请手动填写手机号', icon: 'none' });
      });
  },

  /** 手动填写手机号（拒绝授权时的兜底，与 REQ-050 同口径） */
  onManualPhoneTap() {
    this.setData({ manualInput: true });
  },

  /** 收货地址管理 */
  goAddresses() {
    wx.navigateTo({ url: '/pages/addresses/addresses' });
  },

  /** 保存资料 */
  onSave() {
    if (this.data.saving) return;
    const realName = (this.data.realName || '').trim();
    if (!realName) {
      wx.showToast({ title: '请填写真实姓名', icon: 'none' });
      return;
    }
    const taxNo = (this.data.taxNo || '').trim().toUpperCase().replace(/[\s-]/g, '');
    if (taxNo && !/^(?:[0-9A-Z]{15}|[0-9A-Z]{18}|[0-9A-Z]{20})$/.test(taxNo)) {
      wx.showToast({ title: '税号格式不正确', icon: 'none' });
      return;
    }
    // 只提交完整 11 位。已授权但本地没有明文时不传，避免把脱敏号写回去。
    let phone = '';
    if (isFullMobile(this.data.phone)) {
      phone = this.data.phone;
    } else if (isFullMobile((this.data.manualPhone || '').trim())) {
      phone = this.data.manualPhone.trim();
    } else if (!hasContactPhone(profile.getProfile()) && this.data.phone) {
      wx.showToast({ title: '请填写 11 位手机号', icon: 'none' });
      return;
    }

    const payload = {
      realName: realName,
      company: (this.data.company || '').trim(),
      customerType: this.data.customerType,
      industry: (this.data.industry || '').trim(),
      invoiceTitle: (this.data.invoiceTitle || '').trim(),
      taxNo: taxNo
    };
    if (phone) payload.phone = phone;

    this.setData({ saving: true });
    profile.saveProfile(payload)
      .then(() => {
        this.setData({ saving: false });
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => {
          const pages = getCurrentPages();
          if (pages.length > 1) {
            wx.navigateBack();
          } else {
            wx.switchTab({ url: '/pages/mine/mine' });
          }
        }, 600);
      })
      .catch(() => {
        this.setData({ saving: false });
      });
  }
});
