/**
 * 定制下单页（配置式下单，广告物料下单系统）
 * 流程：选大类 → 选子类 → 选材质 → 选规格(厚度/尺寸/颜色) → 选工艺(多选) → 填数量/面积 → 提交报价
 * 数据源：getContent({ scope: 'material_library' })
 * 提交：createCustomOrder（结构化 customRequirement）
 * 兼容：支持 query.category / query.materialCode 预填（物料百科「我要定制」进入）
 */
const { callFunction, buildErrorState } = require('../../utils/request');
const { requireLogin, getPhoneNumber } = require('../../utils/auth');
const profile = require('../../utils/profile');
const { UPLOAD_LIMITS } = require('../../utils/constants');

function genClientRequestId(prefix) {
  return (
    (prefix || 'co') +
    '_' +
    Date.now() +
    '_' +
    Math.random().toString(36).slice(2, 10)
  );
}

/**
 * 归一化参考图 fileID 列表（契约 C-UPLOAD@1 / C-VALIDATE@1）
 * - C-UPLOAD@1：uploader 通过 change 事件产出的 fileIds 为「纯 cloud:// fileID 字符串数组」。
 * - 仅保留 cloud:// 前缀的云存储 fileID，过滤本地临时路径（tempFilePath）等脏数据；
 *   过滤仅用于兜底防脏数据，不作为「上传是否成功」的判定依据。
 * - 数量截断至 UPLOAD_LIMITS.MAX_COUNT（6），与后端 createCustomOrder.normalizeFileIds 上限一致。
 * - 兼容历史对象形态 { fileID | fileId }，避免组件契约切换期丢项。
 * @param {Array} input 原始 fileIds / fileList
 * @param {number} maxCount 数量上限（缺省取 UPLOAD_LIMITS.MAX_COUNT）
 * @returns {string[]} 纯 cloud:// fileID 数组
 */
function normalizeReferenceFileIds(input, maxCount) {
  const limit = maxCount > 0 ? maxCount : UPLOAD_LIMITS.MAX_COUNT;
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item === 'object') return item.fileID || item.fileId || '';
      return '';
    })
    .filter((id) => typeof id === 'string' && id.indexOf('cloud://') === 0)
    .slice(0, limit);
}

