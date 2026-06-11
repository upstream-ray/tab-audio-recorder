# ARCHITECTURE

## 技术栈

| 层面 | 选型 |
|---|---|
| 扩展规范 | Chrome Extension Manifest V3 |
| 语言 | 纯原生 JavaScript（无框架、无构建、无转译） |
| Web APIs | MediaRecorder, AudioContext, getUserMedia |
| Chrome APIs | tabCapture, offscreen, downloads, notifications |
| 最低版本 | Chrome / Chromium-Edge 116+（依赖 `chrome.offscreen` + `chrome.tabCapture`） |

## 代码组织

```
src/
├── background.js    # Service Worker — 唯一的状态协调者
├── offscreen.js     # Offscreen Document — 实际录音引擎
├── offscreen.html   # offscreen.js 的宿主页面
├── popup.js         # Popup UI — 纯展示层
├── popup.html       # popup 页面结构
└── popup.css        # popup 样式
```

## 三层架构

扩展由三个互相通信的 JS 上下文组成，全部走 `chrome.runtime.sendMessage` 并用 `target` 字段路由：

### background.js（Service Worker）

唯一的状态协调者。职责：
- 处理来自 popup 的所有用户指令
- 调用 `chrome.tabCapture.getMediaStreamId` 获取 streamId
- 按需创建 / 关闭 offscreen 文档
- 管理 `chrome.downloads` 下载和 `objectUrl` 生命周期
- 维护 `readyRecording`（待导出录音的内存引用）和 `pendingStopRequests`（带超时的 stop 请求 promise 映射）

### offscreen.js（Offscreen Document，仅在录音时存在）

Service Worker 不能使用 `MediaRecorder` 和 `AudioContext`，所以实际的 `getUserMedia` + `MediaRecorder` 都在这里。职责：
- 执行音频捕获和编码
- 通过 `AudioContext.destination` 回放捕获流，让用户录音时仍能听到声音
- 完成录音后用 `URL.createObjectURL` 暂存 blob，等 background 触发下载

### popup.js（Popup UI）

纯展示层。所有动作都委托给 background，并通过 `STATUS_CHANGED` 广播被动更新 UI。关闭 popup 不会中断录音。

## 状态机

录音状态由 `recorder.state` + `stoppingPromise` + `completedRecording` 三个变量推导：

```
idle → recording ⇄ paused → stopping → ready → exporting → idle
```

关键不变量：
- 同一时刻最多只有一段「待导出」录音（`completedRecording`）。开始新录音前必须先导出或丢弃。
- Background 的 `readyRecording` 是 offscreen 中 `completedRecording` 的镜像缓存。`GET_STATUS` 会从 offscreen 拉回真值并同步。
- `objectUrl` 只在 offscreen 文档里创建，通过 `REVOKE_OBJECT_URL` 消息显式释放。

## 停止录音的请求/响应模式

`STOP_RECORDING` 走 request-id 模式：background 生成 `requestId`，挂起一个带 30s 超时的 promise（`pendingStopRequests`），offscreen 在 `MediaRecorder` 真正触发 `stop` 事件并生成 blob 之后，发回 `OFFSCREEN_RECORDING_STOPPED` / `OFFSCREEN_RECORDING_FAILED` 消息来 resolve/reject。这是因为 `MediaRecorder.stop()` 是异步的，必须等最后一片 `dataavailable` 才能拼出完整 blob。

## 暂停时长计算

`recordedDurationMs` + `recordingRunStartedAt` 配对累计真实录制时长，跳过暂停段。不要用 `Date.now() - startedAt`。

## 关键设计约束

- **不要让标签页静音**：`keepCapturedAudioAudible` 把流接到 `AudioContext.destination`。删了这段用户就听不到声音了。
- **下载有兜底**：`chrome.downloads.download` 在某些 MV3 场景下会拒绝 `blob:` URL，所以有 offscreen 内 `<a download>` 的 fallback 路径（`DOWNLOAD_OBJECT_URL`）。两条路径都要保持可用。
- **录音全程驻留内存**：blob 不分段、不落盘。长时录音会吃内存。未来要做分段保存就在 offscreen 的 `dataavailable` 里改。
- **隐私边界**：不上传、不调外部 API、不录麦克风。任何引入网络请求或额外 host permission 的改动都要先和用户确认。
