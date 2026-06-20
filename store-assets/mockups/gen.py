#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成商店截图 mockup（1280x800）。内嵌 0.2.0 真实 popup 样式，支持中/英双语。
中文输出到本目录，英文输出到 ./en/。"""
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

GEAR = ('<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" '
        'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle>'
        '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 '
        '1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 '
        '1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 '
        '4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 '
        '0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 '
        '1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>')
CHEVRON = ('<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" '
           'stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>')

# ---- 0.2.0 真实 popup 的样式 token（取自 src/popup.css） ----
BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#ffffff;--surface:#f5f5f7;--surface-strong:#f0f0f2;--ink:#1d1d1f;--muted:#86868b;
  --hairline:rgba(60,60,67,.12);--primary:#0071e3;--primary-tint:#eef4ff;
  --danger:#ff3b30;--danger-tint:#ffeceb;--ok:#34c759;--toggle-off:#e3e3e8;
  --disabled-bg:#f0f0f2;--disabled-ink:#c5c5c7;
}
html,body{width:1280px;height:800px}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI","Microsoft YaHei",sans-serif;
  background:linear-gradient(165deg,#fbfbfd 0%,#eef0f3 100%);color:var(--ink);overflow:hidden;
  -webkit-font-smoothing:antialiased}
body.dark{background:linear-gradient(165deg,#222226 0%,#141416 100%);color:#f5f5f7}
.stage{width:1280px;height:800px;display:flex;align-items:center;justify-content:space-between;
  padding:0 100px;position:relative}
/* 左侧文案 */
.copy{max-width:540px}
.copy h2{font-size:54px;line-height:1.14;font-weight:600;letter-spacing:-1.4px;color:var(--ink)}
body.en .copy h2{font-size:46px;letter-spacing:-1px;line-height:1.1}
body.dark .copy h2{color:#f5f5f7}
.copy p{font-size:21px;line-height:1.6;color:#5b5b60;margin-top:24px;font-weight:400}
body.en .copy p{font-size:20px}
body.dark .copy p{color:#a9a9b0}
.badges{display:flex;gap:10px;margin-top:36px;flex-wrap:wrap}
.badge{font-size:15px;font-weight:500;padding:9px 16px;border-radius:999px;background:#fff;
  border:.5px solid rgba(0,0,0,.1);color:#1d1d1f;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.badge.blue{color:#0071e3}.badge.green{color:#1a8f3c}
body.dark .badge{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.14);color:#f5f5f7}
body.dark .badge.blue{color:#5aacff}body.dark .badge.green{color:#5fd97f}
/* 浏览器窗口 mockup 容器 */
.window{width:430px;background:#fff;border-radius:18px;box-shadow:0 30px 80px rgba(20,30,60,.22);
  overflow:hidden;border:.5px solid rgba(0,0,0,.06)}
.window.dark{background:#1c1c1e;border-color:rgba(255,255,255,.08);box-shadow:0 30px 80px rgba(0,0,0,.5)}
.winbar{height:46px;background:#f6f6f8;display:flex;align-items:center;padding:0 16px;gap:8px;
  border-bottom:.5px solid rgba(0,0,0,.06)}
.window.dark .winbar{background:#2a2a2c;border-color:rgba(255,255,255,.07)}
.dot{width:11px;height:11px;border-radius:50%}
.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
.url{flex:1;margin-left:14px;height:26px;background:#fff;border:.5px solid rgba(0,0,0,.08);border-radius:7px;
  display:flex;align-items:center;padding:0 12px;font-size:13px;color:#86868b}
.window.dark .url{background:#1c1c1e;border-color:rgba(255,255,255,.1);color:#98989f}
/* ---- 真实 popup（放大 1.12x 以便商店展示） ---- */
.popwrap{padding:30px 22px;display:flex;justify-content:center;background:var(--bg)}
.window.dark .popwrap{background:#1c1c1e}
.popup{width:340px;padding:4px 2px;font-size:14px;zoom:1.12}
.popup.dark{--bg:#1c1c1e;--surface:#2c2c2e;--surface-strong:#3a3a3c;--ink:#f5f5f7;--muted:#98989f;
  --hairline:rgba(255,255,255,.1);--primary:#0a84ff;--primary-tint:rgba(10,132,255,.22);
  --danger:#ff453a;--danger-tint:rgba(255,69,58,.22);--ok:#30d158;--toggle-off:#39393d;
  --disabled-bg:#2c2c2e;--disabled-ink:#5a5a5e;color:#f5f5f7}
.topbar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.brand{display:flex;align-items:center;gap:9px;min-width:0;flex:1 1 auto}
.status-dot{width:8px;height:8px;border-radius:50%;background:var(--muted);flex:0 0 auto}
.status-dot.recording{background:var(--danger);box-shadow:0 0 0 4px rgba(255,59,48,.16)}
.status-dot.paused{background:#ff9f0a;box-shadow:0 0 0 4px rgba(255,159,10,.16)}
.status-dot.ready{background:var(--ok)}
.popup h1{font-size:16px;line-height:1.2;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
#statusText{color:var(--muted);margin-top:1px;line-height:1.3;font-size:12px}
.statusText.rec{color:var(--danger)}
.timer{font-size:30px;font-weight:300;line-height:1;letter-spacing:.01em;color:var(--ink);
  font-variant-numeric:tabular-nums;flex:0 0 auto}
.icon-btn{width:30px;height:30px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;
  border-radius:8px;color:var(--muted)}
.info-panel{background:var(--surface);border-radius:13px;overflow:hidden}
.info-row{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:9px 14px;font-size:13.5px}
.info-row:not(:first-child)::before{content:'';position:absolute;top:0;left:14px;right:0;height:.5px;background:var(--hairline)}
.info-row span{color:var(--muted);flex:0 0 auto}
.info-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;color:var(--ink)}
.setting-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px;
  padding:0 2px;font-size:13.5px;color:var(--ink)}
.toggle{position:relative;width:40px;height:24px;flex:0 0 auto}
.toggle-track{position:absolute;inset:0;background:var(--toggle-off);border-radius:12px}
.toggle-track::before{content:'';position:absolute;width:20px;height:20px;left:2px;bottom:2px;background:#fff;
  border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.toggle.on .toggle-track{background:var(--ok)}
.toggle.on .toggle-track::before{transform:translateX(16px)}
.actions{display:grid;gap:8px;margin-top:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.btn{width:100%;min-height:42px;border-radius:12px;font-weight:500;font-size:15px;display:flex;
  align-items:center;justify-content:center;background:var(--primary);color:#fff}
.pair .btn{min-height:40px;font-size:14px}
.btn.dis{background:var(--disabled-bg);color:var(--disabled-ink)}
.btn.tint-blue{background:var(--primary-tint);color:var(--primary)}
.btn.tint-red{background:var(--danger-tint);color:var(--danger)}
.btn.ghost{background:transparent;color:var(--muted);min-height:32px;font-size:13px;font-weight:400}
.message{min-height:18px;margin-top:10px;color:var(--muted);line-height:1.45;font-size:12.5px;text-align:center}
.message.warning{color:#ff9f0a}.message.ok{color:var(--ok)}
/* 设置子页面 */
.settings-bar{display:flex;align-items:center;gap:6px;margin-bottom:14px}
.settings-title{font-size:16px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.group-label{font-size:12px;color:var(--muted);margin:0 0 6px 6px}
.group-gap{height:14px}
.opt-list{background:var(--surface);border-radius:13px;overflow:hidden}
.opt-row{position:relative;display:flex;align-items:center;justify-content:space-between;padding:11px 14px;
  font-size:14px;color:var(--ink)}
.opt-row:not(:first-child)::before{content:'';position:absolute;top:0;left:14px;right:0;height:.5px;background:var(--hairline)}
.opt-check{color:var(--primary);font-weight:600}
"""