Page({
  data: {
    loading: true,
    error: null,
    // 材质库
    categories: [], // [{ code, category, sort, description, subCategories }]
    activeCategory: '',
    activeCategoryName: '',
    subCategories: [],
    activeSubIndex: -1,
    activeSubName: '',
    materials: [],
    activeMaterial: null, // 当前选中材质
    // 规格（来自材质的 thickness/size）
    thicknessOptions: [],
    sizeOptions: [],
    selectedThickness: '',
    selectedSize: '',
    // 工艺（多选）
    craftOptions: [],
    selectedCrafts: [],
    // 数量/面积
    quantity: '',
    area: '',
    sizeDesc: '',
    // 联系方式
    phone: '',
    phoneMasked: '',
    manualInput: false,
    manualPhone: '',
    // 参考图
    referenceFiles: [],
    maxCount: UPLOAD_LIMITS.MAX_COUNT,
    submitting: false
  },

  onLoad(query) {
    this.prefill = {
      category: (query && query.category) || '',
      materialCode: (query && query.materialCode) || ''
    };
    this.fetchLibrary();
  },

  /** 加载材质库 */
  fetchLibrary() {
    this.setData({ loading: true, error: null });
    callFunction('getContent', {
      payload: { scope: 'material_library', page: 1, pageSize: 50 },
      showError: false
    })
      .then((data) => {
        const categories = data.list || [];
        this.setData({ loading: false, categories });
        // 预填：优先 materialCode，其次 category
        if (this.prefill.materialCode) {
          this.locateMaterial(this.prefill.materialCode, categories);
        } else if (this.prefill.category) {
          const idx = categories.findIndex((c) => c.code === this.prefill.category);
          if (idx >= 0) this.selectCategory(idx, categories);
        }
      })
      .catch((err) => {
        this.setData({ loading: false, error: buildErrorState(err) });
      });
  },

  /** 定位到指定材质（预填） */
  locateMaterial(materialCode, categories) {
    categories = categories || this.data.categories;
    for (let ci = 0; ci < categories.length; ci++) {
      const cat = categories[ci];
      for (let si = 0; si < (cat.subCategories || []).length; si++) {
        const sub = cat.subCategories[si];
        const mi = (sub.materials || []).findIndex((m) => m.code === materialCode);
        if (mi >= 0) {
          this.setData({
            activeCategory: cat.code,
            activeCategoryName: cat.category,
            subCategories: cat.subCategories || [],
            activeSubIndex: si,
            activeSubName: sub.name,
            materials: sub.materials || []
          });
          this.selectMaterial(mi, sub.materials || []);
          return;
        }
      }
    }
  },

  /** 选大类 */
  selectCategory(index, categories) {
    categories = categories || this.data.categories;
    const cat = categories[index];
    if (!cat) return;
    this.setData({
      activeCategory: cat.code,
      activeCategoryName: cat.category,
      subCategories: cat.subCategories || [],
      activeSubIndex: -1,
      activeSubName: '',
      materials: [],
      activeMaterial: null,
      thicknessOptions: [],
      sizeOptions: [],
      selectedThickness: '',
      selectedSize: '',
      craftOptions: [],
      selectedCrafts: []
    });
  },

  onCategoryTap(e) {
    this.selectCategory(Number(e.currentTarget.dataset.index));
  },

  /** 选子类 */
  onSubTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    const sub = this.data.subCategories[index];
    if (!sub) return;
    this.setData({
      activeSubIndex: index,
      activeSubName: sub.name,
      materials: sub.materials || [],
      activeMaterial: null,
      thicknessOptions: [],
      sizeOptions: [],
      selectedThickness: '',
      selectedSize: '',
      craftOptions: [],
      selectedCrafts: []
    });
  },

  /** 选材质 */
  onMaterialTap(e) {
    const index = Number(e.currentTarget.dataset.index);
    const materials = this.data.materials;
    this.selectMaterial(index, materials);
  },

  selectMaterial(index, materials) {
    const m = materials[index];
    if (!m) return;
    this.setData({
      activeMaterial: m,
      thicknessOptions: m.thickness || [],
      sizeOptions: m.size || [],
      selectedThickness: '',
      selectedSize: '',
      craftOptions: m.craft || [],
      selectedCrafts: []
    });
  },

  /** 选规格 */
  onThicknessTap(e) {
    const v = e.currentTarget.dataset.value;
    this.setData({ selectedThickness: this.data.selectedThickness === v ? '' : v });
  },
  onSizeTap(e) {
    const v = e.currentTarget.dataset.value;
    this.setData({ selectedSize: this.data.selectedSize === v ? '' : v });
  },

  /** 选工艺（多选） */
  onCraftToggle(e) {
    const v = e.currentTarget.dataset.value;
    const list = this.data.selectedCrafts.slice();
    const idx = list.indexOf(v);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(v);
    this.setData({ selectedCrafts: list });
  },

  onQuantityInput(e) { this.setData({ quantity: e.detail.value }); },
  onAreaInput(e) { this.setData({ area: e.detail.value }); },
  onSizeDescInput(e) { this.setData({ sizeDesc: e.detail.value }); },

  /**
   * 参考图变更（uploader，C-UPLOAD@1）
   * 消费组件 change 事件 detail.fileIds（纯 cloud:// fileID 字符串数组），
   * 归一化后写入 referenceFiles，既用于回填组件预览，也作为提交源，保留脏数据过滤与数量上限。
   */
  onRefChange(e) {
    const d = (e && e.detail) || {};
    const raw = d.fileIds || d.fileList || [];
    const fileIds = normalizeReferenceFileIds(raw, this.data.maxCount);
    this.setData({ referenceFiles: fileIds });
  },

  /** 手机号授权（button open-type=getPhoneNumber） */
  onGetPhoneNumber(e) {
    getPhoneNumber(e)
      .then((data) => {
        const phone = (data && data.phone) || '';
        const masked = (data && data.phoneMasked) || '';
        if (!phone) {
          this.setData({ manualInput: true });
          wx.showToast({ title: '手机号不可用，请手动填写', icon: 'none' });
          return;
        }
        this.setData({ phone: phone, phoneMasked: masked, manualInput: false });
      })
      .catch(() => {
        this.setData({ manualInput: true });
      });
  },

  toggleManual() {
    this.setData({ manualInput: true, phone: '', phoneMasked: '' });
  },
  onManualPhoneInput(e) {
    this.setData({ manualPhone: e.detail.value });
  },

  /** 校验 */
  validate() {
    const m = this.data.activeMaterial;
    if (!this.data.activeCategory || !m) {
      wx.showToast({ title: '请选择材质', icon: 'none' });
      return false;
    }
    const qty = parseInt(this.data.quantity, 10);
    const hasArea = this.data.area && Number(this.data.area) > 0;
    if ((isNaN(qty) || qty < 1) && !hasArea) {
      wx.showToast({ title: '请填写数量或面积', icon: 'none' });
      return false;
    }
    return true;
  },

  /** 提交需求 */
  onSubmit() {
    if (this.data.submitting) return;
    if (!this.validate()) return;

    const { phone, manualPhone } = this.data;
    const contactPhone = phone || manualPhone.trim();

    requireLogin({ message: '提交定制需求需要登录，是否立即登录？' }).then((ok) => {
      if (!ok) return;
      // 第一批注册入口：资料不全（姓名/手机号/收货地址）先引导补齐
      profile.requireOrderProfile().then((ready) => {
        if (ready) this.submitOrder(contactPhone);
      });
    });
  },

  /** 组装结构化 payload 并调用 createCustomOrder */
  submitOrder(contactPhone) {
    const m = this.data.activeMaterial;
    const qty = parseInt(this.data.quantity, 10);
    const area = Number(this.data.area) > 0 ? Number(this.data.area) : null;
    // 参考图：统一消费 C-UPLOAD@1 产出的 cloud:// fileID 数组（保留过滤 + 上限兜底）
    const referenceFileIds = normalizeReferenceFileIds(this.data.referenceFiles, this.data.maxCount);

    const payload = {
      materialType: this.data.activeCategoryName, // 大类名作为 materialType
      category: this.data.activeCategory,
      categoryName: this.data.activeCategoryName,
      materialName: m.name,
      materialCode: m.code,
      spec: {
        thickness: this.data.selectedThickness,
        size: this.data.selectedSize,
        color: ''
      },
      crafts: this.data.selectedCrafts,
      size: [this.data.selectedThickness, this.data.selectedSize].filter(Boolean).join('/'),
      sizeDesc: this.data.sizeDesc,
      quantity: isNaN(qty) ? 0 : qty,
      area: area,
      requirement: this.buildRequirementSummary(),
      contactPhone: contactPhone,
      referenceFileIds: referenceFileIds,
      clientRequestId: genClientRequestId('co')
    };

    this.setData({ submitting: true });
    callFunction('createCustomOrder', {
      payload: payload,
      lockKey: 'createCustomOrder',
      loading: true,
      showError: true
    })
      .then((data) => {
        this.setData({ submitting: false });
        const orderId = (data && data.orderId) || '';
        wx.showToast({ title: '提交成功，商家将尽快报价', icon: 'none', duration: 2000 });
        setTimeout(() => {
          wx.redirectTo({ url: '/pages/order-detail/order-detail?id=' + orderId });
        }, 800);
      })
      .catch(() => {
        this.setData({ submitting: false });
      });
  },

  /** 生成需求摘要（供商家快速理解，冗余兜底） */
  buildRequirementSummary() {
    const m = this.data.activeMaterial;
    const parts = [
      this.data.activeSubName,
      m ? m.name : '',
      this.data.selectedThickness ? '厚度' + this.data.selectedThickness : '',
      this.data.selectedSize ? '尺寸' + this.data.selectedSize : '',
      this.data.sizeDesc ? '规格' + this.data.sizeDesc : '',
      this.data.quantity ? '数量' + this.data.quantity : '',
      this.data.area ? '面积' + this.data.area + '㎡' : '',
      this.data.selectedCrafts.length ? '工艺：' + this.data.selectedCrafts.join('、') : ''
    ];
    return parts.filter(Boolean).join('；');
  },

  onRetry() {
    this.fetchLibrary();
  }
});