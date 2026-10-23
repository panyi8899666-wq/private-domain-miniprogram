/**
 * 加载态组件（REQ-003 验收标准 1）
 * 支持两种形态：
 * - spinner：环形加载指示 + 文案
 * - skeleton：骨架屏，用于首屏与列表占位，避免长时间白屏
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 形态：spinner | skeleton */
    type: {
      type: String,
      value: 'spinner'
    },
    /** 文案 */
    text: {
      type: String,
      value: '加载中'
    },
    /** 骨架条数 */
    rows: {
      type: Number,
      value: 3
    }
  },

  data: {
    /** 骨架索引数组，供 wx:for 渲染 */
    skeletonRows: [0, 1, 2]
  },

  observers: {
    rows(val) {
      const count = Math.max(1, Math.min(10, Number(val) || 3));
      const list = [];
      for (let i = 0; i < count; i++) list.push(i);
      this.setData({ skeletonRows: list });
    }
  }
});