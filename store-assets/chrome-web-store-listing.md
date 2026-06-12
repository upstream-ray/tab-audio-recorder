# Chrome Web Store Listing

## Recommended Category

Productivity

## Language

The extension itself is bilingual: it ships `_locales/en` and `_locales/zh_CN`, with `en` as the manifest `default_locale`. Chrome shows Chinese to zh-CN users and English to everyone else (English is the fallback for unlisted locales).

In the Developer Dashboard, set the store listing's default language to **English** (matching `default_locale`) and add **Chinese (Simplified)** as an additional listing language, pasting the matching description below into each. This keeps the store listing consistent with the in-product language each user sees.

## Extension Name

Tab Audio Recorder

## Short Description

Record audio from the current tab locally as a WebM/Opus file. No uploads, no microphone, no tracking.

## One-Line Chinese Description

一键录制当前标签页音频，本地保存为 WebM/Opus 文件，不上传、不录麦克风。

## Detailed Description - English

Tab Audio Recorder records audio from the current browser tab and saves it locally as a WebM/Opus file.

It is designed for lectures, livestreams, online courses, webinars, and knowledge videos where you want to keep a local audio recording while continuing to listen normally.

Features:

- Record the current tab's audio with one click
- Pause and resume recording
- Continue recording after closing the popup
- Export recordings manually when ready
- Save files locally as WebM/Opus
- Use keyboard shortcuts for recording and pause/resume
- Keep tab audio audible while recording
- Capture only the selected tab, not microphone audio or system-wide audio
- No uploads, no analytics, no tracking, no external network requests

Limitations:

- Muted tabs cannot be recorded
- DRM-protected media may not be capturable
- Browser internal pages such as chrome:// pages cannot be recorded
- Long recordings stay in browser memory until exported

Privacy:

Tab Audio Recorder processes recordings locally in the browser. It does not upload recordings, collect personal data, use analytics, or contact external servers.

## Detailed Description - Chinese

Tab Audio Recorder 是一个轻量的浏览器标签页录音工具，可以一键录制当前标签页音频，并保存为本地 WebM/Opus 文件。

它适合在观看直播、网课、讲座、知识视频或线上会议回放时使用：你可以一边正常收听，一边把当前标签页的声音录下来，录完后再手动导出。

主要功能：

- 一键录制当前标签页音频
- 支持暂停和继续录制
- 关闭弹窗后录音不会中断
- 停止后手动确认导出
- 保存为本地 WebM/Opus 文件
- 支持快捷键开始/停止、暂停/继续
- 录音期间仍可正常听到标签页声音
- 只捕获当前标签页，不录麦克风、不录系统全局声音
- 不上传、不分析、不追踪、不发起外部网络请求

已知限制：

- 标签页被静音时无法录制
- DRM 保护内容可能无法捕获
- chrome:// 等浏览器内部页面无法录制
- 长时间录音会在导出前占用浏览器内存

隐私说明：

Tab Audio Recorder 在浏览器本地处理录音，不上传录音文件，不收集个人数据，不使用分析服务，也不连接外部服务器。

## Store Fields

- Website: use your public project page or GitHub repository URL
- Support URL: use GitHub Issues, a support page, or a public email contact page
- Privacy Policy URL: publish `store-assets/privacy-policy.md` or `store-assets/privacy-policy.html` as a public page and use that URL
- Pricing: Free
- Distribution visibility: Unlisted first, then Public after self-testing

## Data Disclosure Recommendation

Use the privacy form to state that the extension does not collect or transmit user data.

If Chrome asks about "Web browsing activity", explain that the extension reads active tab metadata locally only to identify the recording target, display status, generate filenames, and detect tab audio state. This data is not collected or transmitted.
