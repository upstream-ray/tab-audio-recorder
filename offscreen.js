const MIME_TYPE_CANDIDATES = [
  'audio/webm; codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm'
];

let recorder;
let mediaStream;
let audioContext;
let audioSource;
let chunks = [];
let totalBytes = 0;
let selectedMimeType = '';
let currentRecording = null;
let stoppingPromise;
const objectUrls = new Set();

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
      return { ok: true, status: getStatus() };

    case 'START_RECORDING':
      return startRecording(message.payload);

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

    case 'REVOKE_OBJECT_URL':
      revokeObjectUrl(message.objectUrl);
      return { ok: true };

    default:
      return { ok: false, error: 'offscreen 收到未知指令。' };
  }
}

async function startRecording(payload) {
  if (recorder?.state === 'recording' || stoppingPromise) {
    throw new Error('录音已经在进行中。');
  }

  resetRecordingState();

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

async function stopRecording({ emitAutoStop, requestId }) {
  if (stoppingPromise) {
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
        const mimeType = activeRecorder.mimeType || selectedMimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.add(objectUrl);

        const recording = {
          objectUrl,
          filename: currentRecording.filename,
          mimeType,
          size: blob.size,
          durationMs: Date.now() - Date.parse(currentRecording.startedAt),
          startedAt: currentRecording.startedAt,
          finishedAt: new Date().toISOString(),
          title: currentRecording.title,
          pageUrl: currentRecording.pageUrl,
          tabId: currentRecording.tabId
        };

        await cleanupMedia();
        resetRecordingState();
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
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'OFFSCREEN_RECORDING_STOPPED',
            requestId,
            recording
          }).catch(() => {});
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

    if (activeRecorder.state === 'recording') {
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

  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }
}

function attachUnexpectedEndHandlers(stream) {
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => {
      if (recorder?.state === 'recording') {
        stopRecording({ emitAutoStop: true });
      }
    }, { once: true });
  }
}

async function cleanupMedia() {
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

function resetRecordingState() {
  recorder = undefined;
  chunks = [];
  totalBytes = 0;
  selectedMimeType = '';
  currentRecording = null;
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

  return { state: 'idle' };
}

function getRecordingMetadata() {
  return {
    title: currentRecording?.title || '',
    filename: currentRecording?.filename || '',
    startedAt: currentRecording?.startedAt || '',
    mimeType: recorder?.mimeType || selectedMimeType || 'audio/webm',
    sizeEstimate: totalBytes,
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

  URL.revokeObjectURL(objectUrl);
  objectUrls.delete(objectUrl);
}
