#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 5 张 1280x800 中文商店截图 mockup。内嵌真实 popup 的精确样式。"""
import os

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- 真实 popup 的样式 token（取自 src/popup.css） ----
BASE_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f7f9fc;--panel:#ffffff;--ink:#162033;--muted:#607089;--line:#dce3ed;
  --primary:#1456d9;--danger:#c5221f;--ok:#16833a;--warn:#b36200;
}
html,body{width:1280px;height:800px}
body{
  font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
  background:linear-gradient(160deg,#eef3fb 0%,#e6ecf6 100%);
  color:var(--ink);overflow:hidden;
}
.stage{width:1280px;height:800px;display:flex;align-items:center;
  justify-content:space-between;padding:0 96px;position:relative}
/* 左侧文案 */
.copy{max-width:520px}
.copy h2{font-size:52px;line-height:1.18;font-weight:800;letter-spacing:-1px}
.copy p{font-size:22px;line-height:1.55;color:#46566e;margin-top:22px}
.badges{display:flex;gap:12px;margin-top:34px;flex-wrap:wrap}
.badge{font-size:16px;font-weight:700;padding:9px 16px;border-radius:999px;
  background:#fff;border:1px solid var(--line);color:#34465f}
.badge.blue{color:var(--primary);border-color:#bcd0f3}
.badge.green{color:var(--ok);border-color:#bfe3c9}
/* 浏览器窗口 mockup 容器 */
.window{width:430px;background:#fff;border-radius:16px;
  box-shadow:0 30px 70px rgba(22,40,80,.20);overflow:hidden;border:1px solid #e3e9f2}
.winbar{height:46px;background:#f1f4f9;display:flex;align-items:center;
  padding:0 16px;gap:8px;border-bottom:1px solid #e3e9f2}
.dot{width:11px;height:11px;border-radius:50%}
.dot.r{background:#ff5f57}.dot.y{background:#febc2e}.dot.g{background:#28c840}
.url{flex:1;margin-left:14px;height:26px;background:#fff;border:1px solid #e0e6ef;
  border-radius:7px;display:flex;align-items:center;padding:0 12px;
  font-size:13px;color:#7a889c}
/* ---- 真实 popup（放大 1.18x 以便商店展示） ---- */
.popwrap{padding:26px;display:flex;justify-content:center;background:var(--bg)}
.popup{width:350px;padding:14px;background:var(--bg);font-size:14px;
  transform:scale(1.18);transform-origin:top center}
.topbar{display:flex;align-items:flex-start;justify-content:space-between;
  gap:12px;margin-bottom:12px}
.brand{display:flex;align-items:flex-start;gap:10px;min-width:0}
.status-dot{width:10px;height:10px;border-radius:999px;background:var(--muted);margin-top:7px}
.status-dot.recording{background:var(--danger);box-shadow:0 0 0 4px rgba(197,34,31,.12)}
.status-dot.paused{background:var(--warn);box-shadow:0 0 0 4px rgba(179,98,0,.12)}
.status-dot.ready{background:var(--ok)}
.popup h1{font-size:18px;line-height:1.25;font-weight:700}
#statusText{color:var(--muted);margin-top:3px;line-height:1.4;font-size:14px}
.timer{min-width:64px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;
  background:var(--panel);font-variant-numeric:tabular-nums;text-align:center}
.info-panel{border:1px solid var(--line);border-radius:8px;background:var(--panel);overflow:hidden}
.info-row{display:grid;grid-template-columns:82px minmax(0,1fr);gap:10px;
  padding:10px 12px;border-bottom:1px solid var(--line)}
.info-row:last-child{border-bottom:0}
.info-row span{color:var(--muted)}
.info-row strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650}
.setting-row{display:flex;align-items:center;justify-content:space-between;
  margin-top:10px;padding:0 2px;font-size:13px;color:var(--muted)}
.toggle{position:relative;width:36px;height:20px;flex:0 0 auto}
.toggle-track{position:absolute;inset:0;background:var(--line);border-radius:10px}
.toggle-track::before{content:'';position:absolute;width:16px;height:16px;left:2px;bottom:2px;
  background:#fff;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.15)}
.toggle.on .toggle-track{background:var(--primary)}
.toggle.on .toggle-track::before{transform:translateX(16px)}
.actions{display:grid;gap:8px;margin-top:12px}
.btn{width:100%;min-height:40px;border:0;border-radius:8px;background:var(--primary);
  color:#fff;font:inherit;font-weight:700;display:flex;align-items:center;justify-content:center}
.btn.danger{background:var(--danger)}
.btn.secondary{background:#4f627a}
.btn.success{background:var(--ok)}
.btn.ghost{background:transparent;color:var(--muted);border:1px solid var(--line);
  font-weight:600;min-height:34px}
.btn.dis{opacity:.55}
.message{min-height:20px;margin-top:10px;color:var(--muted);line-height:1.45;font-size:13px}
.message.warning{color:var(--warn)}
.message.ok{color:var(--ok)}
"""

def popup(status_dot, status_text, timer, tab_title, file_state, toggle_on,
          start, pause, stop, export, msg="", msg_cls=""):
    """渲染真实 popup 结构。每个按钮传 (label, classes)。"""
    def b(label, cls):
        return f'<div class="btn {cls}">{label}</div>'
    toggle_cls = "toggle on" if toggle_on else "toggle"
    msg_html = f'<p class="message {msg_cls}">{msg}</p>' if msg else '<p class="message"></p>'
    return f"""
<div class="window">
  <div class="winbar"><span class="dot r"></span><span class="dot y"></span>
    <span class="dot g"></span><div class="url">video.example.com/lecture</div></div>
  <div class="popwrap"><div class="popup">
    <header class="topbar">
      <div class="brand">
        <span class="status-dot {status_dot}"></span>
        <div><h1>标签页录音</h1><p id="statusText">{status_text}</p></div>
      </div>
      <output class="timer">{timer}</output>
    </header>
    <section class="info-panel">
      <div class="info-row"><span>当前标签页</span><strong>{tab_title}</strong></div>
      <div class="info-row"><span>输出格式</span><strong>WebM / Opus</strong></div>
      <div class="info-row"><span>保存方式</span><strong>手动导出</strong></div>
      <div class="info-row"><span>文件状态</span><strong>{file_state}</strong></div>
    </section>
    <div class="setting-row"><span>标签页静音时自动暂停录音</span>
      <span class="{toggle_cls}"><span class="toggle-track"></span></span></div>
    <div class="actions">
      {b(*start)}{b(*pause)}{b(*stop)}{b(*export)}
      {b("重置","ghost")}
    </div>
    {msg_html}
  </div></div>
</div>"""

def page(copy_html, popup_html):
    return f"""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>{BASE_CSS}</style></head><body>
<div class="stage"><div class="copy">{copy_html}</div>{popup_html}</div>
</body></html>"""

scenes = {}

# 1 — 一键录制当前标签页（就绪态）
scenes["01-record-current-tab"] = page(
    """<h2>一键录制<br>当前标签页音频</h2>
       <p>打开任意在播放声音的标签页，点一下「开始录制」，立刻开始捕获。</p>
       <div class="badges"><span class="badge blue">WebM / Opus</span>
       <span class="badge">无需麦克风</span></div>""",
    popup("ready", "准备就绪", "00:00", "在线课程 · 第 3 讲", "未生成", False,
          ("开始录制当前标签页", ""), ("暂停录制", "secondary dis"),
          ("停止录制", "danger dis"), ("导出录音文件", "success dis")))

# 2 — 边听边录（录制中）
scenes["02-recording-in-progress"] = page(
    """<h2>边听边录，<br>声音不打断</h2>
       <p>录音期间标签页声音照常播放，你可以一边正常收听，一边把它录下来。</p>
       <div class="badges"><span class="badge">实时计时</span>
       <span class="badge blue">仅当前标签页</span></div>""",
    popup("recording", "正在录制", "12:48", "直播回放 · 技术分享", "录制中", True,
          ("开始录制当前标签页", "dis"), ("暂停录制", "secondary"),
          ("停止录制", "danger"), ("导出录音文件", "success dis"),
          "录音进行中，可关闭弹窗，录制不会中断。", ""))

# 3 — 暂停与继续
scenes["03-pause-and-resume"] = page(
    """<h2>随时暂停，<br>随时继续</h2>
       <p>中途想停一下？暂停后再继续，录音会接着写入同一个文件。</p>
       <div class="badges"><span class="badge">暂停 / 继续</span>
       <span class="badge">快捷键 Alt+Shift+8</span></div>""",
    popup("paused", "已暂停", "08:30", "直播回放 · 技术分享", "录制中", True,
          ("开始录制当前标签页", "dis"), ("继续录制", "secondary"),
          ("停止录制", "danger"), ("导出录音文件", "success dis"),
          "已暂停，点「继续录制」接着录。", "warning"))

# 4 — 导出本地文件
scenes["04-export-local-file"] = page(
    """<h2>录完导出，<br>保存到本地</h2>
       <p>停止后点「导出录音文件」，保存为 WebM/Opus，文件只留在你的电脑上。</p>
       <div class="badges"><span class="badge green">本地保存</span>
       <span class="badge">WebM / Opus</span></div>""",
    popup("ready", "录制完成", "15:20", "直播回放 · 技术分享", "已生成", True,
          ("开始录制当前标签页", ""), ("暂停录制", "secondary dis"),
          ("停止录制", "danger dis"), ("导出录音文件", "success"),
          "录音已就绪，点「导出录音文件」保存。", "ok"))

# 5 — 隐私优先
scenes["05-private-by-design"] = page(
    """<h2>不上传，<br>不录麦克风，<br>不追踪</h2>
       <p>全程在浏览器本地处理，没有任何外部网络请求，录音只属于你自己。</p>
       <div class="badges"><span class="badge green">本地处理</span>
       <span class="badge green">无网络请求</span>
       <span class="badge green">不录麦克风</span></div>""",
    popup("ready", "准备就绪", "00:00", "任意标签页", "未生成", False,
          ("开始录制当前标签页", ""), ("暂停录制", "secondary dis"),
          ("停止录制", "danger dis"), ("导出录音文件", "success dis")))

for name, html in scenes.items():
    path = os.path.join(OUT_DIR, name + ".html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", path)
