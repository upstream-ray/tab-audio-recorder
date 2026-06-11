# DESIGN

## 设计理念

简洁工具型 UI——用户打开 popup 就能一眼看到状态、一键操作。不做花哨动效，不堆功能入口。

## 布局

- **固定宽度 350px**，popup 模式下无滚动
- 从上到下三个区块：顶栏（状态 + 计时器）→ 信息面板 → 操作按钮

## 色彩系统

基于 CSS 自定义属性，Light 主题：

| Token | 值 | 用途 |
|---|---|---|
| `--bg` | `#f7f9fc` | 页面背景 |
| `--panel` | `#ffffff` | 卡片/面板背景 |
| `--ink` | `#162033` | 主要文字 |
| `--muted` | `#607089` | 次要文字、标签 |
| `--line` | `#dce3ed` | 分割线、边框 |
| `--primary` | `#1456d9` | 主操作按钮（开始录制） |
| `--primary-hover` | `#0d47bd` | 主按钮 hover |
| `--danger` | `#c5221f` | 危险操作（停止）、录音状态指示 |
| `--danger-hover` | `#a91612` | 危险按钮 hover |
| `--ok` | `#16833a` | 成功状态（就绪）、导出按钮 |
| `--warn` | `#b36200` | 警告状态（暂停） |

## 字体

系统字体栈：`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`，基础字号 14px。

## 状态指示器

左上角圆点（`.status-dot`）通过颜色反映录音状态：
- 灰色（`--muted`）：空闲
- 红色（`--danger`）+ 外发光：录音中
- 橙色（`--warn`）+ 外发光：已暂停
- 绿色（`--ok`）：录音就绪待导出

## 按钮体系

| 类型 | 样式 | 用途 |
|---|---|---|
| 默认 | `--primary` 实心 | 开始录制 |
| secondary | `#4f627a` 实心 | 暂停 |
| danger | `--danger` 实心 | 停止录制 |
| success | `--ok` 实心 | 导出录音 |
| ghost | 透明 + 边框 | 重置（hover 变红） |

所有按钮：圆角 8px、最小高度 40px（ghost 为 34px）、禁用态 opacity 0.55。

## 信息面板

卡片式设计（白底、1px 边框、8px 圆角），内部用 grid 两列布局（标签 82px + 内容弹性宽度）。行间用细分割线隔开。

## 计时器

右上角 `<output>` 元素，等宽数字（`font-variant-numeric: tabular-nums`），浅灰边框小卡片样式。

## 消息区

底部 `.message` 区域，用于状态提示和错误信息。通过 `.error`（红）和 `.warning`（橙）类名切换颜色。

## 暗色模式

当前未实现。未来如需添加，在 `:root` 下用 `prefers-color-scheme: dark` 媒体查询覆盖 CSS 变量即可，不需要改 HTML 结构。
