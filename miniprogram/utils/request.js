/**
 * 云函数统一调用封装（REQ-003、REQ-025、REQ-038）
 * 所有请求经此统一处理：加载态、响应信封解析、异常提示、重试分类、防重复提交锁、超时控制。
 *
 * 请求信封：{ action?, payload: {...} }
 * 响应信封：{ code: 0, data, message } 成功 / { code 非0, data: null, message } 失败
 */
const {
  ERROR_MESSAGES,
  NETWORK_ERROR_MESSAGE,
  REQUEST_TIMEOUT
} = require('./constants.js');

/** 进行中的写操作锁集合（lockKey → true），防止重复提交 */
const pendingLocks = new Set();

/** 加载态引用计数，避免并发请求互相提前 hideLoading */
let loadingCount = 0;

/** 构造结构化错误对象 */
function createError(code, message, options) {
  const opts = options || {};
  return {
    code: code,
    message: message || ERROR_MESSAGES[code] || '操作失败，请重试',
    retriable: opts.retriable !== false, // 默认允许重试
    network: !!opts.network,
    raw: opts.raw || null
  };
}

function showLoading(title) {
  loadingCount += 1;
  if (loadingCount === 1) {
    wx.showLoading({ title: title || '加载中', mask: true });
  }
}

function hideLoading() {
  loadingCount = Math.max(0, loadingCount - 1);
  if (loadingCount === 0) {
    wx.hideLoading();
  }
}

/** 展示错误提示（优先使用后端中文 message） */
function toastError(message) {
  wx.showToast({ title: message || '操作失败', icon: 'none', duration: 2200 });
}

/**
 * 判断错误是否可重试
 * - 网络异常 / 超时 / 5xx 类 → 可重试
 * - 业务错误（如参数非法、无权限、状态已变更）→ 不可重试
 */
const NON_RETRIABLE_CODES = [
  1001, 2001, 2002, 4001, 5001, 5002, 5004, 6001, 7001, 7002, 8001, 8002, 9002, 'A001', 'A002'
];

function isRetriable(code) {
  return NON_RETRIABLE_CODES.indexOf(code) === -1;
}

/**
 * 调用云函数
 * @param {string} name 云函数名
 * @param {object} [options]
 * @param {string} [options.action] 业务动作（可选）
 * @param {object} [options.payload] 业务参数
 * @param {boolean} [options.loading=false] 是否展示全局 loading
 * @param {string} [options.loadingText='加载中'] loading 文案
 * @param {boolean} [options.showError=true] 失败时是否自动 toast
 * @param {string} [options.lockKey=''] 防重复提交锁标识（写操作必填，如 'createOrder:productId'）
 * @param {number} [options.timeout=10000] 超时毫秒
 * @returns {Promise<any>} resolve 为响应信封的 data；reject 为结构化错误对象
 */
function callFunction(name, options) {
  const opts = options || {};
  const payload = opts.payload || {};
  const lockKey = opts.lockKey || '';
  const timeout = opts.timeout || REQUEST_TIMEOUT;
  const showError = opts.showError !== false;

  // 防重复提交：同一 lockKey 在未返回前拒绝再次发起
  if (lockKey) {
    if (pendingLocks.has(lockKey)) {
      const dupErr = createError('DUPLICATE', '操作处理中，请勿重复提交', { retriable: false });
      if (showError) toastError(dupErr.message);
      return Promise.reject(dupErr);
    }
    pendingLocks.add(lockKey);
  }

  if (opts.loading) showLoading(opts.loadingText);

  const release = () => {
    if (lockKey) pendingLocks.delete(lockKey);
    if (opts.loading) hideLoading();
  };

  return new Promise((resolve, reject) => {
    if (!wx.cloud || !wx.cloud.callFunction) {
      release();
      const err = createError('CLOUD_UNAVAILABLE', '当前环境不支持云开发能力，请升级微信版本', {
        retriable: false
      });
      if (showError) toastError(err.message);
      reject(err);
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      release();
      const err = createError('TIMEOUT', NETWORK_ERROR_MESSAGE, { network: true });
      if (showError) toastError(err.message);
      reject(err);
    }, timeout);

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      release();
      fn(arg);
    };

    wx.cloud
      .callFunction({
        name: name,
        data: { action: opts.action, payload: payload }
      })
      .then((res) => {
        const result = (res && res.result) || {};
        if (result.code === 0) {
          finish(resolve, result.data);
          return;
        }
        const code = result.code;
        const err = createError(code, result.message, {
          retriable: isRetriable(code),
          raw: result
        });
        if (showError) toastError(err.message);
        finish(reject, err);
      })
      .catch((rawErr) => {
        console.error(`[request] 调用云函数 ${name} 失败`, rawErr);
        const err = createError('NETWORK_ERROR', NETWORK_ERROR_MESSAGE, {
          network: true,
          raw: rawErr
        });
        if (showError) toastError(err.message);
        finish(reject, err);
      });
  });
}

/**
 * 为页面统一生成「加载失败 + 重试」的错误态数据。
 * 页面 catch 到错误后调用，可直接用于渲染重试视图。
 */
function buildErrorState(error) {
  const err = error || {};
  return {
    error: true,
    message: err.message || '加载失败，请重试',
    retriable: err.retriable !== false
  };
}

/** 写操作锁是否进行中（供按钮置灰态判断） */
function isLocked(lockKey) {
  return pendingLocks.has(lockKey);
}

module.exports = {
  callFunction,
  buildErrorState,
  isLocked,
  createError,
  toastError,
  showLoading,
  hideLoading
};