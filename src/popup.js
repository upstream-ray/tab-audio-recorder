// Popup UI —— 纯展示层。所有动作都委托给 background，状态通过 STATUS_CHANGED 广播被动更新。
// 录音数据本身在 IndexedDB 里，popup 只拿 background 汇总好的会话列表。

const t = (key, subs) => I18N.t(key, subs);

function localizeStatic() {
  document.documentElement.lang = I18N.bcp47();
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const message = t(node.dataset.i18n);
    if (message) {
      node.textContent = message;
    }
  }
  for (const node of document.querySelectorAll('[data-i18n-aria]')) {
    const message = t(node.dataset.i18nAria);
    if (message) {
      node.setAttribute('aria-label', message);
    }
  }
}

const THEMES = ['light', 'dark', 'auto'];

async function applyStoredTheme() {
  let theme = 'auto';
  try {
    const { uiTheme } = await chrome.storage.local.get('uiTheme');
    if (THEMES.includes(uiTheme)) {
      theme = uiTheme;
    }
  } catch (error) {
    // storage 不可用时使用跟随系统。
  }
  document.documentElement.dataset.theme = theme;
}

async function loadExportFormat() {
  try {
    const { exportFormat: stored } = await chrome.storage.local.get('exportFormat');
    exportFormat = stored === 'mp3' ? 'mp3' : 'webm';
  } catch (error) {
    exportFormat = 'webm';
  }
}

function setupSettings() {
  const settingsButton = document.getElementById('settingsButton');
  const backButton = document.getElementById('backButton');
  const mainView = document.getElementById('mainView');
  const settingsView = document.getElementById('settingsView');
  const langButtons = document.querySelectorAll('#langOptions [data-lang]');
  const themeButtons = document.querySelectorAll('#themeOptions [data-theme-opt]');

  const showSettings = (open) => {
    mainView.hidden = open;
    settingsView.hidden = !open;
  };

  settingsButton.addEventListener('click', () => showSettings(true));
  backButton.addEventListener('click', () => showSettings(false));

  const syncLangActive = () => {
    for (const button of langButtons) {
      button.classList.toggle('active', button.dataset.lang === I18N.pref);
    }
  };

  syncLangActive();

  for (const button of langButtons) {
    button.addEventListener('click', async () => {
      if (button.dataset.lang === I18N.pref) {
        return;
      }
      await I18N.setLang(button.dataset.lang);
      syncLangActive();
      localizeStatic();
      render();
      setMessage('');
    });
  }

  const syncThemeActive = () => {
    const active = document.documentElement.dataset.theme || 'auto';
    for (const button of themeButtons) {
      button.classList.toggle('active', button.dataset.themeOpt === active);
    }
  };

  syncThemeActive();

  for (const button of themeButtons) {
    button.addEventListener('click', async () => {
      const theme = button.dataset.themeOpt;
      if (theme === document.documentElement.dataset.theme) {
        return;
      }
      document.documentElement.dataset.theme = theme;
      syncThemeActive();
      try {
        await chrome.storage.local.set({ uiTheme: theme });
      } catch (error) {
        // 持久化失败不影响本次切换。
      }
    });
  }

  const formatButtons = document.querySelectorAll('#formatOptions [data-format]');

  const syncFormatActive = () => {
    for (const button of formatButtons) {
      button.classList.toggle('active', button.dataset.format === exportFormat);
    }
  };

  syncFormatActive();

  for (const button of formatButtons) {
    button.addEventListener('click', async () => {
      if (button.dataset.format === exportFormat) {
        return;
      }
      exportFormat = button.dataset.format;
      syncFormatActive();
      render();
      try {
        await chrome.storage.local.set({ exportFormat });
      } catch (error) {
        // 持久化失败不影响本次切换。
      }
    });
  }
}

