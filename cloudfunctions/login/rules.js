/**
 * 订单 / 支付 / 隐私 / 计量的纯函数。
 * 云函数目录内的 rules.js 必须与本文件保持一致（微信云函数只上传各自目录）。
 * 单测直接引用本文件。
 */

const PAYMENT_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const PRIVACY_POLICY_VERSION = '2026-11-06';
const MAX_QUANTITY = 9999;
const MAX_AREA = 100000;
const QUOTE_STATUS = 'pending_quote';
const PAY_STATUS = 'pending_payment';
const PAID_AFTER_CANCEL = 'paid_after_cancel';
const CANCELLABLE = ['pending_payment', 'pending_quote'];

function yuanToFen(amount) {
  const n = Number(amount);
  if (!isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100);
}

function fenToYuan(fen) {
  return Math.round(Number(fen)) / 100;
}

function resolveAmountFen(order) {
  if (!order) return 0;
  const rawFen = order.amountFen;
  if (rawFen !== undefined && rawFen !== null && isFinite(Number(rawFen))) {
    const fen = Math.round(Number(rawFen));
    if (fen > 0) return fen;
  }
  return Math.round(Number(order.amount) * 100);
}

function updatedCount(res) {
  if (!res || typeof res !== 'object') return 0;
  if (res.stats && typeof res.stats.updated === 'number') return res.stats.updated;
  if (typeof res.updated === 'number') return res.updated;
  return 0;
}

function canSubmitQuote(status) {
  return status === QUOTE_STATUS;
}

/**
 * 新报价：写入金额（分）与报价版本，清空已缓存的预支付参数。
 * 版本 > 1 时更换 outTradeNo，避免微信按旧金额复用同一商户单号。
 */
function buildQuoteFields(order, amount, description, validUntil) {
  const amountFen = yuanToFen(amount);
  const quoteVersion = (Number(order && order.quoteVersion) || 0) + 1;
  const orderNo = (order && order.orderNo) || '';
  const payOutTradeNo = quoteVersion <= 1 ? orderNo : orderNo + 'Q' + quoteVersion;
  const yuan = fenToYuan(amountFen);
  return {
    amount: yuan,
    amountFen: amountFen,
    quoteVersion: quoteVersion,
    payOutTradeNo: payOutTradeNo,
    payments: [],
    status: PAY_STATUS,
    quote: {
      amount: yuan,
      description: description || '',
      validUntil: Number(validUntil) || 0,
      status: 'active',
      version: quoteVersion
    }
  };
}

function resolvePayOutTradeNo(order) {
  if (!order) return '';
  return order.payOutTradeNo || order.orderNo || '';
}

/**
 * 仅当商户单号、金额（分）、报价版本都一致且未过期时复用预支付参数。
 * 命中同一 outTradeNo 但金额或版本不同，视为失效，不再向前翻找。
 */
function findReusablePayment(history, outTradeNo, amountFen, quoteVersion, now, ttl) {
  const list = Array.isArray(history) ? history : [];
  const limit = ttl > 0 ? ttl : PAYMENT_CACHE_TTL_MS;
  const fee = Number(amountFen);
  const version = Number(quoteVersion) || 0;
  const ts = Number(now) || 0;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const p = list[i];
    if (!p || p.outTradeNo !== outTradeNo) continue;
    const fresh = p.status === 'created' && p.payment && p.attemptAt && (ts - Number(p.attemptAt)) < limit;
    const sameMoney = Number(p.totalFee) === fee;
    const sameVersion = (Number(p.quoteVersion) || 0) === version;
    if (fresh && sameMoney && sameVersion) return p;
    return null;
  }
  return null;
}

function decideCancel(order, openid) {
  if (!order || order.openid !== openid) {
    return { ok: false, code: 8001, message: '无权操作该订单' };
  }
  if (order.status === 'cancelled') {
    return { ok: false, code: 8003, message: '订单已取消' };
  }
  if (CANCELLABLE.indexOf(order.status) === -1) {
    return { ok: false, code: 8002, message: '已支付订单请联系商家' };
  }
  return { ok: true, from: order.status, to: 'cancelled' };
}

