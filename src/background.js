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

// 录音持久化层。service worker 里 importScripts 的相对路径以脚本自身位置为基准，
// 写成 'src/store.js' 会解析到 src/src/store.js 而静默失败，所以一律用绝对 URL。
importScripts(chrome.runtime.getURL('src/store.js'));

const OFFSCREEN_DOCUMENT_PATH = 'src/offscreen.html';
const OFFSCREEN_DOCUMENT_URL = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
const DOWNLOAD_CLEANUP_TIMEOUT_MS = 10 * 60 * 1000;
const FALLBACK_DOWNLOAD_CLEANUP_TIMEOUT_MS = 60 * 1000;
const STOP_RECORDING_TIMEOUT_MS = 30 * 1000;
const SESSION_SAMPLE_RATE = 48000;
const MP3_BITRATE_KBPS = 128;

let creatingOffscreenDocument;
let pendingNotice = null;
const pendingDownloadObjectUrls = new Set();
const pendingStopRequests = new Map();

let activeRecordingTabId = null;
let autoPaused = false;
let autoSyncEnabled = true;
let keepWebmEnabled = true;

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

chrome.storage.local.get(['autoSyncEnabled', 'keepWebm'], (result) => {
  if (result.autoSyncEnabled !== undefined) {
    autoSyncEnabled = result.autoSyncEnabled;
  }
  if (result.keepWebm !== undefined) {
    keepWebmEnabled = result.keepWebm !== false;
  }
});

// 上次没走正常停止流程（崩溃、直接关浏览器）的会话，state 会停在 'recording'。
// Service Worker 每次起来先把它们收拢成「已暂停」，用户就能在录音记录里继续或导出。
let recoveryPromise;

function ensureRecovery() {
  if (!recoveryPromise) {
    recoveryPromise = runRecovery().catch((error) => {
      console.warn('[tab-audio-recorder] session recovery failed:', error);
      return [];
    });
  }
  return recoveryPromise;
}

async function runRecovery() {
  // Service Worker 可能在录音中途被回收再唤醒，此时 offscreen 还在录。
  // 先问清楚谁在录，别把活着的会话判成中断。
  let activeSessionId = null;
  try {
    const status = await getStatus();
    if (['recording', 'paused', 'stopping'].includes(status.state)) {
      activeSessionId = status.sessionId || null;
    }
  } catch (error) {
    // 问不到就按没有活动会话处理。
  }

  return RecordingStore.recoverInterrupted(activeSessionId);
}

chrome.runtime.onInstalled.addListener(() => {
  ensureRecovery().then(() => setStatusBadge({ state: 'idle' }));
});

chrome.runtime.onStartup.addListener(() => {
  ensureRecovery().then(() => setStatusBadge({ state: 'idle' }));
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
  await ensureRecovery();
  try {
    const status = await getStatus();

    if (command === 'toggle-recording') {
      if (status.state === 'recording' || status.state === 'paused') {
        const result = await stopRecording();
        await notifyUser(
          t('notifyStoppedTitle'),
          result.session?.filename
            ? t('notifyStoppedSaved', [result.session.filename])
            : t('notifyStoppedOpen')
        );
        return result;
      }

      const result = await startRecording();
      if (result?.ok) {
        await notifyUser(t('notifyStartTitle'), result.warning || t('notifyStartBody'));
      } else {
        await notifyUser(t('notifyCantStartTitle'), result?.error || t('notifyCantStartBody'));
      }
      return result;
    }

    if (command === 'toggle-pause') {
      if (status.state === 'recording') {
        const result = await pauseRecording();
        await notifyUser(t('notifyPausedTitle'), t('notifyPausedBody'));
        return result;
      }

      if (status.state === 'paused') {
        setAutoPaused(false);
        const result = await resumeRecording();
        await notifyUser(t('notifyResumedTitle'), t('notifyResumedBody'));
        return result;
      }
    }
  } catch (error) {
    await notifyUser(t('notifyActionFailedTitle'), toUserError(error));
  }
}

async function notifyUser(title, message) {
  if (!chrome.notifications) {
    return;
  }

  try {
    await chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message
    });
  } catch (error) {
    // 通知失败不影响录音本身。
  }
}

// 「标签页静音时自动暂停」：页面不出声就暂停，出声了自动接上。
async function handleTabAudibleChange(audible) {
  const status = await getStatus();

  if (!audible && status.state === 'recording') {
    try {
      await pauseRecording();
      setAutoPaused(true);
    } catch (error) {
      // 暂停失败就维持原状。
    }
    return;
  }

  if (audible && status.state === 'paused' && autoPaused) {
    try {
      await resumeRecording();
      setAutoPaused(false);
    } catch (error) {
      // 恢复失败就维持原状。
    }
  }
}

