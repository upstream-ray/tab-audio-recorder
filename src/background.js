// i18n 加载器的内联副本。MV3 service worker 的 importScripts 加载 src/i18n.js
// 不可靠（会导致 I18N 未定义），所以这里直接内联，保证 background 一定可用。
// popup / offscreen 是 document 上下文，仍通过 <script src="i18n.js"> 共用同一份逻辑。
(function () {
  const SUPPORTED = ['en', 'zh_CN', 'zh_TW'];
  const FALLBACK = 'en';
  const tables = {};
  let current = guessFromBrowser();

  function guessFromBrowser() {
    // 与 i18n.js 保持一致：chrome.i18n 在受限上下文不可用时回退默认语言。
    try {
      const ui = (chrome.i18n.getUILanguage() || '').toLowerCase();
      if (ui.startsWith('zh')) {
        return /hant|tw|hk|mo/.test(ui) ? 'zh_TW' : 'zh_CN';
      }
      return 'en';
    } catch (error) {
      return FALLBACK;
    }
  }

  async function loadTable(lang) {
    if (tables[lang]) return;
    const url = chrome.runtime.getURL('_locales/' + lang + '/messages.json');
    const res = await fetch(url);
    tables[lang] = await res.json();
  }

  function format(entry, subs) {
    if (!entry) return '';
    let msg = entry.message;
    if (entry.placeholders) {
      for (const name in entry.placeholders) {
        const ref = entry.placeholders[name].content || '';
        const idx = parseInt(ref.replace(/[^0-9]/g, ''), 10) - 1;
        const val = subs && subs[idx] != null ? String(subs[idx]) : '';
        msg = msg.split('$' + name + '$').join(val);
      }
    }
    return msg;
  }

  function t(key, subs) {
    const table = tables[current] || {};
    const fallback = tables[FALLBACK] || {};
    return format(table[key] || fallback[key], subs);
  }

  const ready = (async () => {
    try {
      const { uiLang } = await chrome.storage.local.get('uiLang');
      if (uiLang && SUPPORTED.includes(uiLang)) current = uiLang;
    } catch (error) {
      // storage 不可用时退回浏览器语言推断。
    }
    await loadTable(current);
    if (current !== FALLBACK) await loadTable(FALLBACK);
  })();

  async function setLang(lang) {
    if (!SUPPORTED.includes(lang) || lang === current) return;
    await loadTable(lang);
    current = lang;
    try {
      await chrome.storage.local.set({ uiLang: lang });
    } catch (error) {
      // 偏好持久化失败不影响本次切换。
    }
  }

  function bcp47() {
    if (current === 'zh_CN') return 'zh-CN';
    if (current === 'zh_TW') return 'zh-TW';
    return 'en';
  }

  globalThis.I18N = {
    t,
    ready,
    setLang,
    bcp47,
    SUPPORTED,
    get lang() {
      return current;
    }
  };
})();

const t = (key, subs) => I18N.t(key, subs);

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html';
const OFFSCREEN_DOCUMENT_URL = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
const DOWNLOAD_CLEANUP_TIMEOUT_MS = 10 * 60 * 1000;
const FALLBACK_DOWNLOAD_CLEANUP_TIMEOUT_MS = 60 * 1000;
const STOP_RECORDING_TIMEOUT_MS = 30 * 1000;

let creatingOffscreenDocument;
let readyRecording = null;
let pendingNotice = null;
const pendingDownloadObjectUrls = new Set();
const pendingStopRequests = new Map();

let activeRecordingTabId = null;
let autoPaused = false;
let autoSyncEnabled = true;

chrome.storage.session.get(['autoPaused', 'activeRecordingTabId'], (result) => {
  if (result.autoPaused !== undefined) autoPaused = result.autoPaused;
  if (result.activeRecordingTabId !== undefined) activeRecordingTabId = result.activeRecordingTabId;
});

function setAutoPaused(value) {
  autoPaused = value;
  chrome.storage.session.set({ autoPaused: value });
}

function setActiveRecordingTabId(value) {
  activeRecordingTabId = value;
  chrome.storage.session.set({ activeRecordingTabId: value });
}

