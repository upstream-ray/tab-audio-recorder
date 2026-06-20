# Chrome Web Store Listing

> Listing copy for version 0.2.0.

## Recommended Category

Productivity

## Language

The extension ships three locales — `_locales/en`, `_locales/zh_CN`, and
`_locales/zh_TW` — with `en` as the manifest `default_locale`. Chrome shows
Simplified Chinese to zh-CN users, Traditional Chinese to zh-TW/HK/MO users, and
English to everyone else (English is the fallback for unlisted locales). The
in-popup settings page also lets the user override the interface language
(English / 简体中文 / 繁體中文 / follow system) at any time.

In the Developer Dashboard, set the store listing's default language to
**English** (matching `default_locale`) and add **Chinese (Simplified)** and
**Chinese (Traditional)** as additional listing languages, pasting the matching
description below into each.

## Extension Name

Tab Audio Recorder

## Short Description

Record the current tab's audio locally as WebM/Opus or MP3. No uploads, no microphone, no tracking.

## One-Line Chinese Description (Simplified)

一键录制当前标签页音频，本地保存为 WebM/Opus 或 MP3，不上传、不录麦克风。

## One-Line Chinese Description (Traditional)

一鍵錄製目前分頁音訊，本機儲存為 WebM/Opus 或 MP3，不上傳、不錄麥克風。

## Detailed Description - English

Tab Audio Recorder records audio from the current browser tab and saves it
locally as a WebM/Opus file, or exports it as MP3.

It is designed for lectures, livestreams, online courses, webinars, and
knowledge videos where you want to keep a local audio recording while continuing
to listen normally.

Features:

- Record the current tab's audio with one click
- Pause and resume recording
- Continue recording after closing the popup
- Export recordings manually when ready
- Save as WebM/Opus, or export as MP3
- Light, dark, and follow-system themes
- Interface in English, Simplified Chinese, and Traditional Chinese
- In-popup settings for language, theme, and export format
- Use keyboard shortcuts for recording and pause/resume
- Keep tab audio audible while recording
- Capture only the selected tab, not microphone audio or system-wide audio
- No uploads, no analytics, no tracking, no external network requests

Limitations:

- Muted tabs cannot be recorded
- DRM-protected media may not be capturable
- Browser internal pages such as chrome:// pages cannot be recorded
- Long recordings stay in browser memory until exported; converting a very long
  recording to MP3 is memory-intensive (WebM/Opus stays available if it fails)

Privacy:

Tab Audio Recorder processes recordings locally in the browser, including MP3
conversion. It does not upload recordings, collect personal data, use analytics,
or contact external servers.

## Detailed Description - Chinese (Simplified)

Tab Audio Recorder 是一个轻量的浏览器标签页录音工具，可以一键录制当前标签页音频，保存为本地 WebM/Opus 文件，也可以导出为 MP3。

它适合在观看直播、网课、讲座、知识视频或线上会议回放时使用：你可以一边正常收听，一边把当前标签页的声音录下来，录完后再手动导出。

主要功能：

- 一键录制当前标签页音频
- 支持暂停和继续录制
- 关闭弹窗后录音不会中断
- 停止后手动确认导出
- 保存为本地 WebM/Opus，或导出为 MP3
- 浅色、深色、跟随系统三种主题
- 界面支持英文、简体中文、繁体中文
- 弹窗内设置页：语言、主题、导出格式
- 支持快捷键开始/停止、暂停/继续
- 录音期间仍可正常听到标签页声音
- 只捕获当前标签页，不录麦克风、不录系统全局声音
- 不上传、不分析、不追踪、不发起外部网络请求

已知限制：

- 标签页被静音时无法录制
- DRM 保护内容可能无法捕获
- chrome:// 等浏览器内部页面无法录制
- 长时间录音会在导出前占用浏览器内存；把超长录音转成 MP3 较吃内存（失败时仍可导出 WebM/Opus）

隐私说明：

Tab Audio Recorder 在浏览器本地处理录音（包括 MP3 转换），不上传录音文件，不收集个人数据，不使用分析服务，也不连接外部服务器。

## Detailed Description - Chinese (Traditional)

Tab Audio Recorder 是一款輕量的瀏覽器分頁錄音工具，可以一鍵錄製目前分頁的音訊，儲存為本機 WebM/Opus 檔案，也可以匯出為 MP3。

它適合在觀看直播、網課、講座、知識影片或線上會議回放時使用：你可以一邊正常收聽，一邊把目前分頁的聲音錄下來，錄完後再手動匯出。

主要功能：

- 一鍵錄製目前分頁音訊
- 支援暫停與繼續錄製
- 關閉彈出視窗後錄音不會中斷
- 停止後手動確認匯出
- 儲存為本機 WebM/Opus，或匯出為 MP3
- 淺色、深色、跟隨系統三種主題
- 介面支援英文、簡體中文、繁體中文
- 彈出視窗內設定頁：語言、主題、匯出格式
- 支援快速鍵開始/停止、暫停/繼續
- 錄音期間仍可正常聽到分頁聲音
- 只擷取目前分頁，不錄麥克風、不錄系統全域聲音
- 不上傳、不分析、不追蹤、不發起外部網路請求

已知限制：

- 分頁被靜音時無法錄製
- DRM 保護內容可能無法擷取
- chrome:// 等瀏覽器內部頁面無法錄製
- 長時間錄音會在匯出前佔用瀏覽器記憶體；將超長錄音轉成 MP3 較耗記憶體（失敗時仍可匯出 WebM/Opus）

隱私說明：

Tab Audio Recorder 在瀏覽器本機處理錄音（包含 MP3 轉換），不上傳錄音檔案，不收集個人資料，不使用分析服務，也不連接外部伺服器。

## Store Fields

- Website: use your public project page or GitHub repository URL
- Support URL: use GitHub Issues, a support page, or a public email contact page
- Privacy Policy URL: publish `store-assets/privacy-policy.md` or `store-assets/privacy-policy.html` as a public page and use that URL
- Pricing: Free
- Distribution visibility: Public

## Data Disclosure Recommendation

Use the privacy form to state that the extension does not collect or transmit
user data.

If Chrome asks about "Web browsing activity", explain that the extension reads
active tab metadata locally only to identify the recording target, display
status, generate filenames, and detect tab audio state. This data is not
collected or transmitted.

## Third-Party Notice

MP3 export uses lamejs (LGPL-3.0), bundled locally and unmodified. See
`src/vendor/lame.min.js.LICENSE`. It runs entirely in the browser and makes no
network requests.