const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  timer: document.getElementById('timer'),
  tabTitle: document.getElementById('tabTitle'),
  formatText: document.getElementById('formatText'),
  usageText: document.getElementById('usageText'),
  startButton: document.getElementById('startButton'),
  pauseButton: document.getElementById('pauseButton'),
  stopButton: document.getElementById('stopButton'),
  resetButton: document.getElementById('resetButton'),
  message: document.getElementById('message'),
  autoSyncToggle: document.getElementById('autoSyncToggle'),
  keepWebmToggle: document.getElementById('keepWebmToggle'),
  sessionList: document.getElementById('sessionList'),
  sessionsEmpty: document.getElementById('sessionsEmpty'),
  sessionsLabel: document.getElementById('sessionsLabel')
};

let currentStatus = { state: 'idle' };
let sessions = [];
let usage = { count: 0, bytes: 0 };
let statusReceivedAt = Date.now();
let timerId;
let exportFormat = 'webm';
let busy = false;

document.addEventListener('DOMContentLoaded', async () => {
  await I18N.ready;
  await applyStoredTheme();
  await loadExportFormat();
  localizeStatic();
  setupSettings();

  els.startButton.addEventListener('click', onStartClick);
  els.pauseButton.addEventListener('click', onPauseClick);
  els.stopButton.addEventListener('click', onStopClick);
  els.resetButton.addEventListener('click', onResetClick);
  els.autoSyncToggle.addEventListener('change', onAutoSyncChange);
  els.keepWebmToggle.addEventListener('change', onKeepWebmChange);

  loadSettings();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target === 'popup' && message?.type === 'STATUS_CHANGED') {
      applySnapshot(message);
      if (message.notice?.text) {
        setMessage(message.notice.text, message.notice.level || '');
      }
    }
  });

  refreshStatus();
  timerId = setInterval(updateTimer, 1000);
});

window.addEventListener('unload', () => {
  clearInterval(timerId);
});

/* ---------- 主控操作 ---------- */

