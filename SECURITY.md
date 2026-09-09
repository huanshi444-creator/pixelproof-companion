# PixelProof 安全说明

- 本机伴侣只绑定 `localhost`，不监听局域网或公网地址。
- CORS 仅允许 Figma 来源和本地文件演示；抓取请求必须带有当次启动随机令牌。
- URL 仅支持 HTTP/HTTPS；Token 严格检查额外校验 CDT 域名。
- 浏览器使用临时上下文，默认不共享用户的 Chrome/Edge Profile、Cookie 或密码。
- 源码扫描跳过符号链接、依赖目录、版本库、构建产物与非前端扩展名，并设置数量和字节上限。
- Windows 启动器仅管理自己创建的 Node 子进程；macOS 停止脚本在结束 PID 前校验命令行是否为 PixelProof Companion。
- 面向公开分发时，Windows 建议使用 Authenticode 签名，macOS 建议使用 Developer ID 签名与 notarization。

如发现安全问题，请在公开发布前通过仓库的私有渠道报告，并附上复现步骤、版本和平台信息。