chrome.storage.local.get('autoSyncEnabled', (result) => {
  if (result.autoSyncEnabled !== undefined) {
    autoSyncEnabled = result.autoSyncEnabled;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  setStatusBadge({ state: 'idle' });
});

chrome.runtime.onStartup.addListener(() => {
  setStatusBadge({ state: 'idle' });
});

if (chrome.commands?.onCommand) {
  chrome.commands.onCommand.addListener(handleCommand);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!autoSyncEnabled || tabId !== activeRecordingTabId || changeInfo.audible === undefined) {
    return;
  }
  handleTabAudibleChange(changeInfo.audible);
});

async function handleCommand(command) {
  await I18N.ready;
  try {
    if (command === 'toggle-recording') {
      const status = await getStatus();
      if (status.state === 'recording' || status.state === 'paused') {
        const result = await stopRecording();
        await notifyUser(
          t('notifyStoppedTitle'),
          result.recording?.filename
            ? t('notifyStoppedSaved', [result.recording.filename])
            : t('notifyStoppedOpen')
        );
      } else if (status.state === 'idle') {
        const result = await startRecording();
        if (result.ok) {
          await notifyUser(t('notifyStartTitle'), result.warning || t('notifyStartBody'));
        } else {
          await notifyUser(t('notifyCantStartTitle'), result.error || t('notifyCantStartBody'));
        }
      } else if (status.state === 'ready') {
        await notifyUser(t('notifyReadyPendingTitle'), t('notifyReadyPendingBody'));
      }
    } else if (command === 'toggle-pause') {
      const status = await getStatus();
      if (status.state === 'recording') {
        await pauseRecording();
        await notifyUser(t('notifyPausedTitle'), t('notifyPausedBody'));
      } else if (status.state === 'paused') {
        setAutoPaused(false);
        await resumeRecording();
        await notifyUser(t('notifyResumedTitle'), t('notifyResumedBody'));
      }
    }
  } catch (error) {
    await notifyUser(t('notifyActionFailedTitle'), toUserError(error));
  }
}

async function notifyUser(title, message) {
  if (!chrome.notifications?.create) {
    return;
  }
  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: message || '',
      priority: 1
    });
  } catch (error) {
    // Notifications may be disabled by the user — fail silently.
  }
}

async function handleTabAudibleChange(audible) {
  try {
    const status = await getStatus();
    if (!audible && status.state === 'recording') {
      setAutoPaused(true);
      try {
        await pauseRecording();
      } catch (error) {
        setAutoPaused(false);
      }
    } else if (audible && autoPaused && status.state === 'paused') {
      setAutoPaused(false);
      await resumeRecording();
    }
  } catch (error) {
    // Don't disrupt recording for monitoring errors.
  }
}

async function handleStreamSilence() {
  try {
    const status = await getStatus();
    if (status.state === 'recording') {
      setAutoPaused(true);
      try {
        await pauseRecording();
      } catch (error) {
        setAutoPaused(false);
      }
    }
  } catch (error) {
    // Don't disrupt recording for monitoring errors.
  }
}

async function handleStreamResumed() {
  try {
    if (!autoPaused) return;
    const status = await getStatus();
    if (status.state === 'paused') {
      setAutoPaused(false);
      await resumeRecording();
    }
  } catch (error) {
    // Don't disrupt recording for monitoring errors.
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target && message.target !== 'background') {
    return false;
  }

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: toUserError(error) });
    });

  return true;
});

