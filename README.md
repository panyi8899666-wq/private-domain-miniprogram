# 潘工 · 广告物料制作 微信小程序

个人私域小程序：品牌展示 + 广告物料材质百科 + 配置式下单 + 作品集 + 标准品商城 + 订单管理。

## 技术栈

- **微信原生小程序**（WXML / WXSS / JS）
- **微信云开发 CloudBase**（云数据库 + 云函数，免服务器）
- **微信支付**（企业商户号，官方支付）

## 目录结构

```
├── miniprogram/          小程序前端
│   ├── pages/            12 个页面
│   │   ├── index/        首页
│   │   ├── material/     材质百科（5 大类 110 材质浏览）
│   │   ├── works/        作品集
│   │   ├── shop/         标准品商城
│   │   ├── product-detail/ 商品详情
│   │   ├── custom/       配置式下单（选材质→规格→工艺→数量）
│   │   ├── orders/       我的订单
│   │   ├── order-detail/ 订单详情
│   │   ├── mine/         个人中心
│   │   ├── profile/      客户注册资料（第一批注册入口）
│   │   ├── addresses/    收货地址管理（第一批注册入口）
│   │   └── designer/     对接设计师窗口（Muse）
│   ├── components/       9 个公共组件
│   ├── images/           图标 + 材质图（110 张）
│   └── utils/            工具函数（request/constants/format/auth/profile）
├── cloudfunctions/       18 个云函数（后端，含对接桥 3 个、注册入口 2 个）
│   ├── login/ getPhoneNumber/           登录、手机号
│   ├── saveProfile/ saveAddresses/      客户资料、地址管理（第一批注册入口）
│   ├── getContent/ getProducts/         内容、商品查询
│   ├── createOrder/ createCustomOrder/  下单
│   ├── submitQuote/                     商家报价
│   ├── createPayment/ payCallback/      微信支付
│   ├── getOrders/ getOrderDetail/ cancelOrder/  订单管理
│   └── initData/                        数据初始化（含材质库）
└── project.config.json   微信开发者工具项目配置
```

## 对接设计师

- 对接设计师：Muse，负责需求整理、报价对接与进度跟进；最终方案与交付由工作室确认。
- 对接窗口：`miniprogram/pages/designer/`（我的 → 对接设计师进入；订单详情页亦显示负责人）。
- 对接为异步订单留言，不是实时聊天：客户在订单详情“对接留言”区留言，
  对接设计师按订单回复；需求与报价仍走既有订单流程。

## 对接直连桥（省掉手动转发）

- 全流程见 `muse-bridge/README.md`（pan 2026-10-29 定稿，18 步）：
  客户发 → Muse（收到即报 pan）→ 整理 → 反馈客户（人话确认）→ 反馈 pan →
  pan 确认 → Muse 设计 → 稿件发 pan → pan 确认 → 给客户 → 客户确认 →
  确认信息发 pan → 确认下单 → 客户付款 → 最终下单 → 下单信息提交 pan →
  pan 经 QQ / 微信向供应商下单 → 反馈客户已下单。轮询每 5 分钟经微信云开发
  HTTP API 走 `musePoll` / `museReply`；客户留言经 `addOrderMessage` 进入订单。
- 安全：access_token + 云函数环境变量 `MUSE_BRIDGE_SECRET` 两道校验；
  `musePoll` 不回传 openid 与客户手机号；密钥绝不进仓库、绝不发聊天。
- 存档：百度网盘 `正鑫越订单存档/<订单号>_<客户名称>-<下单日期>-<设计名称>/`
  下只存设计文件与源文件（最终确认版），另附一份备注（首行即客户名称-下单日期-设计名称），
  工具与规则见 `muse-bridge/archive.py` 与桥文档存档一节；
  需百度开放平台 API 时再找 pan 要，现在不问。
- 云函数现为 18 个：原有 13 个 + `musePoll`、`museReply`、`addOrderMessage`（对接桥 3 个）+ `saveProfile`、`saveAddresses`（第一批注册入口 2 个）。
  上线前须完成正式 AppID、云环境、环境变量与 AppSecret 安全存储等一次性步骤，
  详见 `muse-bridge/README.md`“上线前 pan 只需做一次”一节。

## 快速开始

1. **下载微信开发者工具**：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html
2. **导入项目**：工具里选择「导入项目」→ 目录选本仓库根目录 → 填入你的小程序 **AppID**
3. **替换占位配置**（2 处）：
   - `project.config.json` 里的 `appid`（当前为占位 `touristappid`）
   - `miniprogram/app.js` 里的 `CLOUD_ENV_ID`（当前为占位，改为你的云开发环境 ID）
4. **开通云开发**：微信开发者工具 → 云开发 → 新建环境，复制环境 ID 填入上一步
5. **部署云函数**：右键 `cloudfunctions/` 下每个云函数 → 「上传并部署（云端安装依赖）」
6. **初始化数据**：在云开发控制台手动调用一次 `initData` 云函数（`dataset: 'all'`），导入材质库/商品/作品等数据
7. **预览**：点「预览」用手机微信扫码

> 详细注册与开通步骤见配套文档《小程序注册与开通指引》。

## 配置说明

| 占位项 | 位置 | 说明 |
|--------|------|------|
| AppID | `project.config.json` | 替换为你的小程序 AppID |
| 云环境 ID | `miniprogram/app.js` 的 `CLOUD_ENV_ID` | 替换为你的云开发环境 ID |
| 微信支付商户号 | `cloudfunctions/createPayment` 的 `SUB_MCH_ID` / `ENV_ID` 环境变量 | 云函数环境变量中配置 |

## 合规说明

- 小程序内**不展示**个人收款码 / 加好友二维码（微信平台规则）
- 支付仅走**官方微信支付**（`wx.requestPayment`）
- 数据初始化带违规关键词校验

## 材质库

覆盖 5 大类共 **110 种材质**：喷绘写真(26) / 印刷(36) / 亚克力(16) / PVC(17) / 发光字(15)。
每种含材质名、适用机型、户内外、厚度、尺寸、工艺、参考价、材质图。