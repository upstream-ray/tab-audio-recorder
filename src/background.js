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
  try {
    if (command === 'toggle-recording') {
      const status = await getStatus();
      if (status.state === 'recording' || status.state === 'paused') {
        const result = await stopRecording();
        await notifyUser(
          '录音已停止',
          result.recording?.filename
            ? `已生成：${result.recording.filename}，请打开扩展导出。`
            : '请打开扩展查看状态。'
        );
      } else if (status.state === 'idle') {
        const result = await startRecording();
        if (result.ok) {
          await notifyUser('开始录制', result.warning || '正在录制当前标签页音频。');
        } else {
          await notifyUser('无法开始录制', result.error || '请打开扩展查看详情。');
        }
      } else if (status.state === 'ready') {
        await notifyUser('有待导出录音', '请打开扩展导出或丢弃后再开始新的录制。');
      }
    } else if (command === 'toggle-pause') {
      const status = await getStatus();
      if (status.state === 'recording') {
        await pauseRecording();
        await notifyUser('录音已暂停', '页面声音仍在播放，可再次按快捷键继续。');
      } else if (status.state === 'paused') {
        autoPaused = false;
        await resumeRecording();
        await notifyUser('录音已继续', '继续把标签页音频写入文件。');
      }
    }
  } catch (error) {
    await notifyUser('操作失败', toUserError(error));
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
      autoPaused = true;
      try {
        await pauseRecording();
      } catch (error) {
        autoPaused = false;
      }
    } else if (audible && autoPaused && status.state === 'paused') {
      autoPaused = false;
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
      autoPaused = true;
      try {
        await pauseRecording();
      } catch (error) {
        autoPaused = false;
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
      autoPaused = false;
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
      autoPaused = false;
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
      activeRecordingTabId = null;
      autoPaused = false;
      readyRecording = message.recording;
      const readyStatus = buildReadyStatus(message.recording);
      const notice = {
        level: 'warning',
        text: '录制目标已结束（标签页关闭或音频流中断），录音已自动保存，请导出。'
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
        new Error(message.error || 'offscreen 停止录音失败。')
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
      if (!autoSyncEnabled) autoPaused = false;
      return { ok: true, autoSyncEnabled };

    default:
      return { ok: false, error: '未知指令。' };
  }
}

async function startRecording() {
  const currentStatus = await getStatus();
  if (['recording', 'paused', 'stopping'].includes(currentStatus.state)) {
    return { ok: false, error: '已经有录音正在进行。' };
  }

  if (currentStatus.state === 'ready') {
    return { ok: false, error: '已有一段录音待导出。请先导出后再开始新的录音。' };
  }

  const tab = await getActiveTab();
  validateTab(tab);

  if (tab.mutedInfo?.muted) {
    return { ok: false, error: '当前标签页处于静音状态。请先取消静音，再开始录制。' };
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
    throw new Error(response?.error || '启动录音失败。');
  }

  readyRecording = null;
  activeRecordingTabId = tab.id;
  await setStatusBadge(response.status);
  await broadcastStatus(response.status);

  return {
    ok: true,
    status: response.status,
    warning: tab.audible === false ? '当前标签页暂未检测到声音，开始播放后会继续录制。' : ''
  };
}

async function pauseRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state !== 'recording') {
    return { ok: false, error: '当前没有正在录制的内容。' };
  }

  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'PAUSE_RECORDING'
  });

  if (!response?.ok) {
    throw new Error(response?.error || '暂停录音失败。');
  }

  await setStatusBadge(response.status);
  await broadcastStatus(response.status);
  return { ok: true, status: response.status };
}

async function resumeRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state !== 'paused') {
    return { ok: false, error: '当前录音没有处于暂停状态。' };
  }

  const response = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'RESUME_RECORDING'
  });

  if (!response?.ok) {
    throw new Error(response?.error || '继续录音失败。');
  }

  await setStatusBadge(response.status);
  await broadcastStatus(response.status);
  return { ok: true, status: response.status };
}

async function stopRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state === 'stopping') {
    return { ok: true, status: currentStatus, message: '正在停止录音。' };
  }

  if (currentStatus.state !== 'recording' && currentStatus.state !== 'paused') {
    return { ok: true, status: currentStatus, message: '当前没有正在进行的录音。' };
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
    throw new Error(stopAck?.error || '录音后台没有接收停止请求。请重新打开扩展后再试。');
  }

  const response = await stopResult;

  activeRecordingTabId = null;
  autoPaused = false;

  if (!response.recording?.objectUrl) {
    throw new Error('录音已停止，但没有生成可下载文件。');
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
    return { ok: false, error: '没有可导出的录音文件。请先完成一次录音。' };
  }

  const readyStatus = buildReadyStatus(recording);
  const exportingStatus = { ...readyStatus, state: 'exporting' };
  await setStatusBadge(exportingStatus);
  await broadcastStatus(exportingStatus);

  let downloadResult;
  try {
    downloadResult = await downloadRecording(recording);
  } catch (error) {
    readyRecording = recording;
    await setStatusBadge(readyStatus);
    await broadcastStatus(readyStatus);
    throw error;
  }

  readyRecording = null;
  await clearReadyRecording(recording.objectUrl);

  const status = { state: 'idle' };
  await setStatusBadge(status);
  await broadcastStatus(status);

  return {
    ok: true,
    status,
    downloadId: downloadResult.downloadId,
    downloadMethod: downloadResult.method,
    recording: toPublicRecording(recording)
  };
}

async function resetAll() {
  activeRecordingTabId = null;
  autoPaused = false;

  for (const requestId of Array.from(pendingStopRequests.keys())) {
    rejectPendingStopRequest(requestId, new Error('已被用户重置。'));
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
      reject(new Error('等待录音文件生成超时。请在扩展详情页查看 service worker/offscreen 错误日志。'));
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
    throw new Error('没有找到当前活动标签页。');
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
    throw new Error('浏览器内置页面或扩展页面不能被录制。请切换到视频/直播网页后再开始。');
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
        activeRecordingTabId = response.status.tabId;
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
    throw new Error('录音结果缺少下载信息。');
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
        throw new Error(fallback?.error || '兜底下载也没有成功。');
      }

      setTimeout(
        () => cleanupObjectUrl(recording.objectUrl),
        FALLBACK_DOWNLOAD_CLEANUP_TIMEOUT_MS
      );

      return { downloadId: null, method: 'anchor' };
    } catch (fallbackError) {
      pendingDownloadObjectUrls.delete(recording.objectUrl);
      throw new Error(`浏览器下载失败：${toUserError(error)}；兜底下载失败：${toUserError(fallbackError)}`);
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
    return '当前页面不能被扩展访问，请换到普通网页后再试。';
  }

  if (message.includes('Could not start audio source') || message.includes('Permission denied')) {
    return '无法捕获当前标签页音频。请确认已在视频/直播网页中点击开始，且浏览器允许标签页捕获。';
  }

  if (message.includes('Extension has not been invoked')) {
    return '请从插件弹窗里点击开始录制，浏览器要求录音必须由用户主动触发。';
  }

  return message;
}
