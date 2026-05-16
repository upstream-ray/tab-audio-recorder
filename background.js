const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const OFFSCREEN_DOCUMENT_URL = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
const DOWNLOAD_CLEANUP_TIMEOUT_MS = 10 * 60 * 1000;
const FALLBACK_DOWNLOAD_CLEANUP_TIMEOUT_MS = 60 * 1000;
const STOP_RECORDING_TIMEOUT_MS = 30 * 1000;

let creatingOffscreenDocument;
const pendingDownloadObjectUrls = new Set();
const pendingStopRequests = new Map();

chrome.runtime.onInstalled.addListener(() => {
  setRecordingBadge(false);
});

chrome.runtime.onStartup.addListener(() => {
  setRecordingBadge(false);
});

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
    case 'GET_STATUS':
      return { ok: true, status: await getStatus() };

    case 'START_RECORDING':
      return startRecording();

    case 'STOP_RECORDING':
      return stopRecording();

    case 'OFFSCREEN_STATUS_CHANGED':
      await setRecordingBadge(message.status?.state === 'recording');
      await broadcastStatus(message.status);
      return { ok: true };

    case 'OFFSCREEN_AUTO_STOPPED':
      await setRecordingBadge(false);
      await broadcastStatus({ state: 'saving' });
      await downloadRecording(message.recording);
      await broadcastStatus({ state: 'idle' });
      return { ok: true };

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

    default:
      return { ok: false, error: '未知指令。' };
  }
}

async function startRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state === 'recording' || currentStatus.state === 'stopping') {
    return { ok: false, error: '已经在录制中。' };
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

  await setRecordingBadge(true);
  await broadcastStatus(response.status);

  return {
    ok: true,
    status: response.status,
    warning: tab.audible === false ? '当前标签页暂未检测到声音，开始播放后会继续录制。' : ''
  };
}

async function stopRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state !== 'recording' && currentStatus.state !== 'stopping') {
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

  if (!response.recording?.objectUrl) {
    throw new Error('录音已停止，但没有生成可下载文件。');
  }

  await setRecordingBadge(false);
  const downloadResult = await downloadRecording(response.recording);
  const status = { state: 'idle' };
  await broadcastStatus(status);

  return {
    ok: true,
    status,
    downloadId: downloadResult.downloadId,
    downloadMethod: downloadResult.method,
    recording: {
      filename: response.recording.filename,
      mimeType: response.recording.mimeType,
      size: response.recording.size,
      durationMs: response.recording.durationMs
    }
  };
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
    await setRecordingBadge(false);
    return { state: 'idle' };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_STATUS'
    });

    if (response?.ok) {
      await setRecordingBadge(response.status?.state === 'recording');
      return response.status;
    }
  } catch (error) {
    // Fall back to the document URL hash if the offscreen document is alive but busy.
  }

  const state = context.documentUrl?.includes('#recording') ? 'recording' : 'idle';
  await setRecordingBadge(state === 'recording');
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
      await cleanupObjectUrl(recording.objectUrl);
      throw new Error(`浏览器下载失败：${toUserError(error)}；兜底下载失败：${toUserError(fallbackError)}`);
    }
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

async function setRecordingBadge(isRecording) {
  await chrome.action.setBadgeText({ text: isRecording ? 'REC' : '' });
  if (isRecording) {
    await chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  }
}

async function broadcastStatus(status) {
  try {
    await chrome.runtime.sendMessage({ target: 'popup', type: 'STATUS_CHANGED', status });
  } catch (error) {
    // No popup is listening right now.
  }
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
