/**
 * 图片上传器（REQ-028 / C-UPLOAD@1）
 *
 * 核心修复：选图后必须调用 wx.cloud.uploadFile({ cloudPath, filePath }) 上传至云存储，
 * 并以返回的 fileID（cloud://...）作为该项的值；本地 tempFilePath 仅用于上传前预览，
 * 上传成功后替换为 fileID。triggerEvent('change', { fileIds }) 中的 fileIds 为
 * 纯 fileID 字符串数组，不再以本地临时路径冒充。
 *
 * 约束：
 *   - 单图大小上限 UPLOAD_LIMITS.MAX_SIZE_MB（5MB）；数量上限 UPLOAD_LIMITS.MAX_COUNT（6）；
 *   - cloudPath 约定 custom-refs/{非敏感标识}/{timestamp}-{rand}.{ext}，不含手机号等敏感信息；
 *   - 上传失败：提示重试并移除该项，不影响其他项；超限：阻止并提示。
 */
const UPLOAD_CONSTANTS = require('../../utils/constants.js');

// UPLOAD_LIMITS 已由 utils/constants.js 提供；此处兜底仅为防御性编程（正常不会命中）。
// 注意：constants.js 归 T9 独占，本组件不修改该文件；若 T9 调整常量，此处自动跟随。
const UPLOAD_LIMITS =
  (UPLOAD_CONSTANTS && UPLOAD_CONSTANTS.UPLOAD_LIMITS) || { MAX_COUNT: 6, MAX_SIZE_MB: 5 };

/** 云存储目录前缀（C-UPLOAD@1 约定） */
const CLOUD_DIR = 'custom-refs';

/**
 * 非敏感目录标识的本地缓存 key。
 * 组件侧无法直接读取 openid，且契约要求 cloudPath 不得含敏感信息，
 * 故为每台设备生成一个随机、无敏感语义的目录标识，替代 openid 明文。
 */
const OWNER_KEY_STORAGE = 'refUploadOwnerKey';

