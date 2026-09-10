// 录音引擎（Offscreen Document）。
//
// Service Worker 用不了 MediaRecorder / AudioContext，所以真正的捕获、编码都在这里。
// v2 起录音不再驻留内存：
//   - MediaRecorder 每秒吐一片 WebM，落地即写 IndexedDB
//   - 同一条流上旁挂一个 AudioWorklet 取 PCM，用 lamejs 实时编成 MP3，约 5 秒写一次
// 两路都以「段（segment）」为单位追加进同一个 session，所以关掉浏览器不丢数据，
// 隔天还能在原会话上接着录。

const t = (key, subs) => I18N.t(key, subs);

const MIME_TYPE_CANDIDATES = [
  'audio/webm; codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm'
];

const CHUNK_INTERVAL_MS = 1000;
const PCM_BATCH_FRAMES = 4096;
const MP3_FLUSH_INTERVAL_MS = 5000;
const MP3_FLUSH_BYTES = 96 * 1024;
const PCM_TAP_MODULE = 'src/pcm-tap.js';

let recorder;
let mediaStream;
let audioContext;
let audioSource;
let analyserNode;
let selectedMimeType = '';
let stoppingPromise;
let recordedDurationMs = 0;
let recordingRunStartedAt = 0;
const objectUrls = new Set();

// 当前会话（正在录的那一个）。停止后置空——数据都在 IndexedDB 里，不留内存镜像。
let session = null;
let segmentIndex = 0;
let webmSeq = 0;
let mp3Seq = 0;
let sessionBytes = { webm: 0, mp3: 0 };
let writeChain = Promise.resolve();
let storageFailed = false;

// 实时 MP3 旁路
let tapNode;
let tapSink;
let mp3Encoder;
let mp3Gate = false;
let mp3Parts = [];
let mp3PendingBytes = 0;
let flushIntervalId;
let resamplePos = 0;
let resampleTail = 0;

const SILENCE_THRESHOLD = 0.01;
const SILENCE_CHECK_INTERVAL_MS = 500;
const SILENCE_CHECKS_BEFORE_PAUSE = 10;
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
  await I18N.ready;
  switch (message.type) {
    case 'GET_STATUS':
      return { ok: true, status: getStatus() };

    case 'START_RECORDING':
      return startRecording(message.payload);

    case 'PAUSE_RECORDING':
      return pauseRecording();

    case 'RESUME_RECORDING':
      return resumeRecording();

    case 'STOP_RECORDING':
      return stopRecording({
        emitAutoStop: false,
        requestId: message.requestId
      });

    case 'BUILD_EXPORT':
      return buildExport(message.sessionId, message.format);

    case 'DOWNLOAD_OBJECT_URL':
      downloadObjectUrl(message.objectUrl, message.filename);
      return { ok: true };

    case 'REVOKE_OBJECT_URL':
      revokeObjectUrl(message.objectUrl);
      return { ok: true };

    case 'FORCE_RESET':
      return forceReset();

    default:
      return { ok: false, error: t('errUnknownCommand') };
  }
}

// payload.session 是 background 从 IndexedDB 取来的会话记录（新建或续录都一样）。
async function startRecording(payload) {
  if ((recorder && recorder.state !== 'inactive') || stoppingPromise) {
    throw new Error(t('errAlreadyRecordingInProgress'));
  }

  session = payload.session;
  segmentIndex = session.segmentCount || 0;
  sessionBytes = { webm: session.webmBytes || 0, mp3: session.mp3Bytes || 0 };
  storageFailed = false;
  writeChain = Promise.resolve();

  // 崩溃后内存计数器已丢失，从盘上倒查真实的最大 seq，避免覆盖既有分片。
  webmSeq = await RecordingStore.nextSeq(RecordingStore.STORE_CHUNKS, session.id);
  mp3Seq = await RecordingStore.nextSeq(RecordingStore.STORE_MP3, session.id);

  initDurationState(session.durationMs || 0);

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

    keepCapturedAudioAudible(mediaStream, session.sampleRate);
    attachUnexpectedEndHandlers(mediaStream);
    await attachMp3Tap();

    selectedMimeType = chooseMimeType();
    recorder = new MediaRecorder(
      mediaStream,
      selectedMimeType ? { mimeType: selectedMimeType } : undefined
    );

    recorder.addEventListener('dataavailable', (event) => {
      if (!event.data?.size || !session) {
        return;
      }
      persistWebmChunk(event.data);
    });

    recorder.start(CHUNK_INTERVAL_MS);
    startDurationRun();
    setMp3Gate(true);
    startFlushLoop();
    window.location.hash = 'recording';

    const started = await RecordingStore.updateSession(session.id, {
      state: 'recording',
      interrupted: false,
      segmentCount: segmentIndex + 1,
      mimeType: recorder.mimeType || selectedMimeType || session.mimeType,
      mp3Unavailable: session.mp3Unavailable,
      tabId: payload.tabId ?? null
    });
    if (started) {
      session = { ...session, ...started };
    }

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
    throw new Error(t('errNoActiveContent'));
  }

  recorder.requestData();
  recorder.pause();
  setMp3Gate(false);
  pauseDurationRun();
  // 暂停仍在同一段内，只把已编码的部分落盘，不 finalize 编码器。
  await flushMp3(false);
  await persistProgress({ state: 'paused' });
  await notifyStatusChanged();
  return { ok: true, status: getStatus() };
}

