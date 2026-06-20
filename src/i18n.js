// 运行时多语言加载器。
//
// chrome.i18n.getMessage() 只能跟随浏览器界面语言、无法在运行时切换，
// 因此这里以 _locales/<lang>/messages.json 为唯一数据源（fetch 加载），
// 由 chrome.storage.local 里的 uiLang 偏好决定当前语言，可随时切换。
// popup / offscreen 是 document 上下文，通过 <script src="i18n.js"> 共用本模块；
// background（MV3 service worker）的 importScripts 加载不可靠，改用内联副本。
(function () {
  const SUPPORTED = ['en', 'zh_CN'];
  const FALLBACK = 'en';
  const tables = {}; // lang -> 原始 messages.json 对象
  let current = guessFromBrowser(); // 当前实际生效语言
  let pref = 'auto'; // 用户偏好：'auto'(跟随系统) | 'en' | 'zh_CN'

  function guessFromBrowser() {
    // chrome.i18n 在 offscreen document 里不可用，访问会抛错，需容错回退。
    try {
      const ui = (chrome.i18n.getUILanguage() || '').toLowerCase();
      return ui.startsWith('zh') ? 'zh_CN' : 'en';
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

  // 把 messages.json 的 { message, placeholders } 渲染成最终文案。
  // 占位符形如 "$file$"，其 content "$1" 指向 subs[0]。
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
      if (uiLang && SUPPORTED.includes(uiLang)) {
        pref = uiLang;
        current = uiLang;
      } else {
        // 无偏好或存的是 'auto' —— 跟随系统语言。
        pref = 'auto';
        current = guessFromBrowser();
      }
    } catch (error) {
      // storage 不可用时退回浏览器语言推断。
      pref = 'auto';
      current = guessFromBrowser();
    }
    await loadTable(current);
    if (current !== FALLBACK) await loadTable(FALLBACK);
  })();

  // lang 可为 'auto'(跟随系统) 或具体语言码。
  async function setLang(lang) {
    let nextPref;
    let nextLang;
    if (lang === 'auto') {
      nextPref = 'auto';
      nextLang = guessFromBrowser();
    } else if (SUPPORTED.includes(lang)) {
      nextPref = lang;
      nextLang = lang;
    } else {
      return;
    }
    if (nextPref === pref && nextLang === current) return;
    await loadTable(nextLang);
    pref = nextPref;
    current = nextLang;
    try {
      await chrome.storage.local.set({ uiLang: nextPref });
    } catch (error) {
      // 偏好持久化失败不影响本次切换。
    }
  }

  function bcp47() {
    return current === 'zh_CN' ? 'zh-CN' : 'en';
  }

  globalThis.I18N = {
    t,
    ready,
    setLang,
    bcp47,
    SUPPORTED,
    get lang() {
      return current;
    },
    get pref() {
      return pref;
    }
  };
})();
