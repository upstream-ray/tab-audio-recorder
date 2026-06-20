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
      renderStatus(currentStatus);
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
}

const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  timer: document.getElementById('timer'),
  tabTitle: document.getElementById('tabTitle'),
  formatText: document.getElementById('formatText'),
  fileState: document.getElementById('fileState'),
  startButton: document.getElementById('startButton'),
  pauseButton: document.getElementById('pauseButton'),
  stopButton: document.getElementById('stopButton'),
  exportButton: document.getElementById('exportButton'),
  resetButton: document.getElementById('resetButton'),
  message: document.getElementById('message'),
  autoSyncToggle: document.getElementById('autoSyncToggle')
};

let currentStatus = { state: 'idle' };
let statusReceivedAt = Date.now();
let timerId;

document.addEventListener('DOMContentLoaded', async () => {
  await I18N.ready;
  await applyStoredTheme();
  localizeStatic();
  setupSettings();

  els.startButton.addEventListener('click', onStartClick);
  els.pauseButton.addEventListener('click', onPauseClick);
  els.stopButton.addEventListener('click', onStopClick);
  els.exportButton.addEventListener('click', onExportClick);
  els.resetButton.addEventListener('click', onResetClick);
  els.autoSyncToggle.addEventListener('change', onAutoSyncChange);

  loadAutoSyncState();

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.target === 'popup' && message?.type === 'STATUS_CHANGED') {
      renderStatus(message.status || { state: 'idle' });
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

async function onStartClick() {
  setBusy(true);
  setMessage(t('msgStarting'));

  try {
    const response = await sendMessage({ target: 'background', type: 'START_RECORDING' });
    renderStatus(response.status);

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
    renderStatus(response.status);
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
    renderStatus(response.status);

    if (response.recording?.filename) {
      setMessage(t('msgRecordingSaved', [response.recording.filename]));
    } else {
      setMessage(response.message || t('msgNoOngoingRecording'));
    }
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onExportClick() {
  setBusy(true);
  setMessage(t('msgExporting'));

  try {
    const response = await sendMessage({ target: 'background', type: 'EXPORT_RECORDING' });
    renderStatus(response.status);

    if (response.recording?.filename) {
      setMessage(t('msgSentToDownloads', [response.recording.filename]));
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

async function onResetClick() {
  const state = currentStatus.state;
  let confirmText = t('confirmResetDefault');
  if (state === 'recording' || state === 'paused') {
    confirmText = t('confirmResetRecording');
  } else if (state === 'ready') {
    confirmText = t('confirmResetReady');
  }

  if (!confirm(confirmText)) {
    return;
  }

  setBusy(true);
  setMessage(t('msgResetting'));

  try {
    const response = await sendMessage({ target: 'background', type: 'RESET_ALL' });
    renderStatus(response.status);
    setMessage(t('msgResetDone'));
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onAutoSyncChange() {
  const enabled = els.autoSyncToggle.checked;
  try {
    await sendMessage({ target: 'background', type: 'SET_AUTO_SYNC', enabled });
  } catch (error) {
    els.autoSyncToggle.checked = !enabled;
  }
}

async function loadAutoSyncState() {
  try {
    const response = await sendMessage({ target: 'background', type: 'GET_AUTO_SYNC' });
    els.autoSyncToggle.checked = response.autoSyncEnabled !== false;
  } catch (error) {
    els.autoSyncToggle.checked = true;
  }
}

async function refreshStatus() {
  try {
    const response = await sendMessage({ target: 'background', type: 'GET_STATUS' });
    renderStatus(response.status);
    if (response.notice?.text) {
      setMessage(response.notice.text, response.notice.level || '');
    }
  } catch (error) {
    setMessage(error.message, 'error');
    renderStatus({ state: 'idle' });
  }
}

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);

  if (!response?.ok) {
    throw new Error(response?.error || t('errNoBackendResponse'));
  }

  return response;
}

function renderStatus(status) {
  currentStatus = status || { state: 'idle' };
  statusReceivedAt = Date.now();

  els.statusDot.classList.toggle('recording', currentStatus.state === 'recording');
  els.statusDot.classList.toggle('paused', currentStatus.state === 'paused');
  els.statusDot.classList.toggle('ready', currentStatus.state === 'idle' || currentStatus.state === 'ready');
  els.tabTitle.textContent = currentStatus.title || '-';
  els.formatText.textContent = formatMime(currentStatus.mimeType);
  els.fileState.textContent = getFileStateText(currentStatus);

  if (currentStatus.state === 'recording') {
    els.statusText.textContent = t('statusRecording');
    els.startButton.disabled = true;
    els.pauseButton.disabled = false;
    els.pauseButton.textContent = t('btnPause');
    els.stopButton.disabled = false;
    els.exportButton.disabled = true;
    els.resetButton.disabled = false;
  } else if (currentStatus.state === 'paused') {
    els.statusText.textContent = currentStatus.autoPaused ? t('statusAutoPaused') : t('statusPaused');
    els.startButton.disabled = true;
    els.pauseButton.disabled = false;
    els.pauseButton.textContent = t('btnResume');
    els.stopButton.disabled = false;
    els.exportButton.disabled = true;
    els.resetButton.disabled = false;
  } else if (currentStatus.state === 'ready') {
    els.statusText.textContent = t('statusReadyToExport');
    els.startButton.disabled = true;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = t('btnPause');
    els.stopButton.disabled = true;
    els.exportButton.disabled = false;
    els.resetButton.disabled = false;
  } else if (currentStatus.state === 'stopping' || currentStatus.state === 'saving' || currentStatus.state === 'exporting') {
    els.statusText.textContent = currentStatus.state === 'exporting' ? t('statusExporting') : t('statusStopping');
    els.startButton.disabled = true;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = t('btnPause');
    els.stopButton.disabled = true;
    els.exportButton.disabled = true;
    els.resetButton.disabled = false;
  } else {
    els.statusText.textContent = t('statusIdle');
    els.startButton.disabled = false;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = t('btnPause');
    els.stopButton.disabled = true;
    els.exportButton.disabled = true;
    els.resetButton.disabled = false;
  }

  updateTimer();
}

function updateTimer() {
  const elapsedMs = getDisplayElapsedMs();
  if (!elapsedMs) {
    els.timer.textContent = '00:00';
    return;
  }

  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  const pad = (value) => String(value).padStart(2, '0');

  els.timer.textContent = hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

function setBusy(isBusy) {
  if (isBusy) {
    els.startButton.disabled = true;
    els.pauseButton.disabled = true;
    els.stopButton.disabled = true;
    els.exportButton.disabled = true;
    els.resetButton.disabled = true;
    return;
  }

  renderStatus(currentStatus);
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
  const baseElapsedMs = currentStatus.elapsedMs || currentStatus.durationMs || 0;
  if (currentStatus.state === 'recording') {
    return baseElapsedMs + Date.now() - statusReceivedAt;
  }

  return baseElapsedMs;
}

function getFileStateText(status) {
  if (status.state === 'recording' || status.state === 'paused') {
    return status.sizeEstimate ? t('fileStateBuffered', [formatBytes(status.sizeEstimate)]) : t('statusRecording');
  }

  if (status.state === 'ready') {
    return status.size ? t('fileStateReadySized', [formatBytes(status.size)]) : t('statusReadyToExport');
  }

  if (status.state === 'exporting') {
    return t('statusExporting');
  }

  return t('fileStateNone');
}

function formatBytes(bytes) {
  if (!bytes) {
    return '0 B';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
