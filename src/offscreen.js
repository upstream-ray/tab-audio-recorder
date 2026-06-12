const MIME_TYPE_CANDIDATES = [
  'audio/webm; codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm'
];

let recorder;
let mediaStream;
let audioContext;
let audioSource;
let analyserNode;
let chunks = [];
let totalBytes = 0;
let selectedMimeType = '';
let currentRecording = null;
let completedRecording = null;
let stoppingPromise;
let recordedDurationMs = 0;
let recordingRunStartedAt = 0;
const objectUrls = new Set();

const SILENCE_THRESHOLD = 0.01;
const SILENCE_CHECK_INTERVAL_MS = 500;
const SILENCE_CHECKS_BEFORE_PAUSE = 3;
let silenceCheckInterval;
let consecutiveSilentChecks = 0;
let isSilent = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') {
    return false;
  }

  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      sendResponse({ ok: false, error: error?.message || String(error) });
    });

  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'GET_STATUS':
      return {
        ok: true,
        status: getStatus(),
        recording: completedRecording
      };

    case 'START_RECORDING':
      return startRecording(message.payload);

    case 'PAUSE_RECORDING':
      return pauseRecording();

    case 'RESUME_RECORDING':
      return resumeRecording();

    case 'STOP_RECORDING':
      stopRecording({
        emitAutoStop: false,
        requestId: message.requestId
      }).catch((error) => {
        notifyStopFailed(message.requestId, error);
      });
      return { ok: true, status: getStatus() };

    case 'DOWNLOAD_OBJECT_URL':
      downloadObjectUrl(message.objectUrl, message.filename);
      return { ok: true };

    case 'GET_READY_RECORDING':
      return { ok: true, recording: completedRecording };

    case 'CLEAR_READY_RECORDING':
      clearCompletedRecording(message.objectUrl);
      notifyStatusChanged();
      return { ok: true };

    case 'REVOKE_OBJECT_URL':
      revokeObjectUrl(message.objectUrl);
      return { ok: true };

    case 'FORCE_RESET':
      await forceReset();
      return { ok: true };

    default:
      return { ok: false, error: 'offscreen 收到未知指令。' };
  }
}

async function startRecording(payload) {
  if ((recorder && recorder.state !== 'inactive') || stoppingPromise) {
    throw new Error('录音已经在进行中。');
  }

  if (completedRecording) {
    throw new Error('已有一段录音待导出。请先导出后再开始新的录音。');
  }

  resetRecordingState();
  resetDurationState();

  currentRecording = {
    tabId: payload.tabId,
    title: payload.title,
    pageUrl: payload.pageUrl,
    filename: payload.filename,
    startedAt: payload.startedAt
  };

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: payload.streamId
        }
      },
      video: false
    });

    keepCapturedAudioAudible(mediaStream);
    attachUnexpectedEndHandlers(mediaStream);

    selectedMimeType = chooseMimeType();
    recorder = new MediaRecorder(
      mediaStream,
      selectedMimeType ? { mimeType: selectedMimeType } : undefined
    );

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) {
        chunks.push(event.data);
        totalBytes += event.data.size;
      }
    });

    recorder.start(1000);
    startDurationRun();
    window.location.hash = 'recording';

    await notifyStatusChanged();
    return { ok: true, status: getStatus() };
  } catch (error) {
    await cleanupMedia();
    resetRecordingState();
    window.location.hash = '';
    throw error;
  }
}

async function pauseRecording() {
  if (!recorder || recorder.state !== 'recording') {
    throw new Error('当前没有正在录制的内容。');
  }

  recorder.requestData();
  recorder.pause();
  pauseDurationRun();
  await notifyStatusChanged();
  return { ok: true, status: getStatus() };
}

async function resumeRecording() {
  if (!recorder || recorder.state !== 'paused') {
    throw new Error('当前录音没有处于暂停状态。');
  }

  recorder.resume();
  startDurationRun();
  await notifyStatusChanged();
  return { ok: true, status: getStatus() };
}

