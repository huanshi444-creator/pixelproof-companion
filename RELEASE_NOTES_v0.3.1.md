# PixelProof Companion v0.3.1

Windows x64 与 macOS 通用免安装包（Apple Silicon / Intel）。

## 修复

- 支持按检查任务编号取消抓取并关闭对应浏览器。插件断开请求后也会释放任务，不再一直占用伴侣。
- Token 检查对主页面每次跳转校验 CDT 允许域名，包含 HTTP、脚本及响应式视口跳转。越界时停止检查，不生成该页面的合规结果。
- 允许正常 CDN 资源加载；返回最终实际检查地址供新版插件展示。
- 同步本地已验证的 CSS 生效声明与继承来源证据，支持新版插件的重复问题归因。

## 老用户更新方法

1. 关闭正在运行的旧伴侣。
2. 下载对应系统的 ZIP，完整解压到新文件夹（不要直接在压缩包内运行）。
3. Windows 双击 `PixelProof Companion.exe`；macOS 按系统提示打开 `PixelProof Companion.command`。
4. 回到 Figma 重新检测连接。新版 Figma 插件由作者另行发布；取消按钮和更新提示需配合新版插件。

旧伴侣不会自动升级，也不会因为 GitHub 发布而主动弹窗。本次没有修改既有访问令牌发放机制。

下载文件名保持不变。版本包和稳定下载包均附 SHA-256 校验文件。
发布流程会在 Windows/macOS 运行服务回归，并对 ZIP 解压后的自带 Node 运行时执行抓取、取消和跳转测试。macOS 两种架构均随包提供；CI 运行宿主架构，不代表 Intel 与 Apple Silicon 用户桌面及 Gatekeeper 流程均已实机验收。程序尚未新增系统签名或公证。
