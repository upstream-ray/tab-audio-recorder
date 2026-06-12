# Release Checklist

## Before Upload

- Load the unpacked extension in Chrome 116 or newer
- Record audio from a normal web page
- Pause and resume recording
- Stop recording and export a WebM file
- Confirm the exported file plays in Chrome or VLC
- Test keyboard shortcuts
- Test a muted tab and confirm the extension shows a clear error
- Confirm no network requests are made by the extension
- Verify localization: with the browser UI set to Chinese the popup/notifications show Chinese; with English they show English (the extension ships `_locales/zh_CN` and `_locales/en`, with `en` as `default_locale`)

## Build

Run `python build.py` to produce `dist/tab-audio-recorder-0.1.0.zip`. The script forces forward-slash paths inside the zip (Windows `Compress-Archive` writes backslashes, which Chrome rejects) and includes only `manifest.json`, `src/`, `icons/`, and `_locales/`.

## Upload Package

Use the ZIP file in `dist/` (produced by `python build.py`). The ZIP should contain only:

- `manifest.json`
- `src/`
- `icons/`
- `_locales/` (`en`, `zh_CN`)

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