async function stopRecording({ emitAutoStop, requestId }) {
  if (stoppingPromise) {
    if (requestId) {
      stoppingPromise
        .then((response) => notifyStopped(requestId, response.recording))
        .catch((error) => notifyStopFailed(requestId, error));
    }

    return stoppingPromise;
  }

  if (!recorder || recorder.state === 'inactive') {
    const response = { ok: true, status: getStatus() };
    if (requestId) {
      notifyStopFailed(requestId, new Error('录音已经停止，未找到可保存的录音数据。'));
    }
    return response;
  }

  stoppingPromise = new Promise((resolve, reject) => {
    const activeRecorder = recorder;

    activeRecorder.addEventListener('stop', async () => {
      try {
        if (recordingRunStartedAt) {
          pauseDurationRun();
        }

        const mimeType = activeRecorder.mimeType || selectedMimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.add(objectUrl);

        const recording = {
          objectUrl,
          filename: currentRecording.filename,
          mimeType,
          size: blob.size,
          durationMs: getElapsedMs(),
          startedAt: currentRecording.startedAt,
          finishedAt: new Date().toISOString(),
          title: currentRecording.title,
          pageUrl: currentRecording.pageUrl,
          tabId: currentRecording.tabId
        };

        completedRecording = recording;
        await cleanupMedia();
        resetRecordingState();
        resetDurationState();
        window.location.hash = '';
        stoppingPromise = undefined;
        await notifyStatusChanged();

        if (emitAutoStop) {
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'OFFSCREEN_AUTO_STOPPED',
            recording
          }).catch(() => {});
        }

        const response = { ok: true, status: getStatus(), recording };

        if (requestId) {
          notifyStopped(requestId, recording);
        }

        resolve(response);
      } catch (error) {
        stoppingPromise = undefined;
        if (requestId) {
          notifyStopFailed(requestId, error);
        }
        reject(error);
      }
    }, { once: true });

    activeRecorder.addEventListener('error', (event) => {
      stoppingPromise = undefined;
      const error = event.error || new Error('MediaRecorder 出错。');
      if (requestId) {
        notifyStopFailed(requestId, error);
      }
      reject(error);
    }, { once: true });

    if (activeRecorder.state !== 'inactive') {
      activeRecorder.requestData();
      activeRecorder.stop();
    }

    mediaStream?.getTracks().forEach((track) => track.stop());
  });

  await notifyStatusChanged();
  return stoppingPromise;
}

function keepCapturedAudioAudible(stream) {
  audioContext = new AudioContext();
  audioSource = audioContext.createMediaStreamSource(stream);
  audioSource.connect(audioContext.destination);

  analyserNode = audioContext.createAnalyser();
  analyserNode.fftSize = 2048;
  audioSource.connect(analyserNode);
  startSilenceDetection();

  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}

function attachUnexpectedEndHandlers(stream) {
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => {
      if (recorder && recorder.state !== 'inactive' && !stoppingPromise) {
        stopRecording({ emitAutoStop: true });
      }
    }, { once: true });
  }
}

async function cleanupMedia() {
  stopSilenceDetection();

  if (analyserNode) {
    analyserNode.disconnect();
    analyserNode = undefined;
  }

  if (audioSource) {
    audioSource.disconnect();
    audioSource = undefined;
  }

  if (audioContext && audioContext.state !== 'closed') {
    await audioContext.close().catch(() => {});
    audioContext = undefined;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = undefined;
  }
}

function startSilenceDetection() {
  if (silenceCheckInterval) return;
  consecutiveSilentChecks = 0;
  isSilent = false;
  silenceCheckInterval = setInterval(checkSilence, SILENCE_CHECK_INTERVAL_MS);
}

function stopSilenceDetection() {
  if (silenceCheckInterval) {
    clearInterval(silenceCheckInterval);
    silenceCheckInterval = null;
  }
  consecutiveSilentChecks = 0;
  isSilent = false;
}

function checkSilence() {
  if (!analyserNode || !recorder || recorder.state === 'inactive') {
    return;
  }

  const dataArray = new Float32Array(analyserNode.fftSize);
  analyserNode.getFloatTimeDomainData(dataArray);

  let peak = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const abs = Math.abs(dataArray[i]);
    if (abs > peak) peak = abs;
  }

  const nowSilent = peak < SILENCE_THRESHOLD;

  if (nowSilent) {
    consecutiveSilentChecks++;
  } else {
    consecutiveSilentChecks = 0;
  }

  const detectedSilent = consecutiveSilentChecks >= SILENCE_CHECKS_BEFORE_PAUSE;

  if (detectedSilent && !isSilent) {
    isSilent = true;
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'OFFSCREEN_AUDIO_SILENCE'
    }).catch(() => {});
  } else if (!nowSilent && isSilent) {
    isSilent = false;
    chrome.runtime.sendMessage({
      target: 'background',
      type: 'OFFSCREEN_AUDIO_RESUMED'
    }).catch(() => {});
  }
}