# ---- 界面固定文案（popup chrome / 设置页） ----
UI = {
    "zh": dict(app="标签页录音", tab="当前标签页", fmt="输出格式", save="保存方式", save_v="手动导出",
               state="文件状态", autopause="标签页静音时自动暂停",
               start="开始录制当前标签页", pause="暂停录制", stop="停止录制", export="导出录音文件", reset="重置",
               set_title="设置", set_lang="界面语言", follow_lang="跟随系统语言",
               set_theme="主题", th_light="浅色", th_dark="深色", th_follow="跟随系统",
               set_fmt="导出格式", fmt_webm="WebM(原始)", fmt_mp3="MP3"),
    "en": dict(app="Tab Audio Recorder", tab="Current tab", fmt="Output format", save="Save mode", save_v="Manual export",
               state="File state", autopause="Auto-pause when the tab is muted",
               start="Record this tab", pause="Pause", stop="Stop", export="Export recording", reset="Reset",
               set_title="Settings", set_lang="Language", follow_lang="Follow system language",
               set_theme="Theme", th_light="Light", th_dark="Dark", th_follow="Follow system",
               set_fmt="Export format", fmt_webm="WebM (original)", fmt_mp3="MP3"),
}


def b(label, cls=""):
    return f'<div class="btn {cls}">{label}</div>'


