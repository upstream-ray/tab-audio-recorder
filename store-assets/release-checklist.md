# Release Checklist

## Before Upload

- Load the unpacked extension in Chrome 116 or newer
- Record audio from a normal web page
- Pause and resume recording
- Stop recording and export a WebM file
- Export the same recording as MP3 and confirm it plays in Chrome or VLC
- Confirm the exported file plays in Chrome or VLC
- Test keyboard shortcuts
- Test a muted tab and confirm the extension shows a clear error
- Confirm no network requests are made by the extension (including MP3 export)
- Verify the settings page: switch language (English / 简体中文 / 繁體中文 / follow system), theme (light / dark / follow system), and export format (WebM / MP3)
- Verify localization across the three shipped locales `_locales/en`, `_locales/zh_CN`, `_locales/zh_TW`, with `en` as `default_locale`

## Build

Run `python build.py` to produce `dist/tab-audio-recorder-<version>.zip` (the version is read from `manifest.json`, currently 0.2.0). The script forces forward-slash paths inside the zip (Windows `Compress-Archive` writes backslashes, which Chrome rejects) and includes only `manifest.json`, `src/`, `icons/`, and `_locales/`. Note `src/vendor/lame.min.js` (LGPL-3.0) and its `.LICENSE` ship inside `src/`.

## Upload Package

Use the ZIP file in `dist/` (produced by `python build.py`). The ZIP should contain only:

- `manifest.json`
- `src/`
- `icons/`
- `_locales/` (`en`, `zh_CN`, `zh_TW`)

The ZIP should not contain:

- `.git/`
- `.claude/`
- `iterations/`
- `build.py`, `verify_i18n.py`, or other dev scripts
- project planning documents
- screenshots or store assets

## Dashboard Fields

- Publisher display name
- Public contact email
- Trader verification status
- Store listing copy
- Screenshots
- Small promotional tile
- Privacy policy URL
- Permission justifications
- Data usage declarations

## Suggested First Release Strategy

Submit as Unlisted first. Install it from the final Chrome Web Store URL, test the full recording/export flow, then switch to Public when you are comfortable.