function resetRecordingState() {
  recorder = undefined;
  chunks = [];
  totalBytes = 0;
  selectedMimeType = '';
  currentRecording = null;
}

function resetDurationState() {
  recordedDurationMs = 0;
  recordingRunStartedAt = 0;
}

function startDurationRun() {
  recordingRunStartedAt = Date.now();
}

function pauseDurationRun() {
  if (!recordingRunStartedAt) {
    return;
  }

  recordedDurationMs += Date.now() - recordingRunStartedAt;
  recordingRunStartedAt = 0;
}

function getElapsedMs() {
  if (recordingRunStartedAt) {
    return recordedDurationMs + Date.now() - recordingRunStartedAt;
  }

  return recordedDurationMs;
}

function chooseMimeType() {
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function getStatus() {
  if (stoppingPromise) {
    return {
      state: 'stopping',
      ...getRecordingMetadata()
    };
  }

  if (recorder?.state === 'recording') {
    return {
      state: 'recording',
      ...getRecordingMetadata()
    };
  }

  if (recorder?.state === 'paused') {
    return {
      state: 'paused',
      ...getRecordingMetadata()
    };
  }

  if (completedRecording) {
    return {
      state: 'ready',
      title: completedRecording.title,
      filename: completedRecording.filename,
      mimeType: completedRecording.mimeType,
      size: completedRecording.size,
      durationMs: completedRecording.durationMs,
      elapsedMs: completedRecording.durationMs,
      startedAt: completedRecording.startedAt,
      finishedAt: completedRecording.finishedAt,
      tabId: completedRecording.tabId
    };
  }

  return { state: 'idle' };
}

function getRecordingMetadata() {
  return {
    title: currentRecording?.title || '',
    filename: currentRecording?.filename || '',
    startedAt: currentRecording?.startedAt || '',
    mimeType: recorder?.mimeType || selectedMimeType || 'audio/webm',
    sizeEstimate: totalBytes,
    elapsedMs: getElapsedMs(),
    tabId: currentRecording?.tabId
  };
}

async function notifyStatusChanged() {
  await chrome.runtime.sendMessage({
    target: 'background',
    type: 'OFFSCREEN_STATUS_CHANGED',
    status: getStatus()
  }).catch(() => {});
}

function notifyStopFailed(requestId, error) {
  if (!requestId) {
    return;
  }

  chrome.runtime.sendMessage({
    target: 'background',
    type: 'OFFSCREEN_RECORDING_FAILED',
    requestId,
    error: error?.message || String(error)
  }).catch(() => {});
}

function notifyStopped(requestId, recording) {
  chrome.runtime.sendMessage({
    target: 'background',
    type: 'OFFSCREEN_RECORDING_STOPPED',
    requestId,
    recording
  }).catch(() => {});
}

async function forceReset() {
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop();
    } catch (error) {
      // Recorder may already be in a terminal state.
    }
  }

  await cleanupMedia();
  resetRecordingState();
  resetDurationState();

  for (const url of Array.from(objectUrls)) {
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      // Ignore.
    }
  }
  objectUrls.clear();

  completedRecording = null;
  stoppingPromise = undefined;
  window.location.hash = '';

  await notifyStatusChanged();
}

function clearCompletedRecording(objectUrl) {
  if (!completedRecording) {
    return;
  }

  if (!objectUrl || completedRecording.objectUrl === objectUrl) {
    completedRecording = null;
  }
}

function downloadObjectUrl(objectUrl, filename) {
  if (!objectUrl || !objectUrls.has(objectUrl)) {
    throw new Error('录音下载地址已经失效。');
  }

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename || 'tab-audio.webm';
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function revokeObjectUrl(objectUrl) {
  if (!objectUrl || !objectUrls.has(objectUrl)) {
    return;
  }

  clearCompletedRecording(objectUrl);
  URL.revokeObjectURL(objectUrl);
  objectUrls.delete(objectUrl);
}
