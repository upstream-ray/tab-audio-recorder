# Permission Justifications

Use these explanations in the Chrome Web Store privacy and permissions review fields.

## Single Purpose

Tab Audio Recorder lets users record audio from the currently selected browser tab and export the recording as a local WebM/Opus file. It does not upload recordings, record microphone audio, capture system-wide audio, or communicate with external servers.

## `tabCapture`

Required to capture the audio stream from the current browser tab after the user starts recording. Without this permission, the extension cannot record tab audio.

## `offscreen`

Required by Manifest V3 to run the local recording engine in an offscreen document. The service worker cannot directly use all recording APIs needed for continuous audio recording.

## `downloads`

Required to save the completed recording file to the user's device when the user clicks export.

## `activeTab`

Required to act on the currently selected tab after a user gesture. The extension uses this to identify which tab should be recorded.

## `tabs`

Required to read the active tab title, URL, audible state, and mute state. The title is used for the local recording filename and popup display. The audible/mute state is used to warn users or pause recording when tab audio is unavailable.

## `notifications`

Required to show recording status messages when the user controls recording with keyboard shortcuts while the popup is closed.

## `storage`

Required to save local extension state and user preferences, such as whether automatic pause behavior is enabled. Data remains in the user's browser.

## Host Permissions

The extension does not request host permissions.

## Remote Code

The extension does not use remote code.

## Network Requests

The extension does not make external network requests.