/** 生成指定长度的随机字母数字串（用于 cloudPath 去重，避免同秒冲突） */
function randomSuffix(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const n = len || 6;
  let out = '';
  for (let i = 0; i < n; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/** 从临时文件路径解析扩展名，去掉 query，缺省为 jpg */
function extFromPath(filePath) {
  const clean = String(filePath || '').split('?')[0];
  const dot = clean.lastIndexOf('.');
  if (dot < 0 || dot === clean.length - 1) return 'jpg';
  const ext = clean.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'jpg';
}

/** 获取或生成非敏感目录标识（不含手机号、openid 等敏感信息） */
function resolveOwnerKey() {
  let key = '';
  try {
    key = wx.getStorageSync(OWNER_KEY_STORAGE) || '';
  } catch (e) {
    key = '';
  }
  if (!key || typeof key !== 'string') {
    key = 'u_' + Date.now().toString(36) + '_' + randomSuffix(6);
    try {
      wx.setStorageSync(OWNER_KEY_STORAGE, key);
    } catch (e) {
      // 存储失败不阻塞上传：退回一次性随机标识
    }
  }
  return key;
}

/** 两个字符串数组是否完全一致（顺序敏感）：用于 observer 判定外部回写 */
function sameList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

Component({
  options: { styleIsolation: 'apply-shared' },

  properties: {
    // 外部传入的 fileID 列表（cloud:// 字符串数组）
    fileIds: { type: Array, value: [] },
    // 数量上限，默认取 UPLOAD_LIMITS.MAX_COUNT（6）
    maxCount: { type: Number, value: UPLOAD_LIMITS.MAX_COUNT }
  },

  data: {
    // 列表项结构：{ uid, url, fileId, status, progress }
    //   url     预览地址（上传中为 tempFilePath，完成后可用 fileID 预览）
    //   fileId  云存储 fileID（cloud://），上传中为空字符串
    //   status  'uploading' | 'done'
    //   progress 上传进度 0-100
    list: [],
    maxSizeMb: UPLOAD_LIMITS.MAX_SIZE_MB
  },

  observers: {
    /**
     * 外部 fileIds 变化时同步内部列表。
     * 若外部回写的正是本组件刚刚 emit 的已完成 fileIDs（上传中项尚未包含在内），
     * 则跳过重建，避免丢失正在上传的占位项。
     */
    fileIds(val) {
      const incoming = Array.isArray(val) ? val.filter((x) => typeof x === 'string' && x) : [];
      const currentDone = this.data.list
        .filter((it) => it.status === 'done' && it.fileId)
        .map((it) => it.fileId);
      if (sameList(incoming, currentDone)) return;

      const list = incoming.map((id) => ({
        uid: 'ref_' + randomSuffix(10),
        url: id,
        fileId: id,
        status: 'done',
        progress: 100
      }));
      this.setData({ list });
    }
  },

  methods: {
    /** 选图（相册/拍照）→ 过滤超限 → 逐张上传 */
    onChoose() {
      const max = this.data.maxCount || UPLOAD_LIMITS.MAX_COUNT;
      const usable = this.data.list.filter((it) => it.status !== 'error');
      if (usable.length >= max) {
        wx.showToast({ title: '最多上传 ' + max + ' 张', icon: 'none' });
        return;
      }
      const remain = max - usable.length;

      wx.chooseMedia({
        count: remain,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        success: (res) => {
          const files = (res.tempFiles || []).filter((f) => f && f.tempFilePath);
          const maxBytes = UPLOAD_LIMITS.MAX_SIZE_MB * 1024 * 1024;

          const accepted = [];
          let oversize = 0;
          files.forEach((f) => {
            if (f.size && f.size > maxBytes) {
              oversize += 1;
              return;
            }
            accepted.push(f);
          });

          if (oversize > 0) {
            wx.showToast({
              title: '有 ' + oversize + ' 张超过 ' + UPLOAD_LIMITS.MAX_SIZE_MB + 'MB，已忽略',
              icon: 'none'
            });
          }
          if (!accepted.length) return;

          // 逐张上传；每张独立处理，失败仅移除该项，不影响其他项
          accepted.forEach((f) => this.uploadOne(f));
        },
        fail: (err) => {
          // 用户取消选图不提示；其他失败给出提示
          const msg = (err && err.errMsg) || '';
          if (msg.indexOf('cancel') === -1) {
            wx.showToast({ title: '选择图片失败，请重试', icon: 'none' });
          }
        }
      });
    },

    /** 上传单张图片：占位 → wx.cloud.uploadFile → fileID 替换 */
    uploadOne(file) {
      const tempFilePath = file.tempFilePath;
      const uid = 'ref_' + randomSuffix(10);
      const placeholder = {
        uid: uid,
        url: tempFilePath,
        fileId: '',
        status: 'uploading',
        progress: 0
      };
      this.setData({ list: this.data.list.concat([placeholder]) });

      const cloudPath = this.buildCloudPath(tempFilePath);

      let task;
      try {
        task = wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempFilePath,
          success: (res) => {
            const fileID = res && res.fileID;
            if (!fileID) {
              // 未拿到 fileID：按失败处理，避免用临时路径冒充
              this.removeByUid(uid, '上传失败，请重试');
              return;
            }
            this.updateItem(uid, { fileId: fileID, status: 'done', progress: 100 });
            this.emitChange();
          },
          fail: () => {
            this.removeByUid(uid, '上传失败，请重试');
          }
        });
      } catch (e) {
        // wx.cloud 未初始化或能力不可用
        this.removeByUid(uid, '上传失败，请重试');
        return;
      }

      if (task && typeof task.onProgressUpdate === 'function') {
        task.onProgressUpdate((p) => {
          this.updateItem(uid, { progress: (p && p.progress) || 0 });
        });
      }
    },

    /** 生成 cloudPath：custom-refs/{非敏感标识}/{timestamp}-{rand}.{ext} */
    buildCloudPath(tempFilePath) {
      const ext = extFromPath(tempFilePath);
      const owner = resolveOwnerKey();
      const name = 'ref-' + Date.now() + '-' + randomSuffix(6) + '.' + ext;
      return CLOUD_DIR + '/' + owner + '/' + name;
    },

    /** 按 uid 局部更新列表项 */
    updateItem(uid, patch) {
      const list = this.data.list.map((it) =>
        it.uid === uid ? Object.assign({}, it, patch) : it
      );
      this.setData({ list: list });
    },

    /** 按 uid 移除列表项并（可选）提示 */
    removeByUid(uid, toastTitle) {
      const list = this.data.list.filter((it) => it.uid !== uid);
      this.setData({ list: list });
      if (toastTitle) {
        wx.showToast({ title: toastTitle, icon: 'none' });
      }
      this.emitChange();
    },

    /** 仅上报已完成项的纯 fileID 数组 */
    emitChange() {
      const fileIds = this.data.list
        .filter((it) => it.status === 'done' && it.fileId)
        .map((it) => it.fileId);
      this.triggerEvent('change', { fileIds: fileIds });
    },

    /** 预览：上传中预览本地临时图，完成后预览云图 */
    onPreview(e) {
      const uid = e.currentTarget.dataset.uid;
      const current = this.data.list.filter((it) => it.uid === uid)[0];
      if (!current || !current.url) return;
      const urls = this.data.list.map((it) => it.url).filter(Boolean);
      wx.previewImage({ current: current.url, urls: urls });
    },

    /** 删除指定项 */
    onRemove(e) {
      const uid = e.currentTarget.dataset.uid;
      const list = this.data.list.filter((it) => it.uid !== uid);
      this.setData({ list: list });
      this.emitChange();
    }
  }
});