async function handleMessage(message) {
  await I18N.ready;
  switch (message?.type) {
    case 'GET_STATUS': {
      const status = await getStatus();
      const notice = consumePendingNotice();
      return { ok: true, status: enrichStatus(status), notice };
    }

    case 'START_RECORDING':
      return startRecording();

    case 'PAUSE_RECORDING':
      return pauseRecording();

    case 'RESUME_RECORDING':
      setAutoPaused(false);
      return resumeRecording();

    case 'STOP_RECORDING':
      return stopRecording();

    case 'EXPORT_RECORDING':
      return exportRecording();

    case 'RESET_ALL':
      return resetAll();

    case 'OFFSCREEN_STATUS_CHANGED':
      await setStatusBadge(message.status);
      await broadcastStatus(message.status);
      return { ok: true };

    case 'OFFSCREEN_AUTO_STOPPED': {
      setActiveRecordingTabId(null);
      setAutoPaused(false);
      readyRecording = message.recording;
      const readyStatus = buildReadyStatus(message.recording);
      const notice = {
        level: 'warning',
        text: t('noticeAutoStopped')
      };
      pendingNotice = notice;
      await setStatusBadge(readyStatus);
      await broadcastStatus(readyStatus, notice);
      return { ok: true };
    }

    case 'OFFSCREEN_RECORDING_STOPPED':
      resolvePendingStopRequest(message.requestId, {
        ok: true,
        recording: message.recording
      });
      return { ok: true };

    case 'OFFSCREEN_RECORDING_FAILED':
      rejectPendingStopRequest(
        message.requestId,
        new Error(message.error || t('errOffscreenStopFailed'))
      );
      return { ok: true };

    case 'OFFSCREEN_AUDIO_SILENCE':
      if (autoSyncEnabled) {
        await handleStreamSilence();
      }
      return { ok: true };

    case 'OFFSCREEN_AUDIO_RESUMED':
      if (autoSyncEnabled) {
        await handleStreamResumed();
      }
      return { ok: true };

    case 'GET_AUTO_SYNC':
      return { ok: true, autoSyncEnabled };

    case 'SET_AUTO_SYNC':
      autoSyncEnabled = !!message.enabled;
      chrome.storage.local.set({ autoSyncEnabled });
      if (!autoSyncEnabled) setAutoPaused(false);
      return { ok: true, autoSyncEnabled };

    default:
      return { ok: false, error: t('errUnknownCommand') };
  }
}

async function startRecording() {
  const currentStatus = await getStatus();
  if (['recording', 'paused', 'stopping'].includes(currentStatus.state)) {
    return { ok: false, error: t('errAlreadyRecording') };
  }

  if (currentStatus.state === 'ready') {
    return { ok: false, error: t('errReadyPending') };
  }

  const tab = await getActiveTab();
  validateTab(tab);

  if (tab.mutedInfo?.muted) {
    return { ok: false, error: t('errTabMuted') };
  }

  await ensureOffscreenDocument();

  const startedAt = new Date();
  const filename = buildRecordingFilename(tab.title, startedAt);
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id
  });

  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'START_RECORDING',
    payload: {
      streamId,
      tabId: tab.id,
      title: tab.title || 'Untitled Tab',
      pageUrl: tab.url || '',
      filename,
      startedAt: startedAt.toISOString()
    }
  });

  if (!response?.ok) {
    throw new Error(response?.error || t('errStartFailed'));
  }

  readyRecording = null;
  setActiveRecordingTabId(tab.id);
  await setStatusBadge(response.status);
  await broadcastStatus(response.status);

  return {
    ok: true,
    status: response.status,
    warning: tab.audible === false ? t('warnTabSilent') : ''
  };
}

async function pauseRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state !== 'recording') {
    return { ok: false, error: t('errNoActiveContent') };
  }

  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'PAUSE_RECORDING'
  });

  if (!response?.ok) {
    throw new Error(response?.error || t('errPauseFailed'));
  }

  await setStatusBadge(response.status);
  await broadcastStatus(response.status);
  return { ok: true, status: response.status };
}

async function resumeRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state !== 'paused') {
    return { ok: false, error: t('errNotPaused') };
  }

  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'RESUME_RECORDING'
  });

  if (!response?.ok) {
    throw new Error(response?.error || t('errResumeFailed'));
  }

  await setStatusBadge(response.status);
  await broadcastStatus(response.status);
  return { ok: true, status: response.status };
}