async function onStartClick() {
  setBusy(true);
  setMessage(t('msgStarting'));

  try {
    const response = await sendMessage({ target: 'background', type: 'START_RECORDING' });
    applySnapshot(response);

    if (response.warning) {
      setMessage(response.warning, 'warning');
    } else {
      setMessage(t('msgStarted'));
    }
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onPauseClick() {
  const isPaused = currentStatus.state === 'paused';
  setBusy(true);
  setMessage(isPaused ? t('msgResuming') : t('msgPausing'));

  try {
    const response = await sendMessage({
      target: 'background',
      type: isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING'
    });
    applySnapshot(response);
    setMessage(isPaused ? t('msgResumed') : t('msgPaused'));
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onStopClick() {
  setBusy(true);
  setMessage(t('msgStopping'));

  try {
    const response = await sendMessage({ target: 'background', type: 'STOP_RECORDING' });
    applySnapshot(response);
    setMessage(response.session ? t('msgSessionSaved') : (response.message || t('msgNoOngoingRecording')));
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onResetClick() {
  const state = currentStatus.state;
  const confirmText = state === 'recording' || state === 'paused'
    ? t('confirmResetRecording')
    : t('confirmResetDefault');

  if (!confirm(confirmText)) {
    return;
  }

  setBusy(true);
  setMessage(t('msgResetting'));

  try {
    const response = await sendMessage({ target: 'background', type: 'RESET_ALL' });
    applySnapshot(response);
    setMessage(t('msgResetDone'));
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

/* ---------- 录音记录操作 ---------- */

async function onResumeSession(sessionId) {
  setBusy(true);
  setMessage(t('msgResumingSession'));

  try {
    const response = await sendMessage({
      target: 'background',
      type: 'START_RECORDING',
      sessionId
    });
    applySnapshot(response);
    setMessage(response.warning || t('msgSessionResumed'), response.warning ? 'warning' : '');
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onExportSession(sessionId) {
  setBusy(true);
  setMessage(t('msgExporting'));

  try {
    const response = await sendMessage({
      target: 'background',
      type: 'EXPORT_SESSION',
      sessionId
    });
    applySnapshot(response);

    const files = response.files || [];
    if (files.length > 1) {
      setMessage(t('msgSentToDownloadsMulti', [String(files.length)]), 'warning');
    } else if (files.length === 1) {
      setMessage(t('msgSentToDownloads', [files[0].filename]));
    } else {
      setMessage(t('msgNothingToExport'), 'warning');
    }
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onDeleteSession(sessionId) {
  const session = sessions.find((item) => item.id === sessionId);
  const label = session?.title || '';
  const warn = session && !session.lastExportAt
    ? t('confirmDeleteUnexported', [label])
    : t('confirmDeleteSession', [label]);

  if (!confirm(warn)) {
    return;
  }

  setBusy(true);
  setMessage(t('msgDeleting'));

  try {
    const response = await sendMessage({
      target: 'background',
      type: 'DELETE_SESSION',
      sessionId
    });
    applySnapshot(response);
    setMessage(t('msgDeleted'));
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

/* ---------- 设置 ---------- */

async function onAutoSyncChange() {
  const enabled = els.autoSyncToggle.checked;
  try {
    await sendMessage({ target: 'background', type: 'SET_AUTO_SYNC', enabled });
  } catch (error) {
    els.autoSyncToggle.checked = !enabled;
  }
}

async function onKeepWebmChange() {
  const enabled = els.keepWebmToggle.checked;
  try {
    await sendMessage({ target: 'background', type: 'SET_KEEP_WEBM', enabled });
  } catch (error) {
    els.keepWebmToggle.checked = !enabled;
  }
}

async function loadSettings() {
  try {
    const response = await sendMessage({ target: 'background', type: 'GET_SETTINGS' });
    els.autoSyncToggle.checked = response.autoSyncEnabled !== false;
    els.keepWebmToggle.checked = response.keepWebm !== false;
  } catch (error) {
    els.autoSyncToggle.checked = true;
    els.keepWebmToggle.checked = true;
  }
}

/* ---------- 状态同步 ---------- */

async function refreshStatus() {
  try {
    const response = await sendMessage({ target: 'background', type: 'GET_STATUS' });
    applySnapshot(response);
    if (response.notice?.text) {
      setMessage(response.notice.text, response.notice.level || '');
    }
  } catch (error) {
    setMessage(error.message, 'error');
    applySnapshot({ status: { state: 'idle' }, sessions: [], usage: { count: 0, bytes: 0 } });
  }
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error || t('errNoBackendResponse'));
  }

  return response;
}

function applySnapshot(snapshot) {
  currentStatus = snapshot?.status || { state: 'idle' };
  if (Array.isArray(snapshot?.sessions)) {
    sessions = snapshot.sessions.filter(Boolean);
  }
  if (snapshot?.usage) {
    usage = snapshot.usage;
  }
  statusReceivedAt = Date.now();
  render();
}

/* ---------- 渲染 ---------- */

function render() {
  renderStatus();
  renderSessions();
  updateTimer();
}

function renderStatus() {
  const state = currentStatus.state;

  els.statusDot.classList.toggle('recording', state === 'recording');
  els.statusDot.classList.toggle('paused', state === 'paused');
  els.statusDot.classList.toggle('ready', state === 'idle');
  els.tabTitle.textContent = currentStatus.title || '-';
  els.formatText.textContent = exportFormat === 'mp3' ? 'MP3' : formatMime(currentStatus.mimeType);
  els.usageText.textContent = usage.count
    ? t('usageWithCount', [formatBytes(usage.bytes), String(usage.count)])
    : formatBytes(0);

  if (busy) {
    els.startButton.disabled = true;
    els.pauseButton.disabled = true;
    els.stopButton.disabled = true;
    els.resetButton.disabled = true;
    return;
  }

  els.resetButton.disabled = false;

  if (state === 'recording') {
    els.statusText.textContent = t('statusRecording');
    els.startButton.disabled = true;
    els.pauseButton.disabled = false;
    els.pauseButton.textContent = t('btnPause');
    els.stopButton.disabled = false;
  } else if (state === 'paused') {
    els.statusText.textContent = currentStatus.autoPaused ? t('statusAutoPaused') : t('statusPaused');
    els.startButton.disabled = true;
    els.pauseButton.disabled = false;
    els.pauseButton.textContent = t('btnResume');
    els.stopButton.disabled = false;
  } else if (state === 'stopping' || state === 'exporting') {
    els.statusText.textContent = state === 'exporting' ? t('statusExporting') : t('statusStopping');
    els.startButton.disabled = true;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = t('btnPause');
    els.stopButton.disabled = true;
  } else {
    els.statusText.textContent = t('statusIdle');
    els.startButton.disabled = false;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = t('btnPause');
    els.stopButton.disabled = true;
  }
}

function renderSessions() {
  els.sessionsLabel.textContent = sessions.length
    ? t('sessionsHeadingCount', [String(sessions.length)])
    : t('sessionsHeading');
  els.sessionsEmpty.hidden = sessions.length > 0;
  els.sessionList.textContent = '';

  const recordingNow = ['recording', 'paused', 'stopping'].includes(currentStatus.state);

  for (const session of sessions) {
    els.sessionList.append(buildSessionRow(session, recordingNow));
  }
}

function buildSessionRow(session, recordingNow) {
  const isActive = recordingNow && session.id === currentStatus.sessionId;

  const row = document.createElement('div');
  row.className = 'session-item';
  if (isActive) {
    row.classList.add('active');
  }

  const main = document.createElement('div');
  main.className = 'session-main';

  const title = document.createElement('strong');
  title.className = 'session-title';
  title.textContent = session.title || t('sessionUntitled');
  title.title = session.title || '';

  const meta = document.createElement('span');
  meta.className = 'session-meta';
  meta.textContent = buildSessionMeta(session, isActive);

  main.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'session-actions';

  const resumeButton = document.createElement('button');
  resumeButton.type = 'button';
  resumeButton.className = 'chip';
  resumeButton.textContent = t('btnResumeSession');
  resumeButton.disabled = busy || recordingNow;
  resumeButton.addEventListener('click', () => onResumeSession(session.id));

  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'chip primary';
  exportButton.textContent = t('btnExportSession');
  exportButton.disabled = busy || isActive;
  exportButton.addEventListener('click', () => onExportSession(session.id));

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'chip danger';
  deleteButton.textContent = t('btnDeleteSession');
  deleteButton.disabled = busy || isActive;
  deleteButton.addEventListener('click', () => onDeleteSession(session.id));

  actions.append(resumeButton, exportButton, deleteButton);
  row.append(main, actions);
  return row;
}

function buildSessionMeta(session, isActive) {
  const parts = [formatDuration(session.durationMs), formatBytes(session.bytes)];

  if (session.segmentCount > 1) {
    parts.push(t('sessionSegments', [String(session.segmentCount)]));
  }

  if (isActive) {
    parts.push(currentStatus.state === 'paused' ? t('sessionStatePaused') : t('sessionStateRecording'));
  } else if (session.interrupted) {
    parts.push(t('sessionStateInterrupted'));
  } else if (session.state === 'paused') {
    parts.push(t('sessionStatePaused'));
  }

  parts.push(session.lastExportAt ? t('sessionExported') : t('sessionNotExported'));
  return parts.join(' · ');
}

function updateTimer() {
  const elapsedMs = getDisplayElapsedMs();
  els.timer.textContent = elapsedMs ? formatDuration(elapsedMs) : '00:00';
}

function setBusy(isBusy) {
  busy = isBusy;
  render();
}

function setMessage(text, level = '') {
  els.message.textContent = text || '';
  els.message.classList.toggle('error', level === 'error');
  els.message.classList.toggle('warning', level === 'warning');
}

function formatMime(mimeType) {
  if (!mimeType) {
    return 'WebM / Opus';
  }

  if (mimeType.includes('opus')) {
    return 'WebM / Opus';
  }

  return mimeType.replace('audio/', '').toUpperCase();
}

function getDisplayElapsedMs() {
  const baseElapsedMs = currentStatus.elapsedMs || 0;
  if (currentStatus.state === 'recording') {
    return baseElapsedMs + Date.now() - statusReceivedAt;
  }

  return baseElapsedMs;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');

  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
