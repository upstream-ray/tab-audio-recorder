# ARCHITECTURE

## 技术栈

| 层面 | 选型 |
|---|---|
| 扩展规范 | Chrome Extension Manifest V3 |
| 语言 | 纯原生 JavaScript（无框架、无构建、无转译） |
| Web APIs | MediaRecorder, AudioContext, AudioWorklet, IndexedDB, getUserMedia |
| Chrome APIs | tabCapture, offscreen, downloads, notifications, storage |
| 第三方 | lamejs（MP3 编码，LGPL-3.0，随包分发于 `src/vendor/`） |
| 最低版本 | Chrome / Chromium-Edge 116+（依赖 `chrome.offscreen` + `chrome.tabCapture`） |

## 代码组织

```
src/
├── background.js    # Service Worker — 唯一的状态协调者
├── store.js         # IndexedDB 持久化层（三个上下文共用）
├── offscreen.js     # Offscreen Document — 实际录音引擎
├── offscreen.html   # offscreen.js 的宿主页面
├── pcm-tap.js       # AudioWorklet — 实时 MP3 旁路的 PCM 取样器
├── popup.js         # Popup UI — 纯展示层
├── popup.html       # popup 页面结构
├── popup.css        # popup 样式
├── i18n.js          # 运行时多语言加载器（document 上下文用）
└── vendor/          # lamejs
```

## 三层架构

扩展由三个互相通信的 JS 上下文组成，全部走 `chrome.runtime.sendMessage` 并用 `target` 字段路由：

### background.js（Service Worker）

唯一的状态协调者。职责：
- 处理来自 popup 的所有用户指令
- 调用 `chrome.tabCapture.getMediaStreamId` 获取 streamId
- 新建 / 取出会话记录，按需创建、关闭 offscreen 文档
- 管理 `chrome.downloads` 下载和 `objectUrl` 生命周期
- Service Worker 每次起来先跑一次崩溃恢复（`ensureRecovery`）
- 给 popup 汇总快照：当前状态 + 会话列表 + 本地占用（`withSessions`）

### offscreen.js（Offscreen Document，仅在录音 / 导出时存在）

Service Worker 不能使用 `MediaRecorder` 和 `AudioContext`，所以实际的捕获和编码都在这里。职责：
- 执行音频捕获，把每片 WebM 实时写进 IndexedDB
- 通过 `AudioContext.destination` 回放捕获流，让用户录音时仍能听到声音
- 旁挂 `pcm-tap` AudioWorklet 取 PCM，用 lamejs 实时编码 MP3 并落盘
- 导出时把已落盘的分片拼成 Blob，交给 background 下载

### popup.js（Popup UI）

纯展示层。所有动作都委托给 background，并通过 `STATUS_CHANGED` 广播被动更新 UI。关闭 popup 不会中断录音。

## 持久化模型

IndexedDB `tab-audio-recorder`，三个 object store（见 [`src/store.js`](src/store.js)）：

```
sessions   keyPath: id                  一次逻辑录音（可跨天、跨多段）
chunks     keyPath: [sessionId, seq]    WebM 分片，1 秒 1 片
mp3        keyPath: [sessionId, seq]    实时编码的 MP3 帧块，约 5 秒 1 块
```

**段（segment）** = 一次连续的 MediaRecorder 运行。暂停 / 恢复走 `MediaRecorder.pause()`，仍属同一段；浏览器重启后点「继续录制」会新开一段，追加进同一个 session。

崩溃恢复靠 `state` 字段：正常停止会把 session 置为 `stopped`，所以启动时还停在 `recording` 的一定是上次没善终的，`recoverInterrupted()` 把它们收拢成 `paused` + `interrupted`。

seq 计数器只活在内存里，崩溃后靠 `nextSeq()` 用游标倒查盘上最大的 seq 续上，不会覆盖既有分片。

## 双写：WebM + 实时 MP3

录音时同一条捕获流上挂两路消费者：

```
tabCapture stream
  ├─ MediaRecorder ──────────────► chunks（WebM/Opus，无损）
  ├─ AudioWorklet(pcm-tap) → lamejs ─► mp3（128kbps 单声道）
  └─ AudioContext.destination（回放，用户听得到）
```