def popup(ui, status_dot, status_text, timer, tab_title, fmt, file_state, toggle_on,
          start_cls, pause_cls, stop_cls, export_cls, msg="", msg_cls="", status_rec=False):
    toggle_cls = "toggle on" if toggle_on else "toggle"
    msg_html = f'<p class="message {msg_cls}">{msg}</p>' if msg else '<p class="message"></p>'
    st_cls = "rec" if status_rec else ""
    return f"""
    <header class="topbar">
      <div class="brand">
        <span class="status-dot {status_dot}"></span>
        <div><h1>{ui['app']}</h1><p id="statusText" class="statusText {st_cls}">{status_text}</p></div>
      </div>
      <div class="timer">{timer}</div>
      <span class="icon-btn">{GEAR}</span>
    </header>
    <section class="info-panel">
      <div class="info-row"><span>{ui['tab']}</span><strong>{tab_title}</strong></div>
      <div class="info-row"><span>{ui['fmt']}</span><strong>{fmt}</strong></div>
      <div class="info-row"><span>{ui['save']}</span><strong>{ui['save_v']}</strong></div>
      <div class="info-row"><span>{ui['state']}</span><strong>{file_state}</strong></div>
    </section>
    <div class="setting-row"><span>{ui['autopause']}</span>
      <span class="{toggle_cls}"><span class="toggle-track"></span></span></div>
    <div class="actions">
      {b(ui['start'], start_cls)}
      <div class="pair">{b(ui['pause'], pause_cls)}{b(ui['stop'], stop_cls)}</div>
      {b(ui['export'], export_cls)}
      {b(ui['reset'], "ghost")}
    </div>
    {msg_html}"""


def opt(label, active):
    check = '<span class="opt-check">✓</span>' if active else '<span></span>'
    return f'<div class="opt-row"><span>{label}</span>{check}</div>'


def settings_panel(ui):
    return f"""
    <header class="settings-bar"><span class="icon-btn">{CHEVRON}</span>
      <h1 class="settings-title">{ui['set_title']}</h1></header>
    <p class="group-label">{ui['set_lang']}</p>
    <div class="opt-list">{opt("简体中文",True)}{opt("繁體中文",False)}{opt("English",False)}{opt(ui['follow_lang'],False)}</div>
    <div class="group-gap"></div>
    <p class="group-label">{ui['set_theme']}</p>
    <div class="opt-list">{opt(ui['th_light'],False)}{opt(ui['th_dark'],True)}{opt(ui['th_follow'],False)}</div>
    <div class="group-gap"></div>
    <p class="group-label">{ui['set_fmt']}</p>
    <div class="opt-list">{opt(ui['fmt_webm'],False)}{opt(ui['fmt_mp3'],True)}</div>"""


def page(copy_html, inner, lang, dark=False):
    body_cls = " ".join(c for c in [lang, ("dark" if dark else "")] if c)
    win_cls = "window dark" if dark else "window"
    pop_cls = "popup dark" if dark else "popup"
    return f"""<!doctype html><html lang="{'zh-CN' if lang=='zh' else 'en'}"><head><meta charset="utf-8">
<style>{BASE_CSS}</style></head><body class="{body_cls}">
<div class="stage"><div class="copy">{copy_html}</div>
<div class="{win_cls}">
  <div class="winbar"><span class="dot r"></span><span class="dot y"></span>
    <span class="dot g"></span><div class="url">video.example.com/lecture</div></div>
  <div class="popwrap"><div class="{pop_cls}">{inner}</div></div>
</div></div></body></html>"""