async function stopRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state === 'stopping') {
    return { ok: true, status: currentStatus, message: t('msgStoppingNow') };
  }

  if (currentStatus.state !== 'recording' && currentStatus.state !== 'paused') {
    return { ok: true, status: currentStatus, message: t('msgNoOngoingRecording') };
  }

  await broadcastStatus({ ...currentStatus, state: 'stopping' });

  const requestId = createRequestId();
  const stopResult = waitForOffscreenStop(requestId);

  let stopAck;
  try {
    stopAck = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'STOP_RECORDING',
      requestId
    });
  } catch (error) {
    clearPendingStopRequest(requestId);
    throw error;
  }

  if (!stopAck?.ok) {
    clearPendingStopRequest(requestId);
    throw new Error(stopAck?.error || t('errStopNotReceived'));
  }

  const response = await stopResult;

  setActiveRecordingTabId(null);
  setAutoPaused(false);

  if (!response.recording?.objectUrl) {
    throw new Error(t('errStoppedNoFile'));
  }

  readyRecording = response.recording;
  const status = buildReadyStatus(response.recording);
  await setStatusBadge(status);
  await broadcastStatus(status);

  return {
    ok: true,
    status,
    recording: toPublicRecording(response.recording)
  };
}

async function exportRecording() {
  const recording = await getReadyRecording();
  if (!recording?.objectUrl) {
    return { ok: false, error: t('errNothingToExportYet') };
  }

  const exportFormat = await getExportFormat();

  const readyStatus = buildReadyStatus(recording);
  const exportingStatus = { ...readyStatus, state: 'exporting' };
  await setStatusBadge(exportingStatus);
  await broadcastStatus(exportingStatus);

  const restoreReady = async () => {
    readyRecording = recording;
    await setStatusBadge(readyStatus);
    await broadcastStatus(readyStatus);
  };

  // 默认导出原始 WebM；选了 MP3 才让 offscreen 转码后下载转码产物。
  let target = recording;
  let originalObjectUrl = null;

  if (exportFormat === 'mp3') {
    try {
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'TRANSCODE_RECORDING',
        format: 'mp3'
      });

      if (!response?.ok || !response.recording?.objectUrl) {
        throw new Error(response?.error || t('errTranscodeFailed'));
      }

      target = response.recording;
      originalObjectUrl = recording.objectUrl;
    } catch (error) {
      await restoreReady();
      throw error;
    }
  }

  let downloadResult;
  try {
    downloadResult = await downloadRecording(target);
  } catch (error) {
    await restoreReady();
    throw error;
  }

  readyRecording = null;
  await clearReadyRecording(recording.objectUrl);
  if (originalObjectUrl) {
    await revokeOffscreenObjectUrl(originalObjectUrl);
  }

  const status = { state: 'idle' };
  await setStatusBadge(status);
  await broadcastStatus(status);

  return {
    ok: true,
    status,
    downloadId: downloadResult.downloadId,
    downloadMethod: downloadResult.method,
    recording: toPublicRecording(target)
  };
}

async function getExportFormat() {
  try {
    const { exportFormat } = await chrome.storage.local.get('exportFormat');
    return exportFormat === 'mp3' ? 'mp3' : 'webm';
  } catch (error) {
    return 'webm';
  }
}

async function revokeOffscreenObjectUrl(objectUrl) {
  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'REVOKE_OBJECT_URL',
      objectUrl
    });
  } catch (error) {
    // offscreen 文档可能已经关闭。
  }
}

async function resetAll() {
  setActiveRecordingTabId(null);
  setAutoPaused(false);

  for (const requestId of Array.from(pendingStopRequests.keys())) {
    rejectPendingStopRequest(requestId, new Error(t('errResetByUser')));
  }

  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'FORCE_RESET'
    });
  } catch (error) {
    // No offscreen document is alive.
  }

  const objectUrls = Array.from(pendingDownloadObjectUrls);
  pendingDownloadObjectUrls.clear();
  for (const url of objectUrls) {
    try {
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'REVOKE_OBJECT_URL',
        objectUrl: url
      });
    } catch (error) {
      // Offscreen may already be gone.
    }
  }

  readyRecording = null;
  pendingNotice = null;

  const context = await getOffscreenContext();
  if (context) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (error) {
      // Already closed.
    }
  }

  const status = { state: 'idle' };
  await setStatusBadge(status);
  await broadcastStatus(status);
  return { ok: true, status };
}

function waitForOffscreenStop(requestId) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingStopRequests.delete(requestId);
      reject(new Error(t('errStopTimeout')));
    }, STOP_RECORDING_TIMEOUT_MS);

    pendingStopRequests.set(requestId, {
      timeoutId,
      resolve,
      reject
    });
  });
}

