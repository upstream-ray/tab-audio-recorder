# Tab Audio Recorder

Chrome / Edge Manifest V3 extension for recording the current tab audio locally as `.webm` with Opus audio.

## Load locally

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable developer mode.
3. Choose "Load unpacked".
4. Select this folder: `D:\code\tab-audio-recorder`.

## Use

1. Open a video, course, or live stream page.
2. Keep the page playing and do not mute the tab.
3. Click the extension icon.
4. Click "开始录制当前标签页".
5. Click "停止并保存" when finished.
6. The browser downloads a `.webm` file named like `网页标题_YYYY-MM-DD_HH-mm-ss.webm`.

The extension only uses the browser download mechanism. It does not upload recordings or call transcription APIs.

## Notes

- Requires Chrome 116+ or a Chromium-based Edge version with `chrome.offscreen` and `chrome.tabCapture` support.
- The tab audio is replayed through `AudioContext`, so headphones still work while recording.
- Very long recordings are kept in memory until stopped. A future segmented-save version should be used for multi-hour sessions.
- DRM-protected or browser-internal pages may not be capturable.