# ---- 每个语言的场景文案 + popup 状态 ----
def build_scenes(lang):
    ui = UI[lang]
    s = {}
    if lang == "zh":
        s["01-record-current-tab"] = page(
            """<h2>一键录制<br>当前标签页音频</h2>
               <p>打开任意在播放声音的标签页，点一下「开始录制」，立刻开始捕获。</p>
               <div class="badges"><span class="badge blue">WebM / Opus</span>
               <span class="badge blue">MP3</span><span class="badge">无需麦克风</span></div>""",
            popup(ui, "ready", "待机", "0:00", "在线课程 · 第 3 讲", "WebM / Opus", "未生成", False,
                  "", "dis", "dis", "dis"), lang)
        s["02-recording-in-progress"] = page(
            """<h2>边听边录，<br>声音不打断</h2>
               <p>录音期间标签页声音照常播放，关闭弹窗也不会中断，随时暂停再继续。</p>
               <div class="badges"><span class="badge">实时计时</span>
               <span class="badge blue">仅当前标签页</span><span class="badge">暂停 / 继续</span></div>""",
            popup(ui, "recording", "录制中", "12:48", "直播回放 · 技术分享", "WebM / Opus", "缓冲中 · 18.6 MB", True,
                  "dis", "tint-blue", "tint-red", "dis",
                  "录音进行中，可关闭弹窗，录制不会中断。", "", status_rec=True), lang)
        s["03-pause-and-resume"] = page(
            """<h2>语言、主题、格式<br>一处设置搞定</h2>
               <p>弹窗内的设置页：界面语言简繁中英任选，浅色 / 深色 / 跟随系统，导出 WebM 或 MP3。</p>
               <div class="badges"><span class="badge">简 / 繁 / 英</span>
               <span class="badge">深色模式</span><span class="badge blue">MP3 导出</span></div>""",
            settings_panel(ui), lang)
        s["04-export-local-file"] = page(
            """<h2>录完导出，<br>保存到本地</h2>
               <p>停止后点「导出录音文件」，按所选格式保存为 MP3 或 WebM，文件只留在你的电脑上。</p>
               <div class="badges"><span class="badge green">本地保存</span>
               <span class="badge blue">MP3</span><span class="badge">WebM / Opus</span></div>""",
            popup(ui, "ready", "可导出", "15:20", "直播回放 · 技术分享", "MP3", "已生成 · 14.2 MB", True,
                  "dis", "dis", "dis", "",
                  "录音已就绪，点「导出录音文件」保存。", "ok"), lang)
        s["05-private-by-design"] = page(
            """<h2>深色护眼，<br>隐私优先</h2>
               <p>全程在浏览器本地处理，连 MP3 转换也不联网，没有任何外部请求，录音只属于你自己。</p>
               <div class="badges"><span class="badge">深色模式</span>
               <span class="badge green">本地处理</span><span class="badge green">无网络请求</span></div>""",
            popup(ui, "ready", "待机", "0:00", "任意标签页", "WebM / Opus", "未生成", False,
                  "", "dis", "dis", "dis"), lang, dark=True)
    else:
        s["01-record-current-tab"] = page(
            """<h2>Record any tab's<br>audio in one click</h2>
               <p>Open any tab that's playing sound and hit Record — capture starts instantly.</p>
               <div class="badges"><span class="badge blue">WebM / Opus</span>
               <span class="badge blue">MP3</span><span class="badge">No microphone</span></div>""",
            popup(ui, "ready", "Idle", "0:00", "Online course · Lesson 3", "WebM / Opus", "Not created", False,
                  "", "dis", "dis", "dis"), lang)
        s["02-recording-in-progress"] = page(
            """<h2>Keep listening<br>while you record</h2>
               <p>The tab keeps playing while you record. Close the popup and it won't stop — pause and resume anytime.</p>
               <div class="badges"><span class="badge">Live timer</span>
               <span class="badge blue">Current tab only</span><span class="badge">Pause / resume</span></div>""",
            popup(ui, "recording", "Recording", "12:48", "Livestream replay · Tech talk", "WebM / Opus", "Buffered · 18.6 MB", True,
                  "dis", "tint-blue", "tint-red", "dis",
                  "Recording in progress — you can close the popup.", "", status_rec=True), lang)
        s["03-pause-and-resume"] = page(
            """<h2>Language, theme, format<br>— all in one place</h2>
               <p>An in-popup settings page: interface language, light / dark / system theme, and export as WebM or MP3.</p>
               <div class="badges"><span class="badge">EN / 简 / 繁</span>
               <span class="badge">Dark mode</span><span class="badge blue">MP3 export</span></div>""",
            settings_panel(ui), lang)
        s["04-export-local-file"] = page(
            """<h2>Stop, export,<br>keep it local</h2>
               <p>Hit Export recording to save as MP3 or WebM — the file stays on your computer.</p>
               <div class="badges"><span class="badge green">Local save</span>
               <span class="badge blue">MP3</span><span class="badge">WebM / Opus</span></div>""",
            popup(ui, "ready", "Ready to export", "15:20", "Livestream replay · Tech talk", "MP3", "Ready · 14.2 MB", True,
                  "dis", "dis", "dis", "",
                  "Recording ready — click Export recording to save.", "ok"), lang)
        s["05-private-by-design"] = page(
            """<h2>Dark mode,<br>privacy first</h2>
               <p>Everything runs locally in your browser — even MP3 conversion. No external requests. Your recording is yours.</p>
               <div class="badges"><span class="badge">Dark mode</span>
               <span class="badge green">Local processing</span><span class="badge green">No network</span></div>""",
            popup(ui, "ready", "Idle", "0:00", "Any tab", "WebM / Opus", "Not created", False,
                  "", "dis", "dis", "dis"), lang, dark=True)
    return s


for lang in ("zh", "en"):
    out = OUT_DIR if lang == "zh" else os.path.join(OUT_DIR, "en")
    os.makedirs(out, exist_ok=True)
    for name, html in build_scenes(lang).items():
        path = os.path.join(out, name + ".html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        print("wrote", path)