async function handleStreamSilence() {
  const status = await getStatus();
  if (status.state !== 'recording') {
    return;
  }

  try {
    await pauseRecording();
    setAutoPaused(true);
  } catch (error) {
    // 忽略。
  }
}

async function handleStreamResumed() {
  if (!autoPaused) {
    return;
  }

  const status = await getStatus();
  if (status.state !== 'paused') {
    return;
  }

  try {
    await resumeRecording();
    setAutoPaused(false);
  } catch (error) {
    // 忽略。
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'background') {
    return false;
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: toUserError(error) });
    });

  return true;
});

async function handleMessage(message) {
  await I18N.ready;
  await ensureRecovery();
  switch (message?.type) {
    case 'GET_STATUS': {
      const status = await getStatus();
      const notice = consumePendingNotice();
      return { ok: true, ...(await withSessions(status)), notice };
    }

    case 'START_RECORDING':
      return startRecording(message.sessionId);

    case 'PAUSE_RECORDING':
      return pauseRecording();

    case 'RESUME_RECORDING':
      setAutoPaused(false);
      return resumeRecording();

    case 'STOP_RECORDING':
      return stopRecording();

    case 'EXPORT_SESSION':
      return exportSession(message.sessionId, message.format);

    case 'DELETE_SESSION':
      return deleteSession(message.sessionId);

    case 'RESET_ALL':
      return resetAll();

    case 'OFFSCREEN_STATUS_CHANGED':
      await setStatusBadge(message.status);
      await broadcastStatus(message.status);
      return { ok: true };

    case 'OFFSCREEN_AUTO_STOPPED': {
      setActiveRecordingTabId(null);
      setAutoPaused(false);
      const notice = {
        level: 'warning',
        text: t('noticeAutoStopped')
      };
      pendingNotice = notice;
      const status = { state: 'idle' };
      await setStatusBadge(status);
      await broadcastStatus(status, notice);
      return { ok: true };
    }

    case 'OFFSCREEN_STORAGE_FAILED': {
      const notice = {
        level: 'error',
        text: t('noticeStorageFailed', [message.error || ''])
      };
      pendingNotice = notice;
      await notifyUser(t('notifyActionFailedTitle'), notice.text);
      try {
        await pauseRecording();
      } catch (error) {
        // 已经不在录了。
      }
      await broadcastStatus(await getStatus(), notice);
      return { ok: true };
    }

    case 'OFFSCREEN_RECORDING_STOPPED':
      resolvePendingStopRequest(message.requestId, {
        ok: true,
        session: message.session
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

    case 'GET_SETTINGS':
      return { ok: true, autoSyncEnabled, keepWebm: keepWebmEnabled };

    case 'SET_AUTO_SYNC':
      autoSyncEnabled = !!message.enabled;
      chrome.storage.local.set({ autoSyncEnabled });
      if (!autoSyncEnabled) setAutoPaused(false);
      return { ok: true, autoSyncEnabled };

    case 'SET_KEEP_WEBM':
      keepWebmEnabled = !!message.enabled;
      chrome.storage.local.set({ keepWebm: keepWebmEnabled });
      return { ok: true, keepWebm: keepWebmEnabled };

    default:
      return { ok: false, error: t('errUnknownCommand') };
  }
}

// sessionId 有值 = 在已有会话上续录（新开一段追加进去）；没有 = 新建会话。
async function startRecording(resumeSessionId) {
  const currentStatus = await getStatus();
  if (['recording', 'paused', 'stopping'].includes(currentStatus.state)) {
    return { ok: false, error: t('errAlreadyRecording') };
  }

  const tab = await getActiveTab();
  validateTab(tab);

  if (tab.mutedInfo?.muted) {
    return { ok: false, error: t('errTabMuted') };
  }

  let session;
  if (resumeSessionId) {
    session = await RecordingStore.getSession(resumeSessionId);
    if (!session) {
      return { ok: false, error: t('errSessionMissing') };
    }
  } else {
    const startedAt = new Date();
    session = await RecordingStore.createSession({
      title: tab.title || 'Untitled Tab',
      pageUrl: tab.url || '',
      filename: buildRecordingFilename(tab.title, startedAt),
      tabId: tab.id,
      sampleRate: SESSION_SAMPLE_RATE,
      mp3Kbps: MP3_BITRATE_KBPS,
      keepWebm: keepWebmEnabled
    });
  }

  let response;
  try {
    await ensureOffscreenDocument();

    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });

    response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'START_RECORDING',
      payload: {
        streamId,
        tabId: tab.id,
        session
      }
    });

    if (!response?.ok) {
      throw new Error(response?.error || t('errStartFailed'));
    }
  } catch (error) {
    // 新建的会话还没录到任何东西，别在列表里留个空壳。
    if (!resumeSessionId) {
      await RecordingStore.deleteSession(session.id).catch(() => {});
    }
    throw error;
  }

  setActiveRecordingTabId(tab.id);
  await setStatusBadge(response.status);
  await broadcastStatus(response.status);

  return {
    ok: true,
    ...(await withSessions(response.status)),
    resumed: !!resumeSessionId,
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
  return { ok: true, ...(await withSessions(response.status)) };
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
  return { ok: true, ...(await withSessions(response.status)) };
}

