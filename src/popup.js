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

document.addEventListener('DOMContentLoaded', () => {
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
  setMessage('正在启动录音...');

  try {
    const response = await sendMessage({ target: 'background', type: 'START_RECORDING' });
    renderStatus(response.status);

    if (response.warning) {
      setMessage(response.warning, 'warning');
    } else {
      setMessage('录音已开始。关闭弹窗不会中断录音。');
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
  setMessage(isPaused ? '正在继续录音...' : '正在暂停录音...');

  try {
    const response = await sendMessage({
      target: 'background',
      type: isPaused ? 'RESUME_RECORDING' : 'PAUSE_RECORDING'
    });
    renderStatus(response.status);
    setMessage(isPaused ? '已继续录音。' : '录音已暂停，页面声音仍会继续播放。');
  } catch (error) {
    setMessage(error.message, 'error');
    await refreshStatus();
  } finally {
    setBusy(false);
  }
}

async function onStopClick() {
  setBusy(true);
  setMessage('正在停止录音...');

  try {
    const response = await sendMessage({ target: 'background', type: 'STOP_RECORDING' });
    renderStatus(response.status);

    if (response.recording?.filename) {
      setMessage(`录音已生成：${response.recording.filename}`);
    } else {
      setMessage(response.message || '当前没有正在进行的录音。');
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
  setMessage('正在导出录音文件...');

  try {
    const response = await sendMessage({ target: 'background', type: 'EXPORT_RECORDING' });
    renderStatus(response.status);

    if (response.recording?.filename) {
      setMessage(`已发送到浏览器下载：${response.recording.filename}`);
    } else {
      setMessage('没有可导出的录音文件。', 'warning');
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
  let confirmText = '确定要重置吗？将清理所有状态，回到待机。';
  if (state === 'recording' || state === 'paused') {
    confirmText = '当前正在录制，重置会停止并丢弃这段录音。确定继续吗？';
  } else if (state === 'ready') {
    confirmText = '确定要丢弃这段尚未导出的录音吗？此操作无法撤销。';
  }

  if (!confirm(confirmText)) {
    return;
  }

  setBusy(true);
  setMessage('正在重置...');

  try {
    const response = await sendMessage({ target: 'background', type: 'RESET_ALL' });
    renderStatus(response.status);
    setMessage('已重置，可以开始新的录制。');
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
    throw new Error(response?.error || '插件后台没有返回有效响应。');
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
    els.statusText.textContent = '录制中';
    els.startButton.disabled = true;
    els.pauseButton.disabled = false;
    els.pauseButton.textContent = '暂停录制';
    els.stopButton.disabled = false;
    els.exportButton.disabled = true;
    els.resetButton.disabled = false;
  } else if (currentStatus.state === 'paused') {
    els.statusText.textContent = currentStatus.autoPaused ? '已自动暂停' : '已暂停';
    els.startButton.disabled = true;
    els.pauseButton.disabled = false;
    els.pauseButton.textContent = '继续录制';
    els.stopButton.disabled = false;
    els.exportButton.disabled = true;
    els.resetButton.disabled = false;
  } else if (currentStatus.state === 'ready') {
    els.statusText.textContent = '待导出';
    els.startButton.disabled = true;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = '暂停录制';
    els.stopButton.disabled = true;
    els.exportButton.disabled = false;
    els.resetButton.disabled = false;
  } else if (currentStatus.state === 'stopping' || currentStatus.state === 'saving' || currentStatus.state === 'exporting') {
    els.statusText.textContent = currentStatus.state === 'exporting' ? '正在导出' : '正在停止';
    els.startButton.disabled = true;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = '暂停录制';
    els.stopButton.disabled = true;
    els.exportButton.disabled = true;
    els.resetButton.disabled = false;
  } else {
    els.statusText.textContent = '待机';
    els.startButton.disabled = false;
    els.pauseButton.disabled = true;
    els.pauseButton.textContent = '暂停录制';
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
    return status.sizeEstimate ? `缓存 ${formatBytes(status.sizeEstimate)}` : '录制中';
  }

  if (status.state === 'ready') {
    return status.size ? `待导出 ${formatBytes(status.size)}` : '待导出';
  }

  if (status.state === 'exporting') {
    return '正在导出';
  }

  return '未生成';
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
