# Privacy Policy for Tab Audio Recorder

Last updated: June 13, 2026

Tab Audio Recorder is a browser extension that records audio from the currently selected browser tab and saves the recording as a local WebM/Opus file.

## Summary

Tab Audio Recorder does not collect, upload, sell, share, or transmit personal information. Recordings are processed locally in the browser and are only saved when the user chooses to export them.

## Data Collection

Tab Audio Recorder does not collect personal data.

The extension does not collect, store, or transmit:

- Names, email addresses, account identifiers, or contact information
- Browsing history
- Web page contents
- Search history
- Location data
- Authentication data
- Payment information
- Microphone audio
- System-wide audio
- Analytics or advertising identifiers

## Audio Recording

When the user starts recording, the extension captures audio from the currently selected browser tab using Chrome extension APIs. The recording is kept locally in browser memory until the user exports or discards it.

The extension does not upload recordings to any server. The extension does not send recordings to the developer or to any third party. The user remains responsible for how they use, store, or share exported recording files.

## Tab Information

The extension may read the active tab title and URL for the limited purpose of:

- Identifying the tab being recorded
- Showing recording status in the extension popup
- Creating a local filename for the exported recording
- Detecting tab audio state so recording can pause when the tab becomes silent or muted

This tab information is not transmitted outside the user's browser.

## Local Storage

The extension uses Chrome storage APIs only to save local extension state and user preferences, such as whether automatic pause behavior is enabled. This information remains in the user's browser.

## Network Requests

Tab Audio Recorder does not make external network requests.

## Third Parties

Tab Audio Recorder does not use third-party analytics, advertising SDKs, tracking scripts, or remote code.

## Permissions

The extension requests permissions only to provide its recording and export features:

- `tabCapture`: capture audio from the current tab after user action
- `offscreen`: run the local recording engine in a Manifest V3 offscreen document
- `downloads`: save exported recording files to the user's device
- `activeTab` and `tabs`: identify the active tab, read its title, and detect audio/mute state
- `notifications`: show recording status messages after shortcut actions
- `storage`: save local settings and temporary extension state

## Changes

If this privacy policy changes, the updated version will be published with a new "Last updated" date.

## Contact

For questions about this privacy policy, contact the publisher using the support email shown on the Chrome Web Store listing.

---

# Tab Audio Recorder 隐私政策

最后更新：2026 年 6 月 13 日

Tab Audio Recorder 是一个浏览器扩展，用于录制当前选中标签页的音频，并将录音保存为本地 WebM/Opus 文件。

## 摘要

Tab Audio Recorder 不收集、不上传、不出售、不共享、不传输个人信息。录音只在用户浏览器本地处理，只有当用户主动导出时才会保存为本地文件。

## 数据收集

Tab Audio Recorder 不收集个人数据。

本扩展不会收集、存储或传输：

- 姓名、邮箱、账号标识或联系方式
- 浏览历史
- 网页内容
- 搜索历史
- 位置信息
- 身份验证信息
- 支付信息
- 麦克风音频
- 系统全局音频
- 分析或广告标识符

## 音频录制

当用户开始录制时，本扩展会使用 Chrome 扩展 API 捕获当前选中标签页的音频。录音在用户导出或丢弃之前，仅临时保存在浏览器内存中。

本扩展不会把录音上传到任何服务器，也不会把录音发送给开发者或任何第三方。用户自行负责导出文件的使用、保存和分享。

## 标签页信息

本扩展可能会读取当前活动标签页的标题和 URL，仅用于：

- 识别正在录制的标签页
- 在扩展弹窗中显示录制状态
- 为本地导出的录音文件生成文件名
- 检测标签页音频/静音状态，以便在标签页静音或无声时暂停录制

这些标签页信息不会被传输到用户浏览器之外。

## 本地存储

本扩展仅使用 Chrome 存储 API 保存本地扩展状态和用户偏好，例如是否启用自动暂停。相关信息保留在用户浏览器本地。

## 网络请求

Tab Audio Recorder 不发起任何外部网络请求。

## 第三方

Tab Audio Recorder 不使用第三方分析、广告 SDK、追踪脚本或远程代码。

## 权限说明

本扩展只请求实现录音和导出功能所需的权限：

- `tabCapture`：在用户操作后捕获当前标签页音频
- `offscreen`：在 Manifest V3 的离屏文档中运行本地录音引擎
- `downloads`：把导出的录音文件保存到用户设备
- `activeTab` 和 `tabs`：识别当前活动标签页、读取标题并检测音频/静音状态
- `notifications`：在快捷键操作后显示录音状态通知
- `storage`：保存本地设置和临时扩展状态

## 变更

如果本隐私政策发生变化，更新后的版本会使用新的“最后更新”日期发布。

## 联系方式

如对本隐私政策有疑问，请通过 Chrome Web Store 商店页面显示的支持邮箱联系发布者。
