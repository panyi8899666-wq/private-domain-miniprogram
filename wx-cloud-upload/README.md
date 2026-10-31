# wx-cloud-upload（微信云开发文件上传路线）

以后小程序图片、文件类接口操作不再经聊天传密钥，全部走这条线。

## 一次性设置（只需做一次）

仓库 Settings → Secrets and variables → Actions → New repository secret：

- Name：`WX_APPSECRET`
- Secret：小程序 AppSecret（公众平台生成的那串，生成后平台不保存，只显示一次）

AppID 是公开标识，已写进脚本，不用存。

## 日常使用

- 传新图：把 JPG 放进 `wx-cloud-upload/images/` 推上来，push 到 master 即自动跑上传并验下载链接。
- 只验不传：仓库 Actions → wx-cloud-upload → Run workflow → mode 选 verify。
- 看结果：仓库根目录 `wx-cloud-upload-report.md`，每次跑完自动更新（上传成功数、下载链接数、库里长 ID 数）。

## 安全

- 密钥只活在 GitHub Secrets；脚本不打印密钥与 token；报告里只有文件名与状态。
- 全部弄完后可在公众平台重置 AppSecret，重置后记得同步更新仓库这个 Secret。
