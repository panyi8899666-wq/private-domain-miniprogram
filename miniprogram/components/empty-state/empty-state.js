/**
 * 空状态占位组件（REQ-003、REQ-018、REQ-034 异常场景 1）
 * 支持自定义文案与可选操作按钮（如「去逛逛」）
 */
Component({
  options: {
    styleIsolation: 'apply-shared'
  },

  properties: {
    /** 主文案 */
    text: {
      type: String,
      value: '暂无数据'
    },
    /** 辅助说明 */
    subText: {
      type: String,
      value: ''
    },
    /** 图标符号（纯文本符号，避免引入图片资源） */
    iconText: {
      type: String,
      value: '∅'
    },
    /** 是否展示操作按钮 */
    showButton: {
      type: Boolean,
      value: false
    },
    /** 操作按钮文案 */
    buttonText: {
      type: String,
      value: '去逛逛'
    }
  },

  methods: {
    onAction() {
      this.triggerEvent('action');
    }
  }
});