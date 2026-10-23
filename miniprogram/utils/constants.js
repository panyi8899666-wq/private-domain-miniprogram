/**
 * 全局常量与枚举（design §2.1.5 订单状态机、§2.2.2 错误码）
 * 页面与组件统一从此处引用，避免硬编码散落（REQ-035）
 */

/** 订单状态枚举（取值与 design §2.1.5 / §2.3.4 完全一致） */
const ORDER_STATUS = {
  PENDING_QUOTE: 'pending_quote', // 待报价（仅定制订单起始态）
  PENDING_PAYMENT: 'pending_payment', // 待付款
  MAKING: 'making', // 制作中
  COMPLETED: 'completed', // 已完成
  CANCELLED: 'cancelled', // 已取消
  REFUNDED: 'refunded' // 已退款（P2）
};

/** 订单状态中文名映射 */
const ORDER_STATUS_TEXT = {
  pending_quote: '待报价',
  pending_payment: '待付款',
  making: '制作中',
  completed: '已完成',
  cancelled: '已取消',
  refunded: '已退款'
};

/**
 * 订单状态配色语义（design §2.4.4）
 * color: 文字色；bg: 背景色；border: 描边色
 */
const ORDER_STATUS_STYLE = {
  pending_quote: { color: '#ffc24b', bg: 'rgba(255,194,75,0.12)', border: 'rgba(255,194,75,0.45)' },
  pending_payment: { color: '#ffc24b', bg: 'rgba(255,194,75,0.12)', border: 'rgba(255,194,75,0.45)' },
  making: { color: '#3ec6ff', bg: 'rgba(62,198,255,0.12)', border: 'rgba(62,198,255,0.5)' },
  completed: { color: '#3ddc97', bg: 'rgba(61,220,151,0.12)', border: 'rgba(61,220,151,0.45)' },
  cancelled: { color: '#5c6b7e', bg: 'rgba(92,107,126,0.12)', border: 'rgba(92,107,126,0.4)' },
  refunded: { color: '#9dabc0', bg: 'rgba(157,171,192,0.12)', border: 'rgba(157,171,192,0.4)' }
};

/** 订单状态筛选项（我的订单页，REQ-034） */
const ORDER_STATUS_FILTERS = [
  { value: '', label: '全部' },
  { value: ORDER_STATUS.PENDING_QUOTE, label: '待报价' },
  { value: ORDER_STATUS.PENDING_PAYMENT, label: '待付款' },
  { value: ORDER_STATUS.MAKING, label: '制作中' },
  { value: ORDER_STATUS.COMPLETED, label: '已完成' }
];

/** 订单类型 */
const ORDER_TYPE = {
  STANDARD: 'standard', // 标准品
  CUSTOM: 'custom' // 定制品
};

/** 订单类型中文名 */
const ORDER_TYPE_TEXT = {
  standard: '标准品',
  custom: '定制需求'
};

/** 允许客户自助取消的订单状态（REQ-037） */
const CANCELLABLE_STATUS = [ORDER_STATUS.PENDING_PAYMENT, ORDER_STATUS.PENDING_QUOTE];

/** 作品分类（与 content/works.json 的 categories 一致） */
const WORK_CATEGORIES = [
  { id: '', name: '全部' },
  { id: '3d', name: '3D设计' },
  { id: 'zhantai', name: '展台美陈' },
  { id: 'biaoshi', name: '户外标识' },
  { id: 'faguangzi', name: '发光字' },
  { id: 'shichuang', name: '实拍案例' }
];

/** 物料百科类型（design §2.3.4 materials.type） */
const MATERIAL_TYPES = {
  ILLUMINATED: 'illuminated', // 发光字
  LIGHTBOX: 'lightbox', // 灯箱标识字
  INKJET: 'inkjet', // 喷绘
  PRINT: 'print' // 印刷
};

/** 物料类型中文名 */
const MATERIAL_TYPE_TEXT = {
  illuminated: '发光字',
  lightbox: '灯箱/标识字',
  inkjet: '喷绘写真',
  print: '印刷品'
};

/**
 * 物料百科板块锚点映射（页面内定位 ?section=xxx）
 * 使用网站既有的拼音锚点，便于与存量内容语义对齐
 */
const MATERIAL_SECTIONS = [
  { key: 'fashezi', type: MATERIAL_TYPES.ILLUMINATED, title: '发光字' },
  { key: 'dengxiang', type: MATERIAL_TYPES.LIGHTBOX, title: '灯箱与标识字' },
  { key: 'penhui', type: MATERIAL_TYPES.INKJET, title: '喷绘写真' },
  { key: 'yinshua', type: MATERIAL_TYPES.PRINT, title: '印刷品' }
];

/** 定制需求物料类型选项（REQ-027 表单） */
const CUSTOM_MATERIAL_OPTIONS = ['发光字', '灯箱', '喷绘/写真', '印刷品', '户外标识', '其他'];

/** 图片上传约束（REQ-028） */
const UPLOAD_LIMITS = {
  MAX_COUNT: 6, // 参考图最多 6 张
  MAX_SIZE_MB: 5 // 单图不超过 5MB
};

/** 金额显示单位：云函数返回的金额单位为「元」 */
const AMOUNT_UNIT = 'yuan';

/**
 * 错误码 → 中文提示映射（design §2.2.2）
 * request.js 与页面统一引用，保证提示一致
 */
const ERROR_MESSAGES = {
  1001: '登录失败，请重试',
  2001: '手机号授权失败，请重试',
  2002: '手机号不可用，请手动填写',
  3001: '内容加载失败，请重试',
  4001: '商品不存在或已下架',
  5001: '商品已更新，请重新选择',
  5002: '收货信息不完整',
  5003: '下单失败，请重试',
  5004: '规格不可生产，请走定制',
  6001: '请填写必填项',
  6002: '提交失败，请重试',
  7001: '无权限',
  7002: '金额必须为正数',
  7003: '报价失败，请重试',
  8001: '无权操作该订单',
  8002: '已支付订单请联系商家',
  9001: '加载失败，请重试',
  9002: '无权查看该订单',
  A001: '订单状态已变更',
  A002: '报价已过期，请重新询价',
  A003: '支付发起失败，请重试',
  B001: '导入失败，请检查数据格式'
};

/** 网络异常统一文案（REQ-003 异常场景 1） */
const NETWORK_ERROR_MESSAGE = '网络异常，请检查网络后重试';

/** 请求默认超时（毫秒） */
const REQUEST_TIMEOUT = 10000;

module.exports = {
  ORDER_STATUS,
  ORDER_STATUS_TEXT,
  ORDER_STATUS_STYLE,
  ORDER_STATUS_FILTERS,
  ORDER_TYPE,
  ORDER_TYPE_TEXT,
  CANCELLABLE_STATUS,
  WORK_CATEGORIES,
  MATERIAL_TYPES,
  MATERIAL_TYPE_TEXT,
  MATERIAL_SECTIONS,
  CUSTOM_MATERIAL_OPTIONS,
  UPLOAD_LIMITS,
  AMOUNT_UNIT,
  ERROR_MESSAGES,
  NETWORK_ERROR_MESSAGE,
  REQUEST_TIMEOUT
};