// MediaRecorder.stop() 是异步的，必须等最后一片 dataavailable 落盘，
// 所以挂一个带超时的 promise，由 offscreen 的 OFFSCREEN_RECORDING_STOPPED 来 resolve。
async function stopRecording() {
  const currentStatus = await getStatus();
  if (currentStatus.state === 'stopping') {
    return { ok: true, ...(await withSessions(currentStatus)), message: t('msgStoppingNow') };
  }

  if (currentStatus.state !== 'recording' && currentStatus.state !== 'paused') {
    return { ok: true, ...(await withSessions(currentStatus)), message: t('msgNoOngoingRecording') };
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

  const status = { state: 'idle' };
  await setStatusBadge(status);
  await broadcastStatus(status);

  return {
    ok: true,
    ...(await withSessions(status)),
    session: toPublicSession(response.session)
  };
}

// 导出 = 把已落盘的分片按序拼起来。MP3 在录制时就编好了，所以这里没有转码等待。
async function exportSession(sessionId, formatOverride) {
  const session = await RecordingStore.getSession(sessionId);
  if (!session) {
    return { ok: false, error: t('errSessionMissing') };
  }

  if (session.state === 'recording') {
    return { ok: false, error: t('errExportWhileRecording') };
  }

  const format = formatOverride || (await getExportFormat());
  const baseStatus = await getStatus();
  await broadcastStatus({ ...baseStatus, state: 'exporting' });

  const restore = async () => {
    const status = await getStatus();
    await setStatusBadge(status);
    await broadcastStatus(status);
  };

  let files;
  try {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'BUILD_EXPORT',
      sessionId,
      format
    });

    if (!response?.ok || !response.files?.length) {
      throw new Error(response?.error || t('errExportFailed'));
    }

    files = response.files;
  } catch (error) {
    await restore();
    throw error;
  }

  const methods = [];
  try {
    for (const file of files) {
      const result = await downloadRecording(file);
      methods.push(result.method);
    }
  } catch (error) {
    await restore();
    throw error;
  }

  await RecordingStore.updateSession(sessionId, {
    lastExportAt: new Date().toISOString(),
    lastExportName: files[0].filename
  });

  const status = await getStatus();
  await setStatusBadge(status);
  await broadcastStatus(status);

  return {
    ok: true,
    ...(await withSessions(status)),
    format,
    downloadMethod: methods[0],
    files: files.map((file) => ({
      filename: file.filename,
      mimeType: file.mimeType,
      size: file.size
    }))
  };
}

async function deleteSession(sessionId) {
  const status = await getStatus();
  if (status.sessionId === sessionId && status.state !== 'idle') {
    return { ok: false, error: t('errDeleteWhileRecording') };
  }

  await RecordingStore.deleteSession(sessionId);

  const nextStatus = await getStatus();
  await setStatusBadge(nextStatus);
  await broadcastStatus(nextStatus);
  return { ok: true, ...(await withSessions(nextStatus)) };
}

async function getExportFormat() {
  try {
    const { exportFormat } = await chrome.storage.local.get('exportFormat');
    return exportFormat === 'mp3' ? 'mp3' : 'webm';
  } catch (error) {
    return 'webm';
  }
}

