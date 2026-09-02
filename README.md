# PixelProof Companion

PixelProof（设计还原度检查）的 Windows 本机伴侣。

它负责在本机浏览器中打开开发页面，并为 Figma 插件提供页面截图和还原度检查能力。无需安装，下载后解压即可运行。

## 下载与使用

1. 打开仓库右侧的 **Releases**。
2. 下载 `PixelProof-Companion-Windows-x64-v0.2.1.zip`。
3. 完整解压 ZIP，不能直接在压缩包内运行。
4. 双击 `PixelProof Companion.exe`。
5. 看到“本机伴侣运行中”后，回到 Figma 插件开始检查。
6. 不再使用时，在伴侣窗口中点击“关闭伴侣”。

关闭后不需要重新下载。下次使用 PixelProof 时，再次双击 `PixelProof Companion.exe` 即可。

## 系统要求

- Windows 10 / 11，64 位
- 已安装 Microsoft Edge
- 本机端口 `49321` 未被其他程序占用

## 首次运行提示

当前版本尚未购买代码签名证书。Windows 可能显示“Windows 已保护你的电脑”，请确认文件来自本仓库后，点击“更多信息”→“仍要运行”。你也可以使用 Release 中的 SHA-256 文件校验下载内容。

## 隐私说明

伴侣仅在用户电脑本机运行，监听 `127.0.0.1:49321`。页面处理结果不会上传到本仓库或第三方服务器。

## 当前版本

`v0.2.1`