function resolvePendingStopRequest(requestId, value) {
  const pending = pendingStopRequests.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingStopRequests.delete(requestId);
  pending.resolve(value);
}

function rejectPendingStopRequest(requestId, error) {
  const pending = pendingStopRequests.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingStopRequests.delete(requestId);
  pending.reject(error);
}

function clearPendingStopRequest(requestId) {
  const pending = pendingStopRequests.get(requestId);
  if (!pending) {
    return;
  }

  clearTimeout(pending.timeoutId);
  pendingStopRequests.delete(requestId);
}

function createRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error(t('errNoActiveTab'));
  }

  return tab;
}

function validateTab(tab) {
  const url = tab.url || '';
  const blockedSchemes = [
    'chrome://',
    'chrome-extension://',
    'edge://',
    'about:',
    'devtools://'
  ];

  if (blockedSchemes.some((scheme) => url.startsWith(scheme))) {
    throw new Error(t('errBlockedPage'));
  }
}

async function getStatus() {
  const context = await getOffscreenContext();
  if (!context) {
    readyRecording = null;
    await setStatusBadge({ state: 'idle' });
    return { state: 'idle' };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_STATUS'
    });

    if (response?.ok) {
      if (response.recording?.objectUrl) {
        readyRecording = response.recording;
      }

      if (['recording', 'paused'].includes(response.status?.state) && response.status?.tabId) {
        setActiveRecordingTabId(response.status.tabId);
      }

      const status = stripPrivateStatus(response.status);
      await setStatusBadge(status);
      return status;
    }
  } catch (error) {
    // Fall back to the document URL hash if the offscreen document is alive but busy.
  }

  const state = context.documentUrl?.includes('#recording') ? 'recording' : 'idle';
  await setStatusBadge({ state });
  return { state };
}

async function getOffscreenContext() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT']
  });

  return contexts.find((context) =>
    context.documentUrl?.startsWith(OFFSCREEN_DOCUMENT_URL)
  );
}

async function ensureOffscreenDocument() {
  if (await getOffscreenContext()) {
    return;
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'BLOBS'],
      justification: 'Record the current tab audio and keep playback audible.'
    });
  }

  try {
    await creatingOffscreenDocument;
  } finally {
    creatingOffscreenDocument = undefined;
  }
}

async function downloadRecording(recording) {
  if (!recording?.objectUrl || !recording?.filename) {
    throw new Error(t('errMissingDownloadInfo'));
  }

  pendingDownloadObjectUrls.add(recording.objectUrl);

  try {
    const downloadId = await chrome.downloads.download({
      url: recording.objectUrl,
      filename: recording.filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    watchDownloadForCleanup(downloadId, recording.objectUrl);
    return { downloadId, method: 'downloads' };
  } catch (error) {
    try {
      const fallback = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'DOWNLOAD_OBJECT_URL',
        objectUrl: recording.objectUrl,
        filename: recording.filename
      });

      if (!fallback?.ok) {
        throw new Error(fallback?.error || t('errFallbackDownloadFailed'));
      }

      setTimeout(
        () => cleanupObjectUrl(recording.objectUrl),
        FALLBACK_DOWNLOAD_CLEANUP_TIMEOUT_MS
      );

      return { downloadId: null, method: 'anchor' };
    } catch (fallbackError) {
      pendingDownloadObjectUrls.delete(recording.objectUrl);
      throw new Error(t('errDownloadFailed', [toUserError(error), toUserError(fallbackError)]));
    }
  }
}

async function getReadyRecording() {
  if (readyRecording?.objectUrl) {
    return readyRecording;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_READY_RECORDING'
    });

    if (response?.ok && response.recording?.objectUrl) {
      readyRecording = response.recording;
      return readyRecording;
    }
  } catch (error) {
    // No ready recording is available in the offscreen document.
  }

  return null;
}

async function clearReadyRecording(objectUrl) {
  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'CLEAR_READY_RECORDING',
      objectUrl
    });
  } catch (error) {
    // The offscreen document may already be gone.
  }
}