// 复位只清运行时状态，不动已经存下来的录音——那是用户的数据，只能由他手动删。
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
    // 没有存活的 offscreen 文档。
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
      // offscreen 可能已经关了。
    }
  }

  pendingNotice = null;

  const context = await getOffscreenContext();
  if (context) {
    try {
      await chrome.offscreen.closeDocument();
    } catch (error) {
      // 已经关闭。
    }
  }

  const status = { state: 'idle' };
  await setStatusBadge(status);
  await broadcastStatus(status);
  return { ok: true, ...(await withSessions(status)) };
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
    await setStatusBadge({ state: 'idle' });
    return { state: 'idle' };
  }

  try {
    const response = await chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'GET_STATUS'
    });

    if (response?.ok) {
      if (['recording', 'paused'].includes(response.status?.state) && response.status?.tabId) {
        setActiveRecordingTabId(response.status.tabId);
      }

      const status = response.status || { state: 'idle' };
      await setStatusBadge(status);
      return status;
    }
  } catch (error) {
    // offscreen 活着但正忙时，退回用文档 URL 的 hash 判断。
  }

  const state = context.documentUrl?.includes('#recording') ? 'recording' : 'idle';
  await setStatusBadge({ state });
  return { state };
}

// popup 需要的完整快照：当前状态 + 录音记录列表 + 本地占用。
async function withSessions(status) {
  let sessions = [];
  let usage = { count: 0, bytes: 0 };

  try {
    sessions = (await RecordingStore.listSessions()).map(toPublicSession);
    usage = await RecordingStore.usage();
  } catch (error) {
    console.warn('[tab-audio-recorder] listing sessions failed:', error);
  }

  return { status: enrichStatus(status), sessions, usage };
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

// 下载双通道：chrome.downloads 主路径 + offscreen 内 <a download> 兜底。两条都要保持可用。
async function downloadRecording(file) {
  if (!file?.objectUrl || !file?.filename) {
    throw new Error(t('errMissingDownloadInfo'));
  }

  pendingDownloadObjectUrls.add(file.objectUrl);

  try {
    const downloadId = await chrome.downloads.download({
      url: file.objectUrl,
      filename: file.filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    watchDownloadForCleanup(downloadId, file.objectUrl);
    return { downloadId, method: 'downloads' };
  } catch (error) {
    try {
      const fallback = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'DOWNLOAD_OBJECT_URL',
        objectUrl: file.objectUrl,
        filename: file.filename
      });

      if (!fallback?.ok) {
        throw new Error(fallback?.error || t('errFallbackDownloadFailed'));
      }

      setTimeout(
        () => cleanupObjectUrl(file.objectUrl),
        FALLBACK_DOWNLOAD_CLEANUP_TIMEOUT_MS
      );

      return { downloadId: null, method: 'anchor' };
    } catch (fallbackError) {
      pendingDownloadObjectUrls.delete(file.objectUrl);
      throw new Error(t('errDownloadFailed', [toUserError(error), toUserError(fallbackError)]));
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
    // offscreen 可能已经关了。
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
    stopping: { text: 'PAU', color: '#b36200' },
    exporting: { text: 'OUT', color: '#1456d9' }
  };
  let badge = badgeByState[state];

  // 空闲时如果还有没导出过的录音，用 OK 提醒用户「东西还在这儿」。
  if (!badge) {
    badge = { text: '', color: '#607089' };
    try {
      const sessions = await RecordingStore.listSessions();
      if (sessions.some((session) => !session.lastExportAt)) {
        badge = { text: 'OK', color: '#16833a' };
      }
    } catch (error) {
      // 读不到就不显示徽标。
    }
  }

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
      ...(await withSessions(status))
    };
    if (notice) {
      payload.notice = notice;
    }
    await chrome.runtime.sendMessage(payload);
    if (notice && pendingNotice === notice) {
      pendingNotice = null;
    }
  } catch (error) {
    // 没有 popup 在听——留着 pendingNotice 等下次 GET_STATUS。
  }
}

function consumePendingNotice() {
  const notice = pendingNotice;
  pendingNotice = null;
  return notice;
}

function toPublicSession(session) {
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    title: session.title || '',
    filename: session.filename || '',
    state: session.state || 'stopped',
    durationMs: session.durationMs || 0,
    bytes: (session.webmBytes || 0) + (session.mp3Bytes || 0),
    hasWebm: !!session.keepWebm && (session.webmBytes || 0) > 0,
    hasMp3: (session.mp3Bytes || 0) > 0,
    segmentCount: session.segmentCount || 0,
    interrupted: !!session.interrupted,
    createdAt: session.createdAt || '',
    lastExportAt: session.lastExportAt || ''
  };
}

function enrichStatus(status) {
  if (!status) return { state: 'idle' };
  if (autoPaused && status.state === 'paused') {
    return { ...status, autoPaused: true };
  }
  return status;
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
