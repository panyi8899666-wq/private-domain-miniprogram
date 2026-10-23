/**
 * 发光按钮组件（REQ-002、REQ-003）
 * - type=primary：橙色发光主按钮（含流光扫过动画）
 * - type=secondary：电光蓝描边次按钮
 * - 支持 disabled 与 loading 态，加载中自动锁定，防重复点击
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 按钮文案 */
    text: {
      type: String,
      value: ''
    },
    /** 类型：primary | secondary */
    type: {
      type: String,
      value: 'primary'
    },
    /** 是否禁用 */
    disabled: {
      type: Boolean,
      value: false
    },
    /** 是否加载中（加载中同样锁定点击） */
    loading: {
      type: Boolean,
      value: false
    },
    /** 加载中文案 */
    loadingText: {
      type: String,
      value: '处理中'
    },
    /** 是否通栏 */
    block: {
      type: Boolean,
      value: false
    },
    /** 尺寸：normal | large */
    size: {
      type: String,
      value: 'normal'
    },
    /** 是否启用流光扫过动画（仅主按钮建议开启） */
    sweep: {
      type: Boolean,
      value: false
    }
  },

  methods: {
    onTap() {
      // disabled / loading 期间锁定，避免重复触发（REQ-003 异常场景 3）
      if (this.data.disabled || this.data.loading) return;
      this.triggerEvent('tap');
    }
  }
});