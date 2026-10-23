/**
 * 格式化工具（REQ-043、REQ-050）
 * - 金额格式化（元/分换算、¥ 前缀、千分位、¥xx 起）
 * - 时间格式化（毫秒时间戳 → YYYY-MM-DD HH:mm、相对时间「x 分钟前」）
 * - 敏感信息脱敏（手机号 173****3179、姓名、地址）
 */

/** 安全转数字 */
function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/** 千分位整数/小数 */
function withThousands(numStr) {
  const parts = String(numStr).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/**
 * 金额格式化
 * @param {number} value 金额
 * @param {object} [options]
 * @param {'yuan'|'fen'} [options.unit='yuan'] 传入金额的单位，分会自动换算为元
 * @param {string} [options.prefix='¥'] 前缀
 * @param {boolean} [options.from=false] 是否追加「起」
 * @param {number} [options.decimals=2] 小数位；整数金额自动省略小数
 * @param {boolean} [options.thousands=true] 是否千分位
 * @returns {string} 如 ¥35、¥1,299.50、¥35 起
 */
function formatAmount(value, options) {
  const opts = Object.assign(
    { unit: 'yuan', prefix: '¥', from: false, decimals: 2, thousands: true },
    options || {}
  );
  let num = toNumber(value);
  if (opts.unit === 'fen') {
    num = num / 100;
  }
  // 金额为整数时不展示多余小数位
  const isInt = Math.abs(num - Math.round(num)) < 1e-9;
  const fixed = isInt ? String(Math.round(num)) : num.toFixed(opts.decimals);
  const shown = opts.thousands ? withThousands(fixed) : fixed;
  return `${opts.prefix}${shown}${opts.from ? ' 起' : ''}`;
}

/** 补零 */
function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 时间格式化
 * @param {number|string|Date} ts 毫秒时间戳 / 时间字符串 / Date
 * @param {string} [pattern='YYYY-MM-DD HH:mm']
 * @returns {string} 非法时间返回空串
 */
function formatTime(ts, pattern) {
  if (ts === null || ts === undefined || ts === '') return '';
  const date = ts instanceof Date ? ts : new Date(Number(ts));
  if (isNaN(date.getTime())) return '';
  const fmt = pattern || 'YYYY-MM-DD HH:mm';
  const map = {
    YYYY: String(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    DD: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds())
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (key) => map[key]);
}

/**
 * 相对时间文案（设计 §2.2 时间线展示）
 * @returns {string} 刚刚 / x 分钟前 / x 小时前 / x 天前 / 具体日期
 */
function fromNow(ts) {
  const time = Number(ts);
  if (!Number.isFinite(time) || time <= 0) return '';
  const diff = Date.now() - time;
  if (diff < 60 * 1000) return '刚刚';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`;
  if (diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / (24 * 60 * 60 * 1000))} 天前`;
  return formatTime(time, 'YYYY-MM-DD');
}

/**
 * 手机号脱敏：17306983179 → 173****3179
 * 非法手机号原样返回（避免抛错）
 */
function maskPhone(phone) {
  const str = String(phone === null || phone === undefined ? '' : phone).trim();
  if (!str) return '';
  const digits = str.replace(/\D/g, '');
  if (digits.length !== 11) {
    // 非标准 11 位号码做通用保留头尾的兜底脱敏
    if (str.length <= 4) return str.replace(/./g, '*');
    return `${str.slice(0, 2)}****${str.slice(-2)}`;
  }
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

/** 姓名脱敏：张三 → 张*；欧阳娜娜 → 欧**娜 */
function maskName(name) {
  const str = String(name || '').trim();
  if (!str) return '';
  if (str.length === 1) return str;
  if (str.length === 2) return `${str[0]}*`;
  return `${str[0]}${'*'.repeat(str.length - 2)}${str[str.length - 1]}`;
}

/** 地址脱敏：仅保留前 6 个字符，其余以 * 省略 */
function maskAddress(address) {
  const str = String(address || '').trim();
  if (!str) return '';
  if (str.length <= 6) return `${str.slice(0, 2)}****`;
  return `${str.slice(0, 6)}****`;
}

/** 校验中国大陆手机号（REQ-024 地址/联系方式格式校验） */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(String(phone || '').replace(/\s|-/g, ''));
}

module.exports = {
  toNumber,
  formatAmount,
  formatTime,
  fromNow,
  maskPhone,
  maskName,
  maskAddress,
  isValidPhone
};