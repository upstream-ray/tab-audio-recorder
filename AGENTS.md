# AGENTS

AI 协作入口文档。开始任何开发工作前，先读这份文件获取全局上下文。

## 文档索引

| 文档 | 位置 | 作用 |
|---|---|---|
| **BRIEF** | [`BRIEF.md`](BRIEF.md) | 项目纲领——是什么、给谁、核心原则、不做什么 |
| **DESIGN** | [`DESIGN.md`](DESIGN.md) | 视觉与 UX——色彩、布局、组件规范 |
| **ARCHITECTURE** | [`ARCHITECTURE.md`](ARCHITECTURE.md) | 技术选型、三层架构、状态机、关键约束 |
| **v1 PRD** | [`iterations/v1-launch/PRD.md`](iterations/v1-launch/PRD.md) | v1 功能需求与验收标准 |

## 阅读顺序

1. 本文件（AGENTS.md）——获取全局导航
2. BRIEF.md——理解项目本质和边界
3. ARCHITECTURE.md——理解技术架构和约束（**必读**，包含关键不变量）
4. DESIGN.md——理解 UI 规范
5. 对应迭代的 PRD.md——理解当前要做的功能

## 开发规则

- **零依赖**：不引入 npm 包、不加构建步骤。所有代码直接由浏览器加载。
- **隐私优先**：不加网络请求、不加 host permission。任何涉及外部通信的改动必须先和用户确认。
- **保持声音回放**：`keepCapturedAudioAudible` 不能删。删了用户就听不到标签页声音了。
- **下载双通道**：`chrome.downloads` 主路径 + offscreen `<a download>` 兜底路径，两条都要保持可用。
- **状态归 background**：popup 是纯展示层，不持有状态。所有用户操作都委托给 background 处理。

## 迭代方式

每次新功能或重构，在 `iterations/` 下新建 `v{N}-{slug}/` 目录，写 PRD.md 记录需求，完成后保留作为历史记录。长期文档（BRIEF / DESIGN / ARCHITECTURE / AGENTS）只在项目级变更时才修改。
