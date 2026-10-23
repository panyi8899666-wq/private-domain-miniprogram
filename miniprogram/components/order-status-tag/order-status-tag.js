/**
 * 订单状态标签（REQ-034 订单列表、REQ-038 订单详情）
 * 根据 status 从 constants 取中文文案与配色，渲染彩色标签；
 * 若 constants 中无对应状态，回退到组件内置映射（待报价/待付款/制作中/已完成/已取消）。
 */
const { ORDER_STATUS_TEXT, ORDER_STATUS_STYLE } = require('../../utils/constants');

// 内置兜底映射（constants 缺失时的安全兜底，与 design §2.1.5 状态机一致）
const FALLBACK_TEXT = {
  pending_quote: '待报价',
  pending_payment: '待付款',
  making: '制作中',
  completed: '已完成',
  cancelled: '已取消'
};

const FALLBACK_STYLE = {
  pending_quote: { color: '#ffc24b', bg: 'rgba(255,194,75,0.12)', border: 'rgba(255,194,75,0.45)' },
  pending_payment: { color: '#ffc24b', bg: 'rgba(255,194,75,0.12)', border: 'rgba(255,194,75,0.45)' },
  making: { color: '#3ec6ff', bg: 'rgba(62,198,255,0.12)', border: 'rgba(62,198,255,0.5)' },
  completed: { color: '#3ddc97', bg: 'rgba(61,220,151,0.12)', border: 'rgba(61,220,151,0.45)' },
  cancelled: { color: '#5c6b7e', bg: 'rgba(92,107,126,0.12)', border: 'rgba(92,107,126,0.4)' }
};

// 状态未知时的默认灰色样式
const DEFAULT_STYLE = { color: '#9dabc0', bg: 'rgba(157,171,192,0.12)', border: 'rgba(157,171,192,0.4)' };

Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 订单状态（英文枚举，如 pending_quote / making） */
    status: {
      type: String,
      value: ''
    },
    /** 可选：自定义文案，不传则按状态取中文 */
    text: {
      type: String,
      value: ''
    }
  },

  data: {
    /** 最终展示文案 */
    displayText: '',
    /** 内联配色样式 */
    tagStyle: ''
  },

  observers: {
    'status, text': function (status, text) {
      const style = ORDER_STATUS_STYLE[status] || FALLBACK_STYLE[status] || DEFAULT_STYLE;
      const stateText = ORDER_STATUS_TEXT[status] || FALLBACK_TEXT[status];

      this.setData({
        displayText: text || stateText || status || '未知',
        tagStyle: `color:${style.color};background-color:${style.bg};border-color:${style.border};`
      });
    }
  }
});