function watchDownloadForCleanup(downloadId, objectUrl) {
  let done = false;
  let timeoutId;

  const cleanup = async () => {
    if (done) {
      return;
    }

    done = true;
    clearTimeout(timeoutId);
    chrome.downloads.onChanged.removeListener(onChanged);
    await cleanupObjectUrl(objectUrl);
  };

  const onChanged = (delta) => {
    if (delta.id !== downloadId) {
      return;
    }

    const state = delta.state?.current;
    if (state === 'complete' || state === 'interrupted') {
      cleanup();
    }
  };

  chrome.downloads.onChanged.addListener(onChanged);
  timeoutId = setTimeout(cleanup, DOWNLOAD_CLEANUP_TIMEOUT_MS);
}

async function cleanupObjectUrl(objectUrl) {
  pendingDownloadObjectUrls.delete(objectUrl);

  try {
    await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'REVOKE_OBJECT_URL',
      objectUrl
    });
  } catch (error) {
    // The offscreen document may already be gone.
  }

  await closeOffscreenDocumentIfIdle();
}

async function closeOffscreenDocumentIfIdle() {
  if (pendingDownloadObjectUrls.size > 0) {
    return;
  }

  const context = await getOffscreenContext();
  if (!context) {
    return;
  }

  const status = await getStatus();
  if (status.state === 'idle') {
    await chrome.offscreen.closeDocument();
  }
}

async function setStatusBadge(status) {
  const state = status?.state || 'idle';
  const badgeByState = {
    recording: { text: 'REC', color: '#d93025' },
    paused: { text: 'PAU', color: '#b36200' },
    ready: { text: 'OK', color: '#16833a' },
    exporting: { text: 'OUT', color: '#1456d9' }
  };
  const badge = badgeByState[state] || { text: '', color: '#607089' };

  await chrome.action.setBadgeText({ text: badge.text });
  if (badge.text) {
    await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  }
}

async function broadcastStatus(status, notice) {
  try {
    const payload = {
      target: 'popup',
      type: 'STATUS_CHANGED',
      status: enrichStatus(stripPrivateStatus(status))
    };
    if (notice) {
      payload.notice = notice;
    }
    await chrome.runtime.sendMessage(payload);
    if (notice && pendingNotice === notice) {
      pendingNotice = null;
    }
  } catch (error) {
    // No popup is listening right now — keep pendingNotice for the next GET_STATUS.
  }
}

function consumePendingNotice() {
  const notice = pendingNotice;
  pendingNotice = null;
  return notice;
}

function buildReadyStatus(recording) {
  return {
    state: 'ready',
    title: recording?.title || '',
    filename: recording?.filename || '',
    mimeType: recording?.mimeType || 'audio/webm',
    size: recording?.size || 0,
    durationMs: recording?.durationMs || 0,
    elapsedMs: recording?.durationMs || 0,
    startedAt: recording?.startedAt || '',
    finishedAt: recording?.finishedAt || '',
    tabId: recording?.tabId
  };
}

function toPublicRecording(recording) {
  return {
    filename: recording?.filename || '',
    mimeType: recording?.mimeType || 'audio/webm',
    size: recording?.size || 0,
    durationMs: recording?.durationMs || 0,
    startedAt: recording?.startedAt || '',
    finishedAt: recording?.finishedAt || ''
  };
}

function enrichStatus(status) {
  if (!status) return { state: 'idle' };
  if (autoPaused && status.state === 'paused') {
    return { ...status, autoPaused: true };
  }
  return status;
}

function stripPrivateStatus(status) {
  if (!status) {
    return { state: 'idle' };
  }

  const { objectUrl, recording, ...publicStatus } = status;
  return publicStatus;
}

function buildRecordingFilename(title, date) {
  const safeTitle = sanitizeFilenamePart(title || 'tab-audio');
  return `${safeTitle}_${formatLocalTimestamp(date)}.webm`;
}

function sanitizeFilenamePart(value) {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();

  return (cleaned || 'tab-audio').slice(0, 80);
}

function formatLocalTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('-');
}

function toUserError(error) {
  const message = error?.message || String(error);

  if (message.includes('Cannot access contents of url')) {
    return t('errCannotAccessPage');
  }

  if (message.includes('Could not start audio source') || message.includes('Permission denied')) {
    return t('errCannotCapture');
  }

  if (message.includes('Extension has not been invoked')) {
    return t('errNeedUserGesture');
  }

  return message;
}
