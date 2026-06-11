# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**完整项目上下文请先读 [`AGENTS.md`](AGENTS.md)**——包含文档索引、阅读顺序和开发规则。

## 开发与调试

无 npm / 构建 / 测试脚本。修改代码后：

1. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
2. 首次：点击「加载已解压的扩展程序」，选择仓库根目录。
3. 改动后：在扩展卡片上点击「重新加载」（service worker 和 offscreen 文档都会重建）。
4. 调试入口：
   - `src/background.js`：扩展详情页的「Service Worker」链接。
   - `src/offscreen.js`：在 `chrome://extensions` 的「检查视图」里找 `offscreen.html`，只有录音进行时才存在。
   - `src/popup.js`：右键扩展图标 → 检查弹出内容。

要求 Chrome / Chromium-Edge 116+（依赖 `chrome.offscreen` + `chrome.tabCapture`）。

## 重要约束（速查）

- **不要让标签页静音**：`keepCapturedAudioAudible` 把流接到 `AudioContext.destination`。删了这段用户就听不到声音了。
- **下载有兜底**：`chrome.downloads.download` 主路径 + offscreen 内 `<a download>` fallback 路径。两条都要保持可用。
- **录音全程驻留内存**：blob 不分段、不落盘。长时录音会吃内存。
- **隐私边界**：不上传、不调外部 API、不录麦克风。任何引入网络请求或额外 host permission 的改动都要先和用户确认。

详细架构说明见 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
