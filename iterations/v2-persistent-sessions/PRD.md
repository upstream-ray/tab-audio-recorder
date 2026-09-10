# PRD — v2-persistent-sessions

## 概述

把录音从「内存里的一段临时 blob」升级为「磁盘上的持久会话」。解决两个用户痛点：

1. **异常退出丢录音**——浏览器崩溃 / 被关掉，已录内容全部消失。
2. **无法跨次续录**——今天录 1 小时，明天想接着录，只能另起一个文件，一段完整音频被硬拆成两段。

目标效果：录音实时写入本地存储，浏览器关了也在；暂停后隔天重开浏览器，能在原会话上接着往下录，最终导出**一个**完整文件。

## 背景：为什么现在会丢

现在的录音数据链路是 `MediaRecorder → dataavailable → chunks[]（offscreen 文档内存）→ 停止时拼成 Blob`。offscreen 文档随浏览器进程销毁，内存数组随之蒸发；`completedRecording` 同一时刻只能有一段，模型上就没有「续录」的位置。

## 设计决策

| 决策 | 选择 | 理由 |
|---|---|---|
| 持久化介质 | IndexedDB（Blob 直存，落磁盘） | 扩展内可用、不联网、不占 JS 堆；`chrome.storage` 有配额且不适合大二进制 |
| 跨次续录如何合成单文件 | 多段会话导出为**单个 MP3** | 两次 MediaRecorder 产生的 WebM 各带独立文件头，字节拼接后播放器只认第一段 |
| MP3 何时编码 | **录制时实时编码**（旁路音频节点） | 导出秒出（否则 3 小时录音要现场转码 8-10 分钟）；跨段天然无缝；不必为限制解码内存而强制切段，无损 WebM 链路得以完整保留 |
| 并发会话数 | 允许多个 | 数据既然已持久化，限制成一个反而碍事（例如同时在追两门课） |
| 导出后原始数据 | 保留，手动删除 | 下载被打断 / 文件误删还有救 |

## 数据模型

IndexedDB `tab-audio-recorder`，三个 object store：

```
sessions   keyPath: id            一次逻辑录音（可跨天、跨多段）
chunks     keyPath: [sessionId, seq]   WebM 分片（1 秒 1 片）
mp3        keyPath: [sessionId, seq]   实时编码的 MP3 帧块（约 5 秒 1 块）
```

session 记录：

```js
{
  id, title, pageUrl,
  mimeType,            // 'audio/webm;codecs=opus'
  sampleRate: 48000,   // 会话创建时钉死，保证跨段 MP3 帧采样率一致
  state,               // 'recording' | 'paused' | 'stopped'
  durationMs,          // 累计真实录制时长（跳过暂停段）
  segmentCount,        // 段数：一次连续的 MediaRecorder 运行 = 一段
  webmBytes, mp3Bytes,
  keepWebm,            // 是否保留无损 WebM 原始数据
  createdAt, updatedAt, lastExportAt, lastExportName
}
```

**段（segment）** = 一次连续的 MediaRecorder 运行。暂停/恢复走 `MediaRecorder.pause()`，仍属同一段；浏览器重启后「继续录制」= 新开一段，追加进同一个 session。

## 功能清单

### F1 — 实时落盘

- `dataavailable`（每秒一次）直接写入 `chunks` store，内存不再堆 `chunks[]`
- 实时 MP3 编码结果每约 5 秒写入 `mp3` store
- 每次落盘同时更新 session 的 `durationMs` / 字节数，保证崩溃后时长不丢
- 浏览器异常退出最多丢失最后约 1 秒

### F2 — 崩溃恢复

- Service Worker 启动时扫描 `state === 'recording'` 的会话（说明上次没走正常停止流程），标记为 `paused`
- popup 打开时在录音记录里正常列出，可继续录制 / 导出 / 删除

### F3 — 跨次续录

- 录音记录里每条会话提供「继续录制」
- 继续录制 = 捕获**当前**标签页，新开一段追加进该会话，时长在原基础上继续累加
- 对 `paused`（暂停中/被中断）和 `stopped`（已停止）的会话都可用
- 允许续录时所在的标签页与首次不同（例如换了播放页面），会话标题沿用首次录制时的标题

### F4 — 实时 MP3 旁路

- `AudioWorklet` 从捕获流上取 PCM（不影响 `keepCapturedAudioAudible` 的回放链路），降混单声道后交给 lamejs 增量编码
- 暂停时闸门关闭，不写入编码数据
- 采样率取会话的 `sampleRate`（默认 48000），跨天跨段保持一致
- 编码在 offscreen 文档主线程进行，分块让出，不阻塞录音

### F5 — 导出

- **MP3**：任何会话都可导出，把已编码的帧按序拼成一个 Blob，秒出
- **WebM**：单段会话导出无损原始文件；多段会话导出为 `xxx_01.webm` / `xxx_02.webm` 等多个文件，并提示「跨次续录需要 MP3 才能合成单文件」
- 保留现有下载双通道：`chrome.downloads` 主路径 + offscreen `<a download>` 兜底
- 导出后数据保留，会话标记 `lastExportAt`

### F6 — 录音记录 UI

- popup 主视图下方新增录音记录列表：标题、时长、占用大小、状态、是否已导出
- 每条支持：继续录制 / 导出 / 删除（删除需确认）
- 信息面板新增「本地占用」一行，显示所有会话合计大小

### F7 — 设置

- 新增「保留无损 WebM 原始数据」开关（默认开）。关掉后只存 MP3，磁盘占用减半

## 权限变更

新增 `unlimitedStorage`。不联网、不新增 host permission，隐私边界不变。需同步更新商店的权限说明。

## 限制与已知约束

- 浏览器异常退出会丢失最后约 1 秒（最后一个未落盘的分片）
- 双写时磁盘占用约为原来的 2 倍（3 小时约 350MB），可通过关闭「保留无损 WebM」减半
- 多段会话只能通过 MP3 合成单文件，MP3 为有损（128kbps 单声道）
- 续录的各段之间存在自然时间间隔（本来就不是连续录制），合成文件里表现为直接衔接，不插入静音
- 录音记录不做云同步，换电脑不迁移

## 验收标准

- [ ] 录音过程中直接杀掉浏览器进程，重开后录音记录里能看到该会话，导出的文件包含崩溃前的内容
- [ ] 录 1 分钟 → 暂停 → 关闭浏览器 → 重开 → 继续录制 1 分钟 → 停止 → 导出 MP3，得到一个约 2 分钟的连续文件
- [ ] 单段会话导出 WebM 与旧版本行为一致（无损、原始 Opus）
- [ ] 3 小时会话导出 MP3 在数秒内完成，不出现内存暴涨
- [ ] 录音期间标签页声音仍正常播放（`keepCapturedAudioAudible` 未被破坏）
- [ ] 删除会话后 IndexedDB 中该会话的所有分片被清除，占用数字同步下降
- [ ] 三语（en / zh_CN / zh_TW）文案完整，`python verify_i18n.py` 通过