为什么要实时编 MP3：两次 MediaRecorder 产生的 WebM 各带独立文件头，字节拼接后播放器只认第一段，所以跨次续录必须重编码才能得到单文件。如果留到导出时再转码，3 小时录音要现场磨 8-10 分钟，而且解码 API 必须整段读进内存、为限制内存又得强制切段。改成录制时顺手编，导出就只是把帧拼起来，秒出，也不必切段。

MP3 帧首尾相接即为合法 MP3，所以跨天、跨段、跨浏览器重启都能直接拼成一个文件——前提是采样率一致，因此会话创建时把 `sampleRate` 钉死（默认 48000），AudioContext 拿不到该采样率时在 `resampleToSessionRate()` 里线性重采样兜住。

设置里可以关掉「保留无损 WebM 原始数据」，此时只写 mp3 store，磁盘占用减半。

## 状态机

运行时状态由 offscreen 的 `recorder.state` + `stoppingPromise` 推导：

```
idle → recording ⇄ paused → stopping → idle
```

会话状态（持久化在 IndexedDB 里）另有一套，二者正交：

```
recording → paused（暂停 / 被中断）→ stopped
                ↑                        │
                └──── 继续录制（新开一段）←┘
```

关键不变量：
- 运行时同一时刻最多只有一个会话在录；但盘上可以同时存在多个未导出的会话。
- 导出不销毁数据。会话只在用户明确删除时才消失。
- `objectUrl` 只在 offscreen 文档里创建，通过 `REVOKE_OBJECT_URL` 消息显式释放。

## 停止录音的请求/响应模式

`STOP_RECORDING` 走 request-id 模式：background 生成 `requestId`，挂起一个带 30s 超时的 promise（`pendingStopRequests`），offscreen 在 `MediaRecorder` 真正触发 `stop` 事件、最后一片落盘、MP3 编码器 flush 完之后，发回 `OFFSCREEN_RECORDING_STOPPED` / `OFFSCREEN_RECORDING_FAILED` 消息来 resolve/reject。这是因为 `MediaRecorder.stop()` 是异步的，必须等最后一片 `dataavailable`。

## 暂停时长计算

`recordedDurationMs` + `recordingRunStartedAt` 配对累计真实录制时长，跳过暂停段。续录时以会话已有的 `durationMs` 为基数（`initDurationState`），所以跨天累加也是对的。不要用 `Date.now() - startedAt`。

## 导出

- **MP3**：读 mp3 store 全部分片，按序拼成一个 Blob。任何会话都可导，秒出。
- **WebM**：读 chunks store，按 segment 分组。单段会话导出一个无损原始文件；多段会话按段导出 `xxx_01.webm` / `xxx_02.webm`（想要单文件请用 MP3）。

拼接用 `new Blob([...blobs])`——IndexedDB 取回的 Blob 是磁盘引用，拼接不会把内容读进内存。

## 关键设计约束

- **不要让标签页静音**：`keepCapturedAudioAudible` 把流接到 `AudioContext.destination`。删了这段用户就听不到声音了。`pcm-tap` 是纯旁路，接在 0 增益汇点上，不影响这条链路。
- **下载有兜底**：`chrome.downloads.download` 在某些 MV3 场景下会拒绝 `blob:` URL，所以有 offscreen 内 `<a download>` 的 fallback 路径（`DOWNLOAD_OBJECT_URL`）。两条路径都要保持可用。
- **落地即写**：`dataavailable` 和 MP3 flush 都必须直接进 IndexedDB，不要为了「优化」在内存里攒。崩溃时丢多少，取决于最后一次落盘距今多久。
- **写入串成一条链**：`enqueueWrite` 保证落盘顺序与产生顺序一致；配额或磁盘错误只上报一次，并把录音暂停下来。
- **service worker 里的 importScripts 用绝对 URL**：相对路径以脚本自身位置为基准，`'src/store.js'` 会解析成 `src/src/store.js` 且静默失败（i18n 当年就踩过这个坑，所以它至今是内联的）。
- **隐私边界**：不上传、不调外部 API、不录麦克风。录音数据只落在本机 IndexedDB。任何引入网络请求或额外 host permission 的改动都要先和用户确认。
