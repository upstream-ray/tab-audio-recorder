# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Chrome / Edge Manifest V3 浏览器扩展，把当前标签页音频录制为本地 `.webm` (Opus) 文件。纯前端、零依赖、无构建步骤——所有文件直接由浏览器加载。

## 开发与调试

无 npm / 构建 / 测试脚本。修改代码后：

1. 打开 `chrome://extensions` 或 `edge://extensions`，开启开发者模式。
2. 首次：点击「加载已解压的扩展程序」，选择仓库根目录。
3. 改动后：在扩展卡片上点击「重新加载」（service worker 和 offscreen 文档都会重建）。
4. 调试入口：
   - `background.js`：扩展详情页的「Service Worker」链接。
   - `offscreen.js`：在 `chrome://extensions` 的「检查视图」里找 `offscreen.html`，只有录音进行时才存在。
   - `popup.js`：右键扩展图标 → 检查弹出内容。

要求 Chrome / Chromium-Edge 116+（依赖 `chrome.offscreen` + `chrome.tabCapture`）。

## 架构

扩展由三个互相通信的 JS 上下文组成，全部走 `chrome.runtime.sendMessage` 并用 `target` 字段路由：

- **`background.js`** (service worker)：唯一的状态协调者。处理来自 popup 的所有用户指令，调用 `chrome.tabCapture.getMediaStreamId` 拿到 streamId，按需创建/关闭 offscreen 文档，管理 `chrome.downloads` 下载和 `objectUrl` 生命周期。维护 `readyRecording`（待导出录音的内存引用）和 `pendingStopRequests`（带超时的 stop 请求 promise 映射）。
- **`offscreen.js`** (offscreen 文档，仅在录音时存在)：service worker 不能使用 `MediaRecorder` 和 `AudioContext`，所以实际的 `getUserMedia` + `MediaRecorder` 都在这里。同时把捕获到的流连回 `AudioContext.destination`，让用户在录音时还能正常听到声音（否则 tabCapture 会把标签页静音）。完成录音后用 `URL.createObjectURL` 暂存 blob，等 background 触发下载。
- **`popup.js`** (popup UI)：纯展示层。所有动作都委托给 background，并通过 `STATUS_CHANGED` 广播被动更新 UI。关闭 popup 不会中断录音（状态都在 background + offscreen 里）。

### 状态机

录音状态在 `getStatus()` 中由 `recorder.state` + `stoppingPromise` + `completedRecording` 三个变量推导：
`idle → recording ⇄ paused → stopping → ready → exporting → idle`

关键不变量：
- 同一时刻最多只有一段「待导出」录音（`completedRecording`）。开始新录音前必须先导出或丢弃，逻辑同时存在于 background 和 offscreen 两侧防御。
- Background 的 `readyRecording` 是 offscreen 中 `completedRecording` 的镜像缓存。`GET_STATUS` 会从 offscreen 拉回真值并同步。
- `objectUrl` 只在 offscreen 文档里创建（blob 也在那里），通过 `REVOKE_OBJECT_URL` 消息显式释放。下载完成或 10 分钟超时后 background 触发清理，然后在 idle 时关闭 offscreen 文档。

### 停止录音的请求/响应模式

`STOP_RECORDING` 走 request-id 模式而不是普通的 sendMessage 应答：background 生成 `requestId`，挂起一个带 30s 超时的 promise（`pendingStopRequests`），offscreen 在 `MediaRecorder` 真的触发 `stop` 事件并生成 blob 之后，发回 `OFFSCREEN_RECORDING_STOPPED` / `OFFSCREEN_RECORDING_FAILED` 消息来 resolve/reject。这是因为 `MediaRecorder.stop()` 是异步的，必须等最后一片 `dataavailable` 才能拼出完整 blob。

### 暂停时长计算

`recordedDurationMs` + `recordingRunStartedAt` 配对累计真实录制时长，跳过暂停段——不要用 `Date.now() - startedAt`。

## 重要约束

- **不要让标签页静音**：`keepCapturedAudioAudible` 把流接到 `AudioContext.destination`。删了这段用户就听不到声音了。
- **下载有兜底**：`chrome.downloads.download` 在某些 MV3 场景下会拒绝 `blob:` URL，所以有 offscreen 内 `<a download>` 的 fallback 路径（`DOWNLOAD_OBJECT_URL`）。两条路径都要保持可用。
- **录音全程驻留内存**：blob 不分段、不落盘。长时录音会吃内存——README 已注明，未来要做分段保存就在 offscreen 的 `dataavailable` 里改。
- **隐私边界**：不上传、不调外部 API、不录麦克风。任何引入网络请求或额外 host permission 的改动都要先和用户确认。
