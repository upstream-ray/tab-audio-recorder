// 录音持久化层（IndexedDB）。
//
// 录音不再驻留内存：MediaRecorder 的每个分片、实时编码出来的每块 MP3 帧，
// 都在产生的当下就写进这里。浏览器崩溃或被直接关掉，已落盘的部分不会丢。
//
// 三个 object store：
//   sessions  一次逻辑录音（可跨天、跨多段）
//   chunks    WebM 分片，keyPath [sessionId, seq]
//   mp3       实时编码的 MP3 帧块，keyPath [sessionId, seq]
//
// 「段（segment）」= 一次连续的 MediaRecorder 运行。暂停/恢复仍属同一段；
// 浏览器重启后继续录制会新开一段，追加进同一个 session。
//
// 本文件是上下文无关的：popup / offscreen 通过 <script src="store.js"> 加载，
// background（service worker）通过 importScripts(chrome.runtime.getURL(...)) 加载。
(function () {
  const DB_NAME = 'tab-audio-recorder';
  const DB_VERSION = 1;
  const STORE_SESSIONS = 'sessions';
  const STORE_CHUNKS = 'chunks';
  const STORE_MP3 = 'mp3';
  const MAX_SEQ = Number.MAX_SAFE_INTEGER;

  let dbPromise;

  function openDb() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          db.createObjectStore(STORE_CHUNKS, { keyPath: ['sessionId', 'seq'] });
        }
        if (!db.objectStoreNames.contains(STORE_MP3)) {
          db.createObjectStore(STORE_MP3, { keyPath: ['sessionId', 'seq'] });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  // 把单个 IDBRequest 包成 promise。事务在 Chrome 里能跨原生 microtask 存活，
  // 所以 run() 的回调里可以放心 await 这些 promise。
  function req(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function run(storeNames, mode, fn) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeNames, mode);
      let result;
      let failed = false;

      transaction.oncomplete = () => {
        if (!failed) resolve(result);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));

      Promise.resolve(fn(transaction))
        .then((value) => {
          result = value;
        })
        .catch((error) => {
          failed = true;
          try {
            transaction.abort();
          } catch (abortError) {
            // 事务可能已经结束。
          }
          reject(error);
        });
    });
  }

  function sessionRange(sessionId) {
    return IDBKeyRange.bound([sessionId, -1], [sessionId, MAX_SEQ]);
  }

  function createId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return `s_${crypto.randomUUID()}`;
    }
    return `s_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  async function createSession(meta) {
    const now = new Date().toISOString();
    const session = {
      id: createId(),
      title: meta?.title || '',
      pageUrl: meta?.pageUrl || '',
      filename: meta?.filename || '',
      tabId: meta?.tabId ?? null,
      mimeType: meta?.mimeType || 'audio/webm',
      sampleRate: meta?.sampleRate || 48000,
      mp3Kbps: meta?.mp3Kbps || 128,
      keepWebm: meta?.keepWebm !== false,
      mp3Unavailable: false,
      state: 'recording',
      durationMs: 0,
      segmentCount: 0,
      webmBytes: 0,
      mp3Bytes: 0,
      createdAt: now,
      updatedAt: now,
      lastExportAt: '',
      lastExportName: ''
    };

    await run([STORE_SESSIONS], 'readwrite', (transaction) =>
      req(transaction.objectStore(STORE_SESSIONS).put(session))
    );

    return session;
  }

  function getSession(id) {
    return run([STORE_SESSIONS], 'readonly', (transaction) =>
      req(transaction.objectStore(STORE_SESSIONS).get(id))
    );
  }

  // 读-改-写放在同一个事务里，避免并发写覆盖彼此的字段。
  function updateSession(id, patch) {
    return run([STORE_SESSIONS], 'readwrite', async (transaction) => {
      const store = transaction.objectStore(STORE_SESSIONS);
      const session = await req(store.get(id));
      if (!session) {
        return null;
      }

      const next = { ...session, ...patch, updatedAt: new Date().toISOString() };
      await req(store.put(next));
      return next;
    });
  }

  async function listSessions() {
    const sessions = await run([STORE_SESSIONS], 'readonly', (transaction) =>
      req(transaction.objectStore(STORE_SESSIONS).getAll())
    );

    return (sessions || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function deleteSession(id) {
    return run([STORE_SESSIONS, STORE_CHUNKS, STORE_MP3], 'readwrite', async (transaction) => {
      await req(transaction.objectStore(STORE_CHUNKS).delete(sessionRange(id)));
      await req(transaction.objectStore(STORE_MP3).delete(sessionRange(id)));
      await req(transaction.objectStore(STORE_SESSIONS).delete(id));
      return true;
    });
  }

  function appendPart(storeName, part) {
    return run([storeName], 'readwrite', (transaction) =>
      req(transaction.objectStore(storeName).put(part))
    );
  }

  // 崩溃后内存里的计数器没了，用游标倒查已落盘的最大 seq，保证续录不覆盖旧分片。
  function nextSeq(storeName, sessionId) {
    return run([storeName], 'readonly', async (transaction) => {
      const cursor = await req(
        transaction.objectStore(storeName).openKeyCursor(sessionRange(sessionId), 'prev')
      );
      if (!cursor) {
        return 0;
      }
      return Number(cursor.key[1]) + 1;
    });
  }

  // 返回按 seq 升序排列的分片行（data 是 Blob 引用，不会把内容读进内存）。
  function readParts(storeName, sessionId) {
    return run([storeName], 'readonly', (transaction) =>
      req(transaction.objectStore(storeName).getAll(sessionRange(sessionId)))
    );
  }

  async function usage() {
    const sessions = await listSessions();
    let bytes = 0;
    for (const session of sessions) {
      bytes += (session.webmBytes || 0) + (session.mp3Bytes || 0);
    }
    return { count: sessions.length, bytes };
  }

  // state 还停在 'recording' 说明上次没走正常停止流程（崩溃 / 直接关浏览器）。
  // exceptId 是此刻真的正在录的那个会话——service worker 可能在录音中途被回收再唤醒，
  // 那时 offscreen 还在录，绝不能把它当成中断会话。
  async function recoverInterrupted(exceptId) {
    const sessions = await listSessions();
    const recovered = [];

    for (const session of sessions) {
      if (session.id === exceptId) {
        continue;
      }

      // 一段都没开成的空壳会话（启动录音失败留下的），直接清掉。
      const empty = !session.segmentCount && !session.webmBytes && !session.mp3Bytes;
      if (empty) {
        await deleteSession(session.id);
        continue;
      }

      if (session.state === 'recording') {
        await updateSession(session.id, { state: 'paused', interrupted: true });
        recovered.push(session.id);
      }
    }

    return recovered;
  }

  globalThis.RecordingStore = {
    STORE_CHUNKS,
    STORE_MP3,
    createSession,
    getSession,
    updateSession,
    listSessions,
    deleteSession,
    appendPart,
    nextSeq,
    readParts,
    usage,
    recoverInterrupted
  };
})();
