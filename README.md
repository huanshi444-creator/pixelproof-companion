# PixelProof Companion

PixelProof（设计还原度检查）的本机浏览器伴侣，支持 Windows 与 macOS。它在本机 Edge/Chrome 中打开开发页面，为 Figma 插件提供截图、DOM/CSS 和 Token 检查证据。

## 下载

请从 [最新 Release](https://github.com/huanshi444-creator/pixelproof-companion/releases/latest) 下载与系统匹配的稳定文件：

- Windows 10/11 x64：`PixelProof-Companion-Windows-x64.zip`
- macOS 12+：`PixelProof-Companion-macOS.zip`，同时支持 Apple Silicon（M 系列）与 Intel

ZIP 必须完整解压，不能直接在压缩包内运行。

## Windows 使用方法

1. 双击 `PixelProof Companion.exe`。
2. 看到“本机伴侣运行中”后回到 Figma。
3. 使用结束后，在状态窗口中点击“关闭伴侣”。

未签名版本首次运行可能显示 Windows 安全提醒，请确认文件来自本仓库后点击“更多信息”→“仍要运行”。

## macOS 使用方法

1. 首次启动时，右键 `PixelProof Companion.command`，选择“打开”。
2. 在系统确认框中再次点击“打开”。
3. 回到 Figma 插件，点击“我已启动，重新检测”。
4. 使用结束后，双击 `Stop PixelProof Companion.command`。

未签名版本可能被 Gatekeeper 拦截，因此首次启动必须使用右键“打开”，不要直接双击。

## 系统要求与隐私

- 已安装 Microsoft Edge 或 Google Chrome。
- 本机端口 `49321` 未被其他程序占用。
- 伴侣只监听 `127.0.0.1:49321`，页面截图、DOM/CSS 和源码扫描不会上传到本仓库或第三方服务。

## 自动发布

推送 `v*` 标签或手动运行 `Release PixelProof Companion` 工作流，会自动构建 Windows 包和包含两种芯片 runtime 的 macOS 通用包，并将固定文件名上传到 GitHub Release。