/**
 * 支付回调决策。同一 transactionId 已落账则幂等成功。
 * 金额不一致不标记已付。待付款 → 制作中；已取消 → paid_after_cancel（待人工退款）。
 */
function decidePayCallback(order, input) {
  const info = input || {};
  const txn = info.transactionId || '';
  const paidTxn = order && order.payment && order.payment.transactionId;
  if (txn && paidTxn && paidTxn === txn) return { action: 'idempotent' };

  const totalFee = Number(info.totalFee);
  const expectFen = Number(info.expectFen);
  if (!isFinite(totalFee) || totalFee !== expectFen) return { action: 'amount_mismatch' };

  if (order && order.status === PAY_STATUS) return { action: 'mark_paid' };
  if (order && order.status === 'cancelled') return { action: 'paid_after_cancel' };
  if (paidTxn) return { action: 'idempotent' };
  return { action: 'anomaly', reason: 'status_' + ((order && order.status) || 'unknown') };
}

function hasActiveConsent(user, version) {
  const expected = version || PRIVACY_POLICY_VERSION;
  if (!user || typeof user !== 'object') return false;
  const agreedAt = Number(user.privacyAgreedAt) || 0;
  if (!(agreedAt > 0)) return false;
  if ((user.privacyConsentVersion || '') !== expected) return false;
  const withdrawnAt = Number(user.privacyWithdrawnAt) || 0;
  if (withdrawnAt && withdrawnAt >= agreedAt) return false;
  return true;
}

function parseQuantity(value) {
  if (value === '' || value === null || value === undefined) {
    return { present: false, valid: false, value: 0 };
  }
  const s = String(value).trim();
  if (!s) return { present: false, valid: false, value: 0 };
  if (!/^\d+$/.test(s)) return { present: true, valid: false, value: 0 };
  const n = parseInt(s, 10);
  // 0 视为没填数量，好让「只填面积」通过；超过上限才算填写了但不合法
  if (n === 0) return { present: false, valid: false, value: 0 };
  if (n > MAX_QUANTITY) return { present: true, valid: false, value: 0 };
  return { present: true, valid: true, value: n };
}

function parseArea(value) {
  if (value === '' || value === null || value === undefined) {
    return { present: false, valid: false, value: null };
  }
  const s = String(value).trim();
  if (!s) return { present: false, valid: false, value: null };
  if (!/^\d+(\.\d+)?$/.test(s)) return { present: true, valid: false, value: null };
  const n = Number(s);
  if (!isFinite(n)) return { present: true, valid: false, value: null };
  if (n === 0) return { present: false, valid: false, value: null };
  if (n > MAX_AREA) return { present: true, valid: false, value: null };
  return { present: true, valid: true, value: Math.round(n * 100) / 100 };
}

/** 正整数数量，或有限正数面积，至少一项合法。填写了但不合法则整单拒绝。 */
function resolveMeasure(quantity, area) {
  const q = parseQuantity(quantity);
  const a = parseArea(area);
  if ((q.present && !q.valid) || (a.present && !a.valid)) {
    return { ok: false, message: '数量或面积超出范围', quantity: 0, area: null };
  }
  if (!q.valid && !a.valid) {
    return { ok: false, message: '请填写数量或面积', quantity: 0, area: null };
  }
  return {
    ok: true,
    message: '',
    quantity: q.valid ? q.value : 0,
    area: a.valid ? a.value : null
  };
}

function maskPhone(phone) {
  const s = String(phone || '');
  if (/^\d{11}$/.test(s)) return s.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2');
  if (s.length >= 7) return s.slice(0, 3) + '****' + s.slice(-4);
  return s ? '****' : '';
}

function publicPhoneFields(phone) {
  const s = String(phone || '').trim();
  if (/^1[3-9]\d{9}$/.test(s)) {
    return { phone: '', phoneMasked: maskPhone(s), hasPhone: true };
  }
  return { phone: '', phoneMasked: '', hasPhone: false };
}

