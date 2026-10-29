# 正鑫越文化工作室 微信小程序（前端）

微信**原生小程序**（WXML + WXSS + JS）+ 微信云开发。本目录为小程序前端源码，与仓库根目录的 `cloudfunctions/` 云函数目录平级。

## 一、目录结构

```
miniprogram/
├── app.js              # 启动：云开发初始化、登录态、隐私同意检查
├── app.json            # 页面路由 + TabBar + 窗口深色配置
├── app.wxss            # 全局设计令牌 + 发光公共 class
├── sitemap.json        # 搜索索引配置
├── README.md           # 本文件
├── images/
│   ├── tabbar/         # TabBar 图标（普通/选中各 5 张，81×81 PNG）
│   └── placeholder/    # 占位图
├── utils/
│   ├── request.js      # 云函数统一调用 + 加载态/异常/重试/防重锁
│   ├── auth.js         # 登录、手机号授权、登录态缓存
│   ├── format.js       # 金额/时间/脱敏格式化
│   └── constants.js    # 订单状态枚举、分类、物料类型、错误码映射
├── components/         # 9 个公共组件
│   ├── empty-state/  loading/  glow-button/  order-status-tag/
│   ├── work-card/    product-card/  spec-picker/
│   └── address-picker/  uploader/
└── pages/              # 10 个页面
    ├── index/            # 首页（TabBar）
    ├── material/         # 物料百科（TabBar）
    ├── works/            # 作品集（TabBar）
    ├── shop/             # 商城列表（TabBar）
    ├── product-detail/   # 商品详情
    ├── custom/           # 定制需求
    ├── orders/           # 我的订单
    ├── order-detail/     # 订单详情
    ├── mine/             # 个人中心（TabBar）
    └── designer/         # 对接设计师窗口（Muse）
```

## 二、部署前必须替换的占位配置

| 占位项 | 位置 | 说明 |
|-------|------|------|
| **云开发环境 ID** | `miniprogram/app.js` 顶部 `CLOUD_ENV_ID = 'YOUR_ENV_ID'` | 替换为真实环境 ID（云开发控制台可查），否则云函数调用会失败 |
| **小程序 AppID** | 根目录 `project.config.json` 的 `"appid": "touristappid"` | 替换为企业主体小程序 AppID；`touristappid` 仅用于游客模式预览 |
| **TabBar 图标** | `miniprogram/images/tabbar/*.png` | 当前为脚本生成的纯几何占位图标，可替换为正式设计图标（81×81px @3x） |
| **占位图** | `miniprogram/images/placeholder.png` | 图片加载失败/无数据时展示，可替换为品牌化占位图 |

## 三、打开与运行

1. 用**微信开发者工具**「导入项目」，选择仓库根目录（含 `project.config.json`）。
2. 工具会读取 `miniprogramRoot=miniprogram/` 与 `cloudfunctionRoot=cloudfunctions/`。
3. 若未配置 AppID，可用「游客模式 / 测试号」预览静态页面；云函数能力需真实环境 ID 与已部署的 `cloudfunctions/`。

## 四、接口约定（design §2.2）

所有云函数调用统一经 `utils/request.js` 的 `callFunction()` 封装：

```js
// 请求信封
{ action?: string, payload: { ...业务参数 } }

// 响应信封
{ code: 0, data: {...}, message: 'ok' }        // 成功
{ code: <非0>, data: null, message: '中文提示' } // 失败
```

对接的云函数：`login`、`getPhoneNumber`、`getContent`、`getProducts`、`createOrder`、`createCustomOrder`、`submitQuote`、`createPayment`、`getOrders`、`getOrderDetail`、`cancelOrder`。

## 五、合规红线（REQ-048 ~ REQ-052）

- 小程序内**不展示**任何个人收款码、个人微信/QQ 加好友二维码，也无「加微信转账」引导。
- 所有支付仅走官方 `wx.requestPayment`（`pages/order-detail` 调起），前端零支付密钥。
- 手机号仅在用户主动点击授权按钮后经 `getPhoneNumber` 云函数获取，展示一律脱敏（`173****3179`）。
- 隐私同意状态记录于本地缓存与 `users.privacyAgreedAt`。

## 六、图标资源生成（可复现）

TabBar 占位图标由脚本生成（纯几何形状、无第三方依赖）：

```bash
node scripts/gen-miniapp-icons.mjs
```

正式上线前建议用设计稿替换 `images/tabbar/` 与 `images/placeholder.png` 下的文件，保持文件名与尺寸不变即可，无需改动 `app.json`。