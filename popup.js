const els = {
  statusDot: document.getElementById('statusDot'),
  statusText: document.getElementById('statusText'),
  timer: document.getElementById('timer'),
  tabTitle: document.getElementById('tabTitle'),
  formatText: document.getElementById('formatText'),
  startButton: document.getElementById('startButton'),
  stopButton: document.getElementById('stopButton'),
  message: document.getElementById('message')
};

let currentStatus = { state: 'idle' };
let timerId;

document.addEventListener('DOMContentLoaded', () => {
  els.startButton.addEventListener('click', onStartClick);
  els.stopButton.addEventListener('click', onStopClick);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'STATUS_CHANGED') {
      renderStatus(message.status || { state: 'idle' });
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

async function onStopClick() {
  setBusy(true);
  setMessage('正在停止并准备下载...');

  try {
    const response = await sendMessage({ target: 'background', type: 'STOP_RECORDING' });
    renderStatus(response.status);

    if (response.recording?.filename) {
      setMessage(`已发送到浏览器下载：${response.recording.filename}`);
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

async function refreshStatus() {
  try {
    const response = await sendMessage({ target: 'background', type: 'GET_STATUS' });
    renderStatus(response.status);
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

  els.statusDot.classList.toggle('recording', currentStatus.state === 'recording');
  els.statusDot.classList.toggle('ready', currentStatus.state === 'idle');
  els.tabTitle.textContent = currentStatus.title || '-';
  els.formatText.textContent = formatMime(currentStatus.mimeType);

  if (currentStatus.state === 'recording') {
    els.statusText.textContent = '录制中';
    els.startButton.disabled = true;
    els.stopButton.disabled = false;
  } else if (currentStatus.state === 'stopping' || currentStatus.state === 'saving') {
    els.statusText.textContent = '正在保存';
    els.startButton.disabled = true;
    els.stopButton.disabled = true;
  } else {
    els.statusText.textContent = '待机';
    els.startButton.disabled = false;
    els.stopButton.disabled = true;
  }

  updateTimer();
}

function updateTimer() {
  if (currentStatus.state !== 'recording' || !currentStatus.startedAt) {
    els.timer.textContent = '00:00';
    return;
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(currentStatus.startedAt)) / 1000)
  );

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
    els.stopButton.disabled = true;
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