async function resumeRecording() {
  if (!recorder || recorder.state !== 'paused') {
    throw new Error(t('errNotPaused'));
  }

  recorder.resume();
  startDurationRun();
  setMp3Gate(true);
  await persistProgress({ state: 'recording' });
  await notifyStatusChanged();
  return { ok: true, status: getStatus() };
}

// stop 是异步的：必须等最后一片 dataavailable 落盘之后才能算这一段真正结束，
// 所以沿用 requestId 模式，由 background 挂起的 promise 等我们回消息。
async function stopRecording({ emitAutoStop, requestId }) {
  if (stoppingPromise) {
    if (requestId) {
      stoppingPromise
        .then((response) => notifyStopped(requestId, response.session))
        .catch((error) => notifyStopFailed(requestId, error));
    }

    return stoppingPromise;
  }

  if (!recorder || recorder.state === 'inactive') {
    const response = { ok: true, status: getStatus() };
    if (requestId) {
      notifyStopFailed(requestId, new Error(t('errNoDataToSave')));
    }
    return response;
  }

  const stoppingSession = session;

  stoppingPromise = new Promise((resolve, reject) => {
    const activeRecorder = recorder;

    activeRecorder.addEventListener('stop', async () => {
      try {
        if (recordingRunStartedAt) {
          pauseDurationRun();
        }

        setMp3Gate(false);
        stopFlushLoop();
        await flushMp3(true);
        await writeChain;

        const finalState = emitAutoStop ? 'paused' : 'stopped';
        const saved = await persistProgress({
          state: finalState,
          interrupted: !!emitAutoStop
        });

        await cleanupMedia();
        resetRecordingState();
        window.location.hash = '';
        stoppingPromise = undefined;
        await notifyStatusChanged();

        if (emitAutoStop) {
          chrome.runtime.sendMessage({
            target: 'background',
            type: 'OFFSCREEN_AUTO_STOPPED',
            session: saved || stoppingSession
          }).catch(() => {});
        }

        const response = { ok: true, status: getStatus(), session: saved || stoppingSession };

        if (requestId) {
          notifyStopped(requestId, response.session);
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
      const error = event.error || new Error(t('errMediaRecorder'));
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

/* ---------- 落盘 ---------- */

function persistWebmChunk(blob) {
  if (!session.keepWebm) {
    return;
  }

  const seq = webmSeq++;
  const segment = segmentIndex;
  sessionBytes.webm += blob.size;

  enqueueWrite(() =>
    RecordingStore.appendPart(RecordingStore.STORE_CHUNKS, {
      sessionId: session.id,
      seq,
      segment,
      bytes: blob.size,
      data: blob
    })
  );
}

// 写入串成一条链：保证落盘顺序与产生顺序一致，也让配额/磁盘错误只报一次。
function enqueueWrite(task) {
  writeChain = writeChain.then(task).catch(handleStorageError);
  return writeChain;
}

function handleStorageError(error) {
  if (storageFailed) {
    return;
  }

  storageFailed = true;
  chrome.runtime.sendMessage({
    target: 'background',
    type: 'OFFSCREEN_STORAGE_FAILED',
    error: error?.message || String(error)
  }).catch(() => {});
}

// 把累计时长和字节数写回 session。每 5 秒调一次，崩溃时长度不会归零。
async function persistProgress(patch) {
  if (!session) {
    return null;
  }

  const updated = await RecordingStore.updateSession(session.id, {
    durationMs: getElapsedMs(),
    webmBytes: sessionBytes.webm,
    mp3Bytes: sessionBytes.mp3,
    ...patch
  });

  if (updated) {
    session = { ...session, ...updated };
  }

  return updated;
}

function startFlushLoop() {
  stopFlushLoop();
  flushIntervalId = setInterval(() => {
    flushMp3(false).catch(() => {});
    persistProgress({}).catch(() => {});
  }, MP3_FLUSH_INTERVAL_MS);
}

function stopFlushLoop() {
  if (flushIntervalId) {
    clearInterval(flushIntervalId);
    flushIntervalId = undefined;
  }
}

/* ---------- 实时 MP3 旁路 ---------- */

// 旁路失败不该让整场录音录不成：标记一下继续录 WebM，导出 MP3 时再给明确提示。
async function attachMp3Tap() {
  if (!audioContext || !audioSource) {
    return;
  }

  try {
    if (typeof lamejs === 'undefined' || !lamejs.Mp3Encoder) {
      throw new Error('lamejs unavailable');
    }

    await audioContext.audioWorklet.addModule(chrome.runtime.getURL(PCM_TAP_MODULE));

    tapNode = new AudioWorkletNode(audioContext, 'pcm-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { frames: PCM_BATCH_FRAMES, enabled: false }
    });

    // 本节点不产生声音，但必须接进图里才会被拉取，所以走一个 0 增益的汇点。
    tapSink = audioContext.createGain();
    tapSink.gain.value = 0;
    audioSource.connect(tapNode);
    tapNode.connect(tapSink);
    tapSink.connect(audioContext.destination);

    tapNode.port.onmessage = (event) => onPcmBatch(event.data);

    mp3Gate = false;
    resamplePos = 0;
    resampleTail = 0;
    mp3Parts = [];
    mp3PendingBytes = 0;
    mp3Encoder = new lamejs.Mp3Encoder(1, session.sampleRate, session.mp3Kbps);
  } catch (error) {
    console.warn('[tab-audio-recorder] MP3 tap unavailable:', error);
    mp3Encoder = null;
    session.mp3Unavailable = true;
  }
}

function setMp3Gate(enabled) {
  mp3Gate = enabled && !!mp3Encoder;
  tapNode?.port.postMessage({ type: 'gate', enabled: mp3Gate });
}

function onPcmBatch(batch) {
  if (!mp3Gate || !mp3Encoder) {
    return;
  }

  const samples = resampleToSessionRate(batch);
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    let sample = samples[i];
    if (sample > 1) sample = 1;
    else if (sample < -1) sample = -1;
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  const encoded = mp3Encoder.encodeBuffer(pcm);
  if (encoded.length > 0) {
    mp3Parts.push(encoded);
    mp3PendingBytes += encoded.length;
  }

  if (mp3PendingBytes >= MP3_FLUSH_BYTES) {
    flushMp3(false).catch(() => {});
  }
}

// AudioContext 拿不到会话钉死的采样率时（换了输出设备等）做线性重采样，
// 保证同一个会话里所有 MP3 帧采样率一致——否则跨天续录拼出来的文件会变调。
function resampleToSessionRate(input) {
  const sourceRate = audioContext?.sampleRate || session.sampleRate;
  const targetRate = session.sampleRate;
  if (!input.length || sourceRate === targetRate) {
    return input;
  }

  const ratio = sourceRate / targetRate;
  const out = [];
  let pos = resamplePos;

  while (pos < input.length) {
    const base = Math.floor(pos);
    const frac = pos - base;
    const a = base < 0 ? resampleTail : input[base];
    const b = base + 1 < input.length ? input[base + 1] : input[input.length - 1];
    out.push(a + (b - a) * frac);
    pos += ratio;
  }

  resamplePos = pos - input.length;
  resampleTail = input[input.length - 1];
  return Float32Array.from(out);
}

// final=true 时连 lamejs 的尾帧一起吐出来，收束当前这一段。
async function flushMp3(final) {
  if (!mp3Encoder) {
    return;
  }

  if (final) {
    const tail = mp3Encoder.flush();
    if (tail.length > 0) {
      mp3Parts.push(tail);
      mp3PendingBytes += tail.length;
    }
    mp3Encoder = null;
  }

  if (!mp3Parts.length) {
    return;
  }

  const parts = mp3Parts;
  const bytes = mp3PendingBytes;
  mp3Parts = [];
  mp3PendingBytes = 0;

  const seq = mp3Seq++;
  const segment = segmentIndex;
  sessionBytes.mp3 += bytes;

  await enqueueWrite(() =>
    RecordingStore.appendPart(RecordingStore.STORE_MP3, {
      sessionId: session.id,
      seq,
      segment,
      bytes,
      data: new Blob(parts, { type: 'audio/mpeg' })
    })
  );
}

/* ---------- 音频图 ---------- */

// 不要删：把捕获流接回 destination，用户录音时才还能正常听到标签页声音。
function keepCapturedAudioAudible(stream, sampleRate) {
  audioContext = createAudioContext(sampleRate);
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

function createAudioContext(sampleRate) {
  try {
    return new AudioContext({ sampleRate });
  } catch (error) {
    return new AudioContext();
  }
}

function attachUnexpectedEndHandlers(stream) {
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => {
      if (recorder && recorder.state !== 'inactive') {
        stopRecording({ emitAutoStop: true }).catch(() => {});
      }
    });
  }
}

async function cleanupMedia() {
  stopSilenceDetection();
  stopFlushLoop();

  try {
    tapNode?.port.close();
  } catch (error) {
    // 端口可能已经关了。
  }

  tapNode?.disconnect();
  tapSink?.disconnect();
  audioSource?.disconnect();
  analyserNode?.disconnect();
  tapNode = undefined;
  tapSink = undefined;
  audioSource = undefined;
  analyserNode = undefined;
  mp3Encoder = null;
  mp3Parts = [];
  mp3PendingBytes = 0;

  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;

  if (audioContext) {
    try {
      await audioContext.close();
    } catch (error) {
      // 已经关闭。
    }
    audioContext = undefined;
  }
}

/* ---------- 静音检测 ---------- */

function startSilenceDetection() {
  consecutiveSilentChecks = 0;
  isSilent = false;
  silenceCheckInterval = setInterval(checkSilence, SILENCE_CHECK_INTERVAL_MS);
}

function stopSilenceDetection() {
  if (silenceCheckInterval) {
    clearInterval(silenceCheckInterval);
    silenceCheckInterval = undefined;
  }
  consecutiveSilentChecks = 0;
  isSilent = false;
}

function checkSilence() {
  if (!analyserNode || !recorder) {
    return;
  }

  const buffer = new Float32Array(analyserNode.fftSize);
  analyserNode.getFloatTimeDomainData(buffer);

  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  const rms = Math.sqrt(sum / buffer.length);

  if (rms < SILENCE_THRESHOLD) {
    consecutiveSilentChecks++;
    if (!isSilent && consecutiveSilentChecks >= SILENCE_CHECKS_BEFORE_PAUSE) {
      isSilent = true;
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'OFFSCREEN_AUDIO_SILENCE'
      }).catch(() => {});
    }
  } else {
    consecutiveSilentChecks = 0;
    if (isSilent) {
      isSilent = false;
      chrome.runtime.sendMessage({
        target: 'background',
        type: 'OFFSCREEN_AUDIO_RESUMED'
      }).catch(() => {});
    }
  }
}

/* ---------- 状态 ---------- */

function resetRecordingState() {
  recorder = undefined;
  session = null;
  selectedMimeType = '';
  segmentIndex = 0;
  webmSeq = 0;
  mp3Seq = 0;
  sessionBytes = { webm: 0, mp3: 0 };
  resetDurationState();
}

function initDurationState(baseMs) {
  recordedDurationMs = baseMs;
  recordingRunStartedAt = 0;
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

// 累计真实录制时长，跳过暂停段——不要改成 Date.now() - startedAt。
function getElapsedMs() {
  if (!recordingRunStartedAt) {
    return recordedDurationMs;
  }

  return recordedDurationMs + (Date.now() - recordingRunStartedAt);
}

function chooseMimeType() {
  return MIME_TYPE_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}

function getStatus() {
  if (stoppingPromise) {
    return {
      state: 'stopping',
      ...getSessionMetadata()
    };
  }

  if (!recorder || recorder.state === 'inactive') {
    return { state: 'idle' };
  }

  return {
    state: recorder.state === 'paused' ? 'paused' : 'recording',
    ...getSessionMetadata()
  };
}

function getSessionMetadata() {
  if (!session) {
    return {};
  }

  return {
    sessionId: session.id,
    title: session.title,
    mimeType: recorder?.mimeType || selectedMimeType || session.mimeType,
    elapsedMs: getElapsedMs(),
    tabId: session.tabId,
    segment: segmentIndex
  };
}

async function notifyStatusChanged() {
  try {
    await chrome.runtime.sendMessage({
      target: 'background',
      type: 'OFFSCREEN_STATUS_CHANGED',
      status: getStatus()
    });
  } catch (error) {
    // Service Worker 可能正在重启。
  }
}

function notifyStopFailed(requestId, error) {
  chrome.runtime
    .sendMessage({
      target: 'background',
      type: 'OFFSCREEN_RECORDING_FAILED',
      requestId,
      error: error?.message || String(error)
    })
    .catch(() => {});
}

function notifyStopped(requestId, stoppedSession) {
  chrome.runtime
    .sendMessage({
      target: 'background',
      type: 'OFFSCREEN_RECORDING_STOPPED',
      requestId,
      session: stoppedSession
    })
    .catch(() => {});
}

async function forceReset() {
  try {
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  } catch (error) {
    // 忽略：本来就是强制复位。
  }

  setMp3Gate(false);
  stopFlushLoop();

  try {
    await flushMp3(true);
    await writeChain;
    if (session) {
      await persistProgress({ state: 'paused', interrupted: true });
    }
  } catch (error) {
    // 复位时落盘失败也要继续把状态清干净。
  }

  await cleanupMedia();
  resetRecordingState();
  stoppingPromise = undefined;
  window.location.hash = '';

  for (const url of Array.from(objectUrls)) {
    URL.revokeObjectURL(url);
  }
  objectUrls.clear();

  await notifyStatusChanged();
  return { ok: true, status: getStatus() };
}

/* ---------- 导出 ---------- */

// 导出只是把已经落盘的分片按序拼起来：MP3 是录制时就编好的，所以秒出。
// 单段会话可以原样导出无损 WebM；多段会话的 WebM 各带独立文件头，
// 直接拼接播放器只认第一段，因此按段拆成多个文件，单文件请走 MP3。
async function buildExport(sessionId, format) {
  const target = await RecordingStore.getSession(sessionId);
  if (!target) {
    throw new Error(t('errSessionMissing'));
  }

  const base = (target.filename || 'tab-audio.webm').replace(/\.[^.]+$/, '');

  if (format === 'mp3') {
    const parts = await RecordingStore.readParts(RecordingStore.STORE_MP3, sessionId);
    if (!parts.length) {
      throw new Error(target.mp3Unavailable ? t('errMp3Unavailable') : t('errSessionEmpty'));
    }

    const blob = new Blob(parts.map((part) => part.data), { type: 'audio/mpeg' });
    return {
      ok: true,
      files: [trackFile(blob, `${base}.mp3`, 'audio/mpeg')]
    };
  }

  if (!target.keepWebm) {
    throw new Error(t('errWebmNotKept'));
  }

  const parts = await RecordingStore.readParts(RecordingStore.STORE_CHUNKS, sessionId);
  if (!parts.length) {
    throw new Error(t('errSessionEmpty'));
  }

  const bySegment = new Map();
  for (const part of parts) {
    const segment = part.segment || 0;
    if (!bySegment.has(segment)) {
      bySegment.set(segment, []);
    }
    bySegment.get(segment).push(part.data);
  }

  const segments = Array.from(bySegment.keys()).sort((a, b) => a - b);
  const mimeType = target.mimeType || 'audio/webm';
  const files = segments.map((segment, index) => {
    const blob = new Blob(bySegment.get(segment), { type: mimeType });
    const suffix = segments.length > 1 ? `_${String(index + 1).padStart(2, '0')}` : '';
    return trackFile(blob, `${base}${suffix}.webm`, mimeType);
  });

  return { ok: true, files };
}

function trackFile(blob, filename, mimeType) {
  const objectUrl = URL.createObjectURL(blob);
  objectUrls.add(objectUrl);
  return { objectUrl, filename, mimeType, size: blob.size };
}

// chrome.downloads 在部分 MV3 场景下会拒绝 blob: URL，这是兜底通道，不要删。
function downloadObjectUrl(objectUrl, filename) {
  if (!objectUrl || !objectUrls.has(objectUrl)) {
    throw new Error(t('errDownloadUrlExpired'));
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