/** 登录态缓存用：只留展示字段，不带街道门牌与明文手机号。 */
function toDisplayAddress(addr) {
  if (!addr || typeof addr !== 'object') return null;
  const raw = typeof addr.phone === 'string' ? addr.phone.trim() : '';
  let phoneMasked = '';
  if (/^1[3-9]\d{9}$/.test(raw)) phoneMasked = maskPhone(raw);
  else if (raw.indexOf('*') !== -1) phoneMasked = raw;
  else if (addr.phoneMasked) phoneMasked = String(addr.phoneMasked);
  const province = addr.province || '';
  const city = addr.city || '';
  const county = addr.county || '';
  return {
    addressId: addr.addressId || '',
    name: addr.name || '',
    phoneMasked: phoneMasked,
    province: province,
    city: city,
    county: county,
    regionText: [province, city, county].filter(Boolean).join(' '),
    isDefault: addr.isDefault === true
  };
}

function toPublicUser(user) {
  const src = user || {};
  const phone = publicPhoneFields(src.phone);
  const addresses = Array.isArray(src.addresses)
    ? src.addresses.map(toDisplayAddress).filter(Boolean)
    : [];
  return {
    openid: src.openid,
    nickName: src.nickName || '',
    avatarUrl: src.avatarUrl || '',
    phone: phone.phone,
    phoneMasked: phone.phoneMasked,
    hasPhone: phone.hasPhone,
    role: src.role || 'customer',
    realName: src.realName || '',
    company: src.company || '',
    customerType: src.customerType || 'personal',
    industry: src.industry || '',
    invoiceTitle: src.invoiceTitle || '',
    taxNo: src.taxNo || '',
    addresses: addresses,
    privacyAgreedAt: src.privacyAgreedAt || 0,
    privacyConsentVersion: src.privacyConsentVersion || '',
    privacyWithdrawnAt: src.privacyWithdrawnAt || 0,
    privacyDeletionRequestedAt: src.privacyDeletionRequestedAt || 0
  };
}

function isFullMobile(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || '').trim());
}

/** 资料是否已有可用手机号：以 hasPhone 或完整 11 位为准，脱敏串不算。 */
function hasContactPhone(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.hasPhone === true) return true;
  return isFullMobile(user.phone);
}

function pollCursor(since, sinceId) {
  const s = Number(since);
  return {
    since: isFinite(s) && s > 0 ? s : 0,
    sinceId: typeof sinceId === 'string' ? sinceId : ''
  };
}

function isAfterCursor(order, cursor) {
  const cur = pollCursor(cursor && cursor.since, cursor && cursor.sinceId);
  const updatedAt = Number(order && order.updatedAt) || 0;
  const id = String((order && (order.orderId || order._id)) || '');
  if (updatedAt > cur.since) return true;
  if (updatedAt < cur.since) return false;
  return !!id && id > cur.sinceId;
}

function nextSeq(seq) {
  const n = Number(seq) || 0;
  return n + 1;
}

function isCurrentResponse(seq, current) {
  return seq === current;
}

function planOrdersShow(loggedIn) {
  if (!loggedIn) {
    return {
      action: 'login',
      patch: { needLogin: true, loading: false, list: [], empty: false, loadError: null }
    };
  }
  return { action: 'reload', patch: { needLogin: false } };
}

module.exports = {
  PAYMENT_CACHE_TTL_MS,
  PRIVACY_POLICY_VERSION,
  MAX_QUANTITY,
  MAX_AREA,
  QUOTE_STATUS,
  PAY_STATUS,
  PAID_AFTER_CANCEL,
  CANCELLABLE,
  yuanToFen,
  fenToYuan,
  resolveAmountFen,
  updatedCount,
  canSubmitQuote,
  buildQuoteFields,
  resolvePayOutTradeNo,
  findReusablePayment,
  decideCancel,
  decidePayCallback,
  hasActiveConsent,
  parseQuantity,
  parseArea,
  resolveMeasure,
  maskPhone,
  publicPhoneFields,
  toDisplayAddress,
  toPublicUser,
  isFullMobile,
  hasContactPhone,
  pollCursor,
  isAfterCursor,
  nextSeq,
  isCurrentResponse,
  planOrdersShow
};
