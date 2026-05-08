# 科研助手前端美化设计文档 — 白色简约主题

> **目标读者**：前端工程师（实施者）  
> **核心原则**：**零功能变更，仅视觉升级**。所有交互逻辑、数据流、组件结构保持不变，仅替换样式（CSS 变量与类名映射）。  
> **设计方向**：白色底色、简约清晰、降低认知负荷、现代科研工具质感。

---

## 目录

1. [设计哲学与核心原则](#1-设计哲学与核心原则)
2. [全局设计系统](#2-全局设计系统)
3. [CSS 变量迁移映射表](#3-css-变量迁移映射表)
4. [窗口级样式规范](#4-窗口级样式规范)
5. [组件级样式规范](#5-组件级样式规范)
6. [暗色主题回退方案](#6-暗色主题回退方案)
7. [实施清单与优先级](#7-实施清单与优先级)

---

## 1. 设计哲学与核心原则

### 1.1 为什么从暗色切换到白色主题？

当前暗色主题（`#07070d` 为底色，`#00e5cc` 青色为强调色）虽然具有"科技感"，但在科研场景中面临以下问题：

| 维度 | 暗色主题现状 | 白色主题优势 |
|------|------------|------------|
| **长时间阅读** | 高对比度（纯白文字在纯黑背景）容易导致视觉疲劳 | 纸张般的白底黑字更符合纸质文献阅读习惯，降低眼疲劳 |
| **内容专注度** | 强调色（青色发光效果）过于抢眼，分散对内容的注意力 | 克制的强调色（蓝色）引导视线而非抢夺视线 |
| **专业感** | 暗色+霓虹风格偏向游戏/黑客工具，与"科研助手"定位存在偏差 | 白色简约风格更接近 Notion、Obsidian、Readwise 等科研生产力工具 |
| **截图与分享** | 暗色界面截图在白底文档/PPT 中显得突兀 | 白色界面截图可直接嵌入论文、报告、演示文稿 |
| **多窗口协调** | 暗色悬浮球和弹窗在暗色桌面壁纸上难以辨识 | 白色卡片在绝大多数桌面背景下都有良好辨识度 |

### 1.2 设计关键词

**Clean（干净）** — 去除所有装饰性元素（呼吸光环、渐变发光、霓虹阴影），只保留功能性视觉层级。  
**Familiar（熟悉）** — 遵循主流科研/阅读工具（Zotero 7、Readwise、Notion、Google Scholar）的视觉惯例，用户无需学习新的视觉语言。  
**Quiet（安静）** — 界面不喧宾夺主，内容（论文、对话、笔记）始终是视觉焦点。  
**Structured（结构化）** — 通过留白、边框和微妙的背景色差异建立信息层级，而非依赖强烈的颜色对比。

### 1.3 变更范围声明

本次设计文档**严格限定为样式层变更**，以下项目**不涉及**：

- Vue 组件的 DOM 结构（不增删 HTML 元素）
- JavaScript 逻辑与事件处理
- 数据流和状态管理（Pinia stores）
- Rust 后端命令与 Tauri IPC
- 窗口尺寸与位置
- 全局快捷键绑定
- 字体文件加载方式

唯一变更范围：CSS 变量值、类选择器中的 `background` / `color` / `border` / `box-shadow` / `border-radius` 属性值。

---

## 2. 全局设计系统

### 2.1 色彩体系

新主题采用 **Google Material Design 3 + 科研工具惯例** 的混合配色方案。主色调从青色切换为学术蓝，以呼应学术/专业场景的心理联想。

#### 2.1.1 基础色彩（中性色阶）

| Token | 新值 (Light) | 旧值 (Dark) | 用途 | 使用场景 |
|-------|------------|------------|------|---------|
| `--bg-base` | `#ffffff` | `#07070d` | 页面最底层背景 | `body`、`#app` 根容器 |
| `--bg-surface` | `#f8f9fb` | `rgba(13,13,20,0.95)` | 次级背景，用于区分区块 | 侧边栏背景、卡片区底色 |
| `--bg-card` | `#ffffff` | `rgba(13,13,20,0.98)` | 卡片/面板表面 | 消息气泡、文档项、设置卡片 |
| `--bg-card-hover` | `#f4f6f9` | `rgba(255,255,255,0.04)` | 卡片悬停状态 | 列表项 hover、按钮 hover |
| `--bg-input` | `#ffffff` | `rgba(255,255,255,0.04)` | 输入框背景 | `textarea`、`input` |
| `--bg-input-hover` | `#f8f9fb` | `rgba(255,255,255,0.06)` | 输入框悬停 | 获得焦点前的 hover 状态 |
| `--bg-elevated` | `#ffffff` | `rgba(18,18,28,0.98)` | 浮层/弹窗/下拉菜单 | 弹窗、下拉面板、tooltip |
| `--bg-overlay` | `rgba(0,0,0,0.25)` | `rgba(0,0,0,0.7)` | 模态框遮罩 | 模态框背景遮罩 |

#### 2.1.2 强调色体系（主色：学术蓝）

| Token | 新值 | 旧值 | 用途 |
|-------|------|------|------|
| `--accent` | `#1a73e8` | `#00e5cc` | 主要强调色：主按钮、选中边框、激活状态 |
| `--accent-hover` | `#1557b0` | `#00b8a3` | 强调色悬停/按下状态 |
| `--accent-subtle` | `#e8f0fe` | `rgba(0,229,204,0.1)` | 强调色浅底色：选中项背景、标签底色 |
| `--accent-border` | `#aecbfa` | `rgba(0,229,204,0.3)` | 强调色边框：选中卡片边框 |
| `--accent-text` | `#1a73e8` | `#00e5cc` | 强调色文字：链接、标签文字 |

#### 2.1.3 语义色彩（成功/警告/错误）

| Token | 新值 | 旧值 | 用途 |
|-------|------|------|------|
| `--success` | `#34a853` | `#10b981` | 成功状态 |
| `--success-bg` | `#e6f4ea` | `rgba(16,185,129,0.12)` | 成功背景 |
| `--warning` | `#fbbc04` | `#f59e0b` | 警告状态 |
| `--warning-bg` | `#fef7e0` | `rgba(245,158,11,0.12)` | 警告背景 |
| `--error` | `#ea4335` | `#ef4444` | 错误/危险状态 |
| `--error-bg` | `#fce8e6` | `rgba(239,68,68,0.15)` | 错误背景 |
| `--info` | `#5f6368` | `#3d74e7` | 信息提示（次要操作按钮） |
| `--info-bg` | `#e8eaed` | `rgba(61,116,231,0.08)` | 信息背景 |

#### 2.1.4 文字色彩

| Token | 新值 | 旧值 | 用途 |
|-------|------|------|------|
| `--text-primary` | `#1a1a2e` | `#f0f0f5` | 主要文字：标题、正文 |
| `--text-secondary` | `#5f6368` | `rgba(240,240,245,0.8)` | 次要文字：正文、描述 |
| `--text-muted` | `#9aa0a6` | `rgba(240,240,245,0.5)` | 辅助文字：标签、提示 |
| `--text-dim` | `#dadce0` | `rgba(240,240,245,0.4)` | 禁用/占位文字 |
| `--text-on-accent` | `#ffffff` | `#06211f` | 强调色按钮上的文字 |
| `--text-inverse` | `#ffffff` | `#1a1a2e` | 深色背景上的白色文字（极少使用） |

#### 2.1.5 边框与分割线色彩

| Token | 新值 | 旧值 | 用途 |
|-------|------|------|------|
| `--border-subtle` | `#f0f2f5` | `rgba(255,255,255,0.06)` | 极浅分割线（区块之间） |
| `--border-light` | `#e8ecf0` | `rgba(255,255,255,0.08)` | 标准边框（卡片、输入框） |
| `--border-medium` | `#dde2e8` | `rgba(255,255,255,0.1)` | 强调边框（选中状态） |
| `--border-focus` | `#1a73e8` | `rgba(0,229,204,0.4)` | 焦点状态边框 |

#### 2.1.6 阴影体系

| 层级 | 新值 | 旧值 | 使用场景 |
|------|------|------|---------|
| `shadow-none` | `none` | `none` | 基础元素 |
| `shadow-xs` | `0 0 0 1px rgba(0,0,0,0.04)` | — | 内边框替代效果 |
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,0.02)` | `0 8px 32px rgba(0,229,204,0.25)` | 卡片默认状态 |
| `shadow-md` | `0 2px 8px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.02)` | `0 4px 20px rgba(0,0,0,0.3)` | 悬停状态、下拉菜单 |
| `shadow-lg` | `0 4px 16px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02)` | `0 24px 60px rgba(0,0,0,0.6)` | 弹窗、浮层面板 |
| `shadow-xl` | `0 8px 32px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.02)` | — | 模态框 |

### 2.2 字体体系

字体栈保持不变（`Syne`、`DM Sans`、`JetBrains Mono`），但使用方式有所调整：

| 字体 | 用途 | 字号范围 | 字重 | 说明 |
|------|------|---------|------|------|
| `DM Sans`, sans-serif | **主要字体**：正文、UI 标签、输入框 | `0.75rem – 1rem` | 400–600 | 替换 Syne 成为默认正文字体，更简洁易读 |
| `Syne`, sans-serif | **展示字体**：窗口标题、品牌标识、大标题 | `0.85rem – 1.15rem` | 600–800 | 减少使用频次，仅在需要视觉锚点时使用 |
| `JetBrains Mono`, monospace | **等宽字体**：代码块、进度数字、元数据标签 | `0.65rem – 0.8125rem` | 400–500 | 保持不变 |

**关键变更**：将 `DM Sans` 提升为默认正文字体（旧版使用 `Syne` 作为窗口标题也作为部分正文），`Syne` 降级为仅用于大标题和品牌展示。这样可以让正文阅读更加清晰舒适，因为 DM Sans 的小字号可读性优于 Syne。

### 2.3 间距与圆角

#### 2.3.1 间距（Spacing）

| Token | 值 | 使用场景 |
|-------|-----|---------|
| `--space-2xs` | `2px` | 图标内部偏移 |
| `--space-xs` | `4px` | 图标间距、紧凑内边距 |
| `--space-sm` | `8px` | 组件内元素间隙、按钮内边距 |
| `--space-md` | `12px` | 卡片内边距、列表项间距 |
| `--space-lg` | `16px` | 区块间距、面板内边距 |
| `--space-xl` | `20px` | 大区块间距 |
| `--space-2xl` | `24px` | 弹窗/对话框内边距 |

#### 2.3.2 圆角（Border Radius）

| Token | 值 | 使用场景 |
|-------|-----|---------|
| `--radius-sm` | `6px` | 按钮、小标签、输入框 |
| `--radius-md` | `8px` | 卡片、列表项、消息气泡 |
| `--radius-lg` | `12px` | 面板、弹窗 |
| `--radius-xl` | `16px` | 大卡片、设置面板 |
| `--radius-full` | `999px` | 胶囊按钮、头像、徽章 |

**关键变更**：整体圆角策略从旧版的"大圆角（18px 面板）+ 发光效果"转变为"小圆角（6-12px）+ 边框区分"，营造更精练、更专业的科研工具质感。

### 2.4 过渡动画

| Token | 值 | 使用场景 |
|-------|-----|---------|
| `--transition-fast` | `0.12s ease` | 颜色变化（hover 变色） |
| `--transition-base` | `0.18s ease` | 背景色、边框色变化 |
| `--transition-slow` | `0.24s ease` | 尺寸变化、透明度变化 |
| `--transition-transform` | `0.2s cubic-bezier(0.4, 0, 0.2, 1)` | 位移、缩放动画 |

### 2.5 滚动条样式

```css
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #dadce0;
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: #bdc1c6;
}
```

**变更要点**：滚动条从暗色半透明（`rgba(255,255,255,0.02)` 轨道 + 青色滑块）改为简洁的浅灰滑块（`#dadce0`），与白色主题融合。

---

## 3. CSS 变量迁移映射表

### 3.1 根变量替换（`src/style.css`）

以下表格可以直接作为迁移指南。将 `/* OLD */` 行替换为 `/* NEW */` 行。

```css
/* ========================================
   CSS Variables — Light Theme (NEW)
   Replace entire :root block in src/style.css
   ======================================== */

:root {
  /* Accent — 主色调：学术蓝 */
  --accent: #1a73e8;
  --accent-hover: #1557b0;
  --accent-subtle: #e8f0fe;
  --accent-border: #aecbfa;
  --accent-text: #1a73e8;

  /* Background — 背景体系 */
  --bg-base: #ffffff;
  --bg-surface: #f8f9fb;
  --bg-card: #ffffff;
  --bg-card-hover: #f4f6f9;
  --bg-input: #ffffff;
  --bg-input-hover: #f8f9fb;
  --bg-elevated: #ffffff;
  --bg-overlay: rgba(0, 0, 0, 0.25);

  /* Semantic — 语义色彩 */
  --success: #34a853;
  --success-bg: #e6f4ea;
  --warning: #fbbc04;
  --warning-bg: #fef7e0;
  --error: #ea4335;
  --error-bg: #fce8e6;
  --info: #5f6368;
  --info-bg: #e8eaed;

  /* Text — 文字色彩 */
  --text-primary: #1a1a2e;
  --text-secondary: #5f6368;
  --text-muted: #9aa0a6;
  --text-dim: #dadce0;
  --text-on-accent: #ffffff;
  --text-inverse: #ffffff;

  /* Border — 边框色彩 */
  --border-subtle: #f0f2f5;
  --border-light: #e8ecf0;
  --border-medium: #dde2e8;
  --border-focus: #1a73e8;

  /* Shadow — 阴影 */
  --shadow-xs: 0 0 0 1px rgba(0, 0, 0, 0.04);
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.02);
  --shadow-md: 0 2px 8px rgba(0, 0, 0, 0.06), 0 0 0 1px rgba(0, 0, 0, 0.02);
  --shadow-lg: 0 4px 16px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.02);
  --shadow-xl: 0 8px 32px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.02);

  /* Spacing */
  --space-2xs: 2px;
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 12px;
  --space-lg: 16px;
  --space-xl: 20px;
  --space-2xl: 24px;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --radius-full: 999px;

  /* Transition */
  --transition-fast: 0.12s ease;
  --transition-base: 0.18s ease;
  --transition-slow: 0.24s ease;
  --transition-transform: 0.2s cubic-bezier(0.4, 0, 0.2, 1);

  /* Font stacks (unchanged) */
  --font-display: 'Syne', 'DM Sans', sans-serif;
  --font-body: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
}
```

### 3.2 被移除的变量

以下旧版变量在新主题中不再需要，可直接删除：

| 被移除变量 | 旧值 | 移除原因 |
|-----------|------|---------|
| `--accent-dim` | `#00b8a3` | 新主题使用 `--accent-hover` 替代 |
| `--accent-glow` | `rgba(0,229,204,0.3)` | 去除发光效果 |
| `--accent-glow-strong` | — | 去除发光效果 |
| `--bg-panel` | `rgba(13,13,20,0.95)` | 合并入 `--bg-surface` |
| `--bg-card`（旧含义） | `rgba(13,13,20,0.98)` | 暗色背景值不再使用 |

---

## 4. 窗口级样式规范

以下逐一描述 10 个窗口的样式规范。**每个窗口的"DOM 结构"部分仅用于定位，实际不修改 HTML；只修改对应的 CSS 选择器中的属性值。**

### 4.1 Widget Window（悬浮球）

**文件**：`src/windows/WidgetWindow.vue`  
**设计方向**：从"发光霓虹球"转变为"简洁白瓷按钮"，弱化视觉侵略性，悬浮时呈现柔和阴影。

#### 4.1.1 悬浮球（折叠状态）

```css
/* .widget-shell — 外框 */
.widget-shell {
  width: 64px;                          /* 从 72px 缩小，更精致 */
  height: 64px;
  border-radius: 50%;
  background: #ffffff;                   /* 从 cyan 渐变改为纯白 */
  box-shadow: var(--shadow-md);          /* 柔和的投影取代发光 */
  border: 1.5px solid var(--border-light); /* 加细边框增强轮廓 */
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: box-shadow var(--transition-base),
              transform var(--transition-transform);
}

.widget-shell:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-1px);
}

.widget-shell:active {
  transform: translateY(0) scale(0.96);
}

/* .core — 内部圆形（去除渐变，改为品牌标识区域） */
.core {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--accent-subtle);      /* 淡蓝色背景 */
  color: var(--accent);                  /* 蓝色文字/图标 */
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  font-family: var(--font-display);
  /* 移除：渐变背景、发光阴影 */
}

/* 移除 .breathing-ring — 呼吸光环效果完全删除 */
/* 移除 .breathing-ring 的所有相关 CSS 和 keyframes */

/* .badge — 未读角标 */
.badge {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--error);
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid #ffffff;              /* 白色描边从背景中突出 */
  box-shadow: none;                        /* 移除发光 */
}
```

#### 4.1.2 Tooltip

```css
.tooltip {
  background: #ffffff;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  padding: 6px 12px;
  font-size: 0.75rem;
  color: var(--text-secondary);
  /* 移除：backdrop-filter: blur(12px)、半透明黑色背景 */
}
```

#### 4.1.3 展开面板

```css
.expanded-panel {
  width: 280px;
  height: 360px;
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-xl);
  border: 1px solid var(--border-light);
  /* 移除：半透明黑色背景、霓虹阴影 */
}

.panel-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  /* 移除：半透明边框 */
}

.header-title {
  font-family: var(--font-display);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.action-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-sm);
  padding: var(--space-md);
}

.action-btn {
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  background: var(--bg-surface);
  border: 1px solid transparent;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 500;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  transition: all var(--transition-base);
  cursor: pointer;
}

.action-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.action-btn:active {
  background: var(--accent);
  color: var(--text-on-accent);
}
```

### 4.2 Main Window（AI 聊天主窗口）

**文件**：`src/windows/MainWindow.vue`  
**设计方向**：从"暗色终端"转变为"干净的对话界面"，类似 Notion AI 或 ChatGPT 的简洁白底聊天风格。

#### 4.2.1 主窗口容器

```css
.main-window {
  width: 100%;
  height: 100%;
  background: var(--bg-base);           /* 纯白背景 */
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  /* 移除：暗色背景 #07070d */
}

.main-header {
  height: 40px;
  -webkit-app-region: drag;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);        /* 浅色头部 */
  display: flex;
  align-items: center;
  padding: 0 var(--space-lg);
  font-family: var(--font-display);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}
```

#### 4.2.2 聊天区域

```css
.chat-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 消息列表区域 */
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-lg);
  background: var(--bg-base);
}

/* 单条消息 */
.message {
  margin-bottom: var(--space-lg);
  display: flex;
  gap: var(--space-md);
  max-width: 90%;
}

/* 用户消息右对齐 */
.message.user {
  margin-left: auto;
  flex-direction: row-reverse;
}

/* AI 头像 */
.message-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--accent-subtle);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.875rem;
  font-weight: 600;
  flex-shrink: 0;
  /* 移除：渐变背景 */
}

/* 用户头像 */
.message.user .message-avatar {
  background: var(--bg-surface);
  color: var(--text-secondary);
  border: 1px solid var(--border-light);
}

/* 消息内容气泡 */
.message-content {
  flex: 1;
  border-radius: var(--radius-md);
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-surface);        /* 浅灰气泡 */
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
}

/* 用户消息气泡 — 蓝色主题 */
.message.user .message-content {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

/* 消息头部（角色 + 时间） */
.message-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-xs);
  font-size: 0.75rem;
  color: var(--text-muted);
}

.message.user .message-header {
  color: rgba(255, 255, 255, 0.75);
}

/* 引用角标 */
.citation-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-size: 0.65rem;
  font-weight: 500;
  margin-right: var(--space-xs);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.citation-badge:hover {
  background: var(--accent-border);
}

.message.user .citation-badge {
  background: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}

/* Todo 列表 */
.todo-item {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: var(--info-bg);
  border-left: 3px solid var(--info);
  margin-bottom: var(--space-xs);
  font-size: 0.8125rem;
  color: var(--text-primary);
}

/* 消息底部（token 统计、模型信息） */
.message-footer {
  font-size: 0.65rem;
  color: var(--text-dim);
  margin-top: var(--space-sm);
  display: flex;
  gap: var(--space-md);
}

/* 消息操作按钮（复制、重试） */
.message-actions {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.message:hover .message-actions {
  opacity: 1;
}

.message-action-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.75rem;
  transition: all var(--transition-fast);
}

.message-action-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent-text);
  border-color: var(--accent-border);
}
```

#### 4.2.3 输入区域

```css
.chat-input-area {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-base);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: var(--space-sm);
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-sm) var(--space-md);
  transition: border-color var(--transition-base),
              box-shadow var(--transition-base);
}

.input-wrapper:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

textarea {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: var(--font-body);
  resize: none;
  max-height: 120px;
  outline: none;
  line-height: 1.5;
}

textarea::placeholder {
  color: var(--text-dim);
}

.attach-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.attach-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.send-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1rem;
  transition: background var(--transition-fast);
  flex-shrink: 0;
}

.send-btn:hover {
  background: var(--accent-hover);
}

.send-btn:disabled {
  background: var(--text-dim);
  cursor: not-allowed;
}
```

#### 4.2.4 ChatHeader 组件

```css
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.back-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.icon-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}
```

### 4.3 Popup Window（剪贴板菜单）

**文件**：`src/windows/PopupWindow.vue`  
**设计方向**：从"暗色悬浮面板"转变为"清爽的系统级菜单"，类似 macOS 右键菜单的简洁白底风格。

```css
.popup-window {
  width: 100%;
  height: 100%;
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: var(--space-xs);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-light);
  /* 移除：半透明黑色背景、霓虹阴影、顶部发光线 */
}

/* 移除 .popup-window::before — 顶部青色发光线 */

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
  /* 移除：左侧青色竖条 ::before */
}

.menu-item:hover {
  background: var(--accent-subtle);
  color: var(--accent-text);
  /* 移除：左侧竖条 scaleY 动画 */
}

.menu-item:active {
  background: var(--accent-border);
}

.menu-item .icon {
  font-size: 1.125rem;
  width: 24px;
  text-align: center;
}

.menu-item .label {
  font-size: 0.875rem;
  font-weight: 500;
}
```

#### Processing Overlay

```css
.processing-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  /* 从暗色半透明改为白色半透明 */
}

.progress-container {
  width: 80%;
  max-width: 280px;
  text-align: center;
}

.progress-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: var(--space-md);
}

.progress-bar-track {
  width: 100%;
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
  /* 移除：渐变和发光效果 */
}

.progress-percent {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  margin-top: var(--space-sm);
}

.cancel-btn {
  margin-top: var(--space-md);
  padding: var(--space-xs) var(--space-lg);
  background: var(--error-bg);
  border: 1px solid rgba(234, 67, 53, 0.2);
  color: var(--error);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.cancel-btn:hover {
  background: #f9d9d7;
}
```

#### Polish Panel

```css
.polish-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--space-md);
}

.polish-diff {
  flex: 1;
  overflow-y: auto;
  background: var(--bg-surface);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  border: 1px solid var(--border-subtle);
  /* 移除：黑色半透明背景 */
}

.diff-add {
  background: #d4edda;
  color: #155724;
  /* 从荧光绿改为柔和的增亮色 */
}

.diff-del {
  background: #f8d7da;
  color: #721c24;
  text-decoration: line-through;
  /* 从荧光红改为柔和的删除色 */
}

.polish-btn.accept {
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  /* 移除：渐变背景 */
}

.polish-btn.reject {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}

.polish-btn.reject:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
}
```

#### Citation Panel

```css
.citation-card {
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-sm);
  transition: all var(--transition-fast);
}

.citation-card:hover {
  border-color: var(--border-medium);
}

.citation-card.selected {
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}

.citation-reason {
  font-size: 0.72rem;
  color: var(--accent-text);
  font-style: italic;
}

.format-btn {
  padding: 2px 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.65rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.format-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.format-btn.preferred {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
  box-shadow: none;
  /* 移除：霓虹发光 */
}

.citation-insert-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-md);
  border-top: 1px solid var(--border-subtle);
  background: var(--accent-subtle);
}

.insert-btn {
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-md);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast);
  /* 移除：渐变背景 */
}

.insert-btn:hover {
  background: var(--accent-hover);
}
```

### 4.4 Capture Window（截图遮罩）

**文件**：`src/windows/CaptureWindow.vue`  
**设计方向**：从"暗色霓虹选区"转变为"清爽半透明遮罩"，类似 macOS 截图工具或微信截图的简洁风格。

```css
.capture-window {
  position: fixed;
  inset: 0;
  cursor: crosshair;
  background: rgba(0, 0, 0, 0.15);      /* 更浅的遮罩，让用户能看清底层内容 */
  backdrop-filter: blur(2px);
}

.background-image {
  position: absolute;
  inset: 0;
  z-index: 0;
}

.overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.1); /* 极浅的白色覆盖层 */
  z-index: 1;
}

.selection-box {
  position: absolute;
  border: 2px solid var(--accent);
  background: rgba(26, 115, 232, 0.08);  /* 淡蓝色半透明 */
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.2); /* 选区外暗化 */
  z-index: 10;
}

/* 移除 .selection-box::before — 外环发光 */

.selection-info {
  position: absolute;
  bottom: -32px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-md);
  white-space: nowrap;
  /* 移除：青色文字、青色边框 */
}

.instructions {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-lg);
  box-shadow: var(--shadow-lg);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  pointer-events: none;
  z-index: 20;
  /* 移除：半透明黑色背景 */
}
```

### 4.5 Result Window（结果展示）

**文件**：`src/windows/ResultWindow.vue`  
**设计方向**：从"暗色终端"转变为"干净的结果卡片"，类似 CleanShot 或 Typora 的简洁展示风格。

#### Processing State

```css
.result-window {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  /* 移除：暗色背景 */
}

.progress-container {
  width: 80%;
  max-width: 320px;
  text-align: center;
  margin: auto;
}

.progress-icon {
  font-size: 2.5rem;
  margin-bottom: var(--space-md);
  color: var(--accent);
}

.progress-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: var(--space-md);
}

.progress-bar-track {
  width: 100%;
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  /* 移除：渐变和发光效果 */
}

.progress-percent {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  margin-top: var(--space-sm);
}

.cancel-btn {
  margin-top: var(--space-lg);
  padding: var(--space-xs) var(--space-lg);
  background: var(--error-bg);
  border: 1px solid rgba(234, 67, 53, 0.2);
  color: var(--error);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.cancel-btn:hover {
  background: #f9d9d7;
}

.streaming-preview {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--bg-surface);
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  max-height: 60px;
  overflow: hidden;
  margin-top: var(--space-md);
  border: 1px solid var(--border-subtle);
  /* 移除：黑色背景 */
}
```

#### Result State

```css
.result-header {
  display: flex;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-weight: 600;
  font-size: 0.875rem;
}

.result-content pre {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-surface);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  overflow: auto;
  /* 移除：黑色背景 */
}

.result-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: 0.75rem;
  background: var(--bg-surface);
}

.note-btn {
  background: var(--info-bg);
  border: 1px solid rgba(95, 99, 104, 0.15);
  color: var(--info);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.note-btn:hover {
  background: #dfe1e5;
}

.note-btn.saved {
  background: var(--success-bg);
  border-color: rgba(52, 168, 83, 0.2);
  color: var(--success);
}

.close-btn {
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}
```

### 4.6 Knowledge Panel（知识面板）

**文件**：`src/components/KnowledgePanel.vue`  
**设计方向**：从"暗色侧边栏"转变为"清爽的文件管理面板"，类似 Apple Finder 侧边栏或 Notion 数据库的简洁白底风格。

```css
.knowledge-panel {
  width: 100%;
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
  /* 移除：暗色背景、发光渐变 */
}

/* 移除 ::before radial-gradient glow */

.drag-handle {
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  color: var(--text-dim);
  font-size: 0.75rem;
}

.panel-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.back-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.close-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

/* Search Input */
.search-section {
  padding: var(--space-md) var(--space-lg);
}

.search-input-wrapper {
  display: flex;
  gap: var(--space-sm);
}

.search-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-base),
              box-shadow var(--transition-base);
}

.search-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.search-input::placeholder {
  color: var(--text-dim);
}

.search-btn {
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  padding: var(--space-sm) var(--space-md);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.search-btn:hover {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

/* Tab Bar */
.tab-bar {
  display: flex;
  gap: var(--space-xs);
  padding: 0 var(--space-lg);
  margin-bottom: var(--space-sm);
}

.tab-btn {
  flex: 1;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tab-btn:hover {
  border-color: var(--border-medium);
  color: var(--text-secondary);
}

.tab-btn.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

/* Review Button */
.review-btn {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  margin: 0 var(--space-lg) var(--space-sm);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  /* 移除：紫色渐变 */
}

.review-btn:hover {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

/* Document Item */
.doc-item {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  transition: all var(--transition-fast);
  margin: 0 var(--space-md);
  margin-bottom: var(--space-xs);
}

.doc-item:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
}

.doc-name {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-status {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
  display: inline-block;
  margin-top: var(--space-xs);
}

.status-completed {
  background: var(--success-bg);
  color: var(--success);
}

.status-indexing {
  background: var(--accent-subtle);
  color: var(--accent-text);
}

.status-pending {
  background: var(--warning-bg);
  color: #b06000;
}

.status-error {
  background: var(--error-bg);
  color: var(--error);
}

/* Collection Selector Dropdown */
.collection-selector {
  margin-top: var(--space-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  max-height: 260px;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  font-size: 0.7rem;
  color: var(--text-muted);
}

.breadcrumb-item.active {
  color: var(--accent-text);
  font-weight: 600;
}

.collection-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.collection-item:hover {
  background: var(--bg-surface);
}

.enter-folder-btn {
  background: var(--accent-subtle);
  border: none;
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  color: var(--accent-text);
  font-size: 0.65rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.enter-folder-btn:hover {
  background: var(--accent-border);
}
```

### 4.7 Settings Panel（设置面板）

**文件**：`src/components/SettingsPanel.vue`  
**设计方向**：设置面板当前就是唯一的亮色窗口，需要将其风格统一到新设计系统中，保持与其他窗口的一致性。

```css
.settings-panel {
  background: var(--bg-base);
  /* 从渐变背景改为纯白 */
}

.header {
  padding: var(--space-lg) var(--space-2xl);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  /* 移除：半透明背景 */
}

.header h2 {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
}

.header-subtitle {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.close-btn {
  color: var(--text-muted);
  font-size: 1.2rem;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

/* Cards */
.card {
  margin-bottom: var(--space-lg);
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--transition-base);
}

.card:hover {
  box-shadow: var(--shadow-md);
}

.card-header {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  cursor: pointer;
  background: transparent;
  border: none;
}

.card-title {
  font-family: var(--font-display);
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--accent-text);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.card-subtitle {
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.card-toggle {
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 600;
}

/* Form Elements */
.input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-md);
  color: var(--text-primary);
  font-size: 0.9rem;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-base),
              box-shadow var(--transition-base);
}

.input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.provider-chip {
  border-radius: var(--radius-full);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  font-weight: 600;
  font-size: 0.88rem;
  cursor: pointer;
  transition: all var(--transition-fast);
  text-align: center;
}

.provider-chip:hover {
  border-color: var(--border-medium);
  color: var(--text-secondary);
}

.provider-chip.active {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
  box-shadow: none;
  /* 移除：蓝色渐变和阴影 */
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: var(--space-sm);
}

/* Toggle Switch */
.toggle-switch {
  width: 44px;
  height: 24px;
  border-radius: var(--radius-full);
  background: var(--border-medium);
  border: none;
  cursor: pointer;
  position: relative;
  transition: background var(--transition-base);
}

.toggle-switch.active {
  background: var(--accent);
}

.toggle-knob {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  position: absolute;
  top: 2px;
  left: 2px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: transform var(--transition-base);
}

.toggle-switch.active .toggle-knob {
  transform: translateX(20px);
}

/* Save Button */
.save-btn {
  width: 100%;
  background: var(--accent);
  border: none;
  border-radius: var(--radius-md);
  padding: var(--space-md);
  color: var(--text-on-accent);
  font-family: var(--font-display);
  font-weight: 700;
  cursor: pointer;
  transition: background var(--transition-fast);
  box-shadow: none;
  /* 移除：渐变和发光 */
}

.save-btn:hover {
  background: var(--accent-hover);
}

.save-btn.saved {
  background: var(--success);
}

/* Reset Button */
.reset-btn {
  width: 100%;
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  color: var(--text-muted);
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.reset-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-secondary);
}
```

### 4.8 Review Wizard Window（文献综述向导）

**文件**：`src/windows/ReviewWizardWindow.vue`  
**设计方向**：从"暗色 wizard"转变为"干净的多步表单"，类似 Typeform 或 Google Forms 的简洁白底表单风格。

```css
.review-wizard {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  /* 移除：暗色背景 */
}

.wizard-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: move;
  -webkit-app-region: drag;
}

.header-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

/* Step Indicator */
.step-indicator {
  display: flex;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.step-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1.5px solid var(--border-light);
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--transition-base);
}

.step-dot.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.step-dot.current {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-on-accent);
  box-shadow: 0 0 0 3px var(--accent-subtle);
  /* 发光改为 ring 效果 */
}

/* Source / Style Selection Cards */
.source-options,
.style-options {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.source-card,
.style-card {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--bg-card);
  border: 1.5px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  transition: all var(--transition-base);
}

.source-card:hover,
.style-card:hover {
  border-color: var(--border-medium);
  background: var(--bg-card-hover);
}

.source-card.active,
.style-card.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.source-icon,
.style-icon {
  font-size: 1.25rem;
  width: 32px;
  text-align: center;
}

.source-label,
.style-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.style-desc {
  font-size: 0.72rem;
  color: var(--text-muted);
}

/* Paper Selection List */
.paper-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-height: 300px;
  overflow-y: auto;
}

.paper-select-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.paper-select-item:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
}

.paper-select-item.selected {
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}

.paper-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paper-meta {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.selection-count {
  margin-top: var(--space-sm);
  font-size: 0.78rem;
  color: var(--accent-text);
  text-align: center;
  font-weight: 500;
}

/* Form Groups */
.form-group {
  margin-top: var(--space-md);
}

.form-group label {
  display: block;
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
  margin-bottom: var(--space-xs);
}

.form-group input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-base),
              box-shadow var(--transition-base);
}

.form-group input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

/* Confirm Step */
.confirm-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--space-lg) 0;
}

.confirm-info {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  width: 100%;
}

.info-row {
  display: flex;
  justify-content: space-between;
  padding: var(--space-xs) 0;
  font-size: 0.8125rem;
  border-bottom: 1px solid var(--border-subtle);
}

.info-row:last-child {
  border-bottom: none;
}

.info-label {
  color: var(--text-muted);
}

.generate-btn {
  padding: var(--space-sm) var(--space-2xl);
  background: var(--accent);
  border: none;
  border-radius: var(--radius-md);
  color: var(--text-on-accent);
  font-size: 0.9rem;
  font-weight: 700;
  cursor: pointer;
  transition: background var(--transition-fast);
  /* 移除：渐变 */
}

.generate-btn:hover {
  background: var(--accent-hover);
}

/* Progress Bar */
.progress-bar {
  width: 80%;
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
  margin: var(--space-md) auto;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
  /* 移除：渐变 */
}

.progress-stage {
  font-size: 0.85rem;
  color: var(--text-secondary);
  text-align: center;
}

.progress-detail {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
  text-align: center;
}

/* Result Preview */
.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-md);
}

.copy-btn {
  padding: var(--space-xs) var(--space-sm);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.copy-btn:hover {
  background: var(--accent);
  color: var(--text-on-accent);
}

.section h4 {
  margin: 0 0 var(--space-sm);
  font-size: 0.85rem;
  color: var(--accent-text);
  font-weight: 600;
}

.section-content {
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

/* Wizard Footer */
.wizard-footer {
  display: flex;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.footer-btn {
  padding: var(--space-xs) var(--space-md);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.footer-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.footer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.footer-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text-on-accent);
  font-weight: 700;
}

.footer-btn.primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}
```

### 4.9 Sentinel Brief Window（文献简报）

**文件**：`src/windows/SentinelBriefWindow.vue`  
**设计方向**：从"暗色通知面板"转变为"干净的 RSS 阅读器"，类似 Reeder 或 Inoreader 的简洁白底新闻列表风格。

```css
.sentinel-brief {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
  /* 移除：暗色背景 */
}

.brief-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: move;
  -webkit-app-region: drag;
}

.header-title {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: 0.9rem;
  font-weight: 600;
}

.header-badge {
  background: var(--error);
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  min-width: 16px;
  text-align: center;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

.brief-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md);
}

/* Topic Groups */
.topic-group {
  margin-bottom: var(--space-lg);
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) 0;
  margin-bottom: var(--space-sm);
}

.group-name {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text-primary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.group-count {
  font-size: 0.72rem;
  color: var(--text-muted);
  background: var(--bg-surface);
  padding: 2px 8px;
  border-radius: var(--radius-full);
}

/* Paper Card */
.paper-card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-sm);
  transition: all var(--transition-fast);
}

.paper-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
  box-shadow: var(--shadow-sm);
}

.paper-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: var(--space-xs);
}

.paper-authors {
  font-size: 0.72rem;
  color: var(--text-muted);
  margin-bottom: var(--space-sm);
}

.paper-abstract {
  font-size: 0.75rem;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: var(--space-sm);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.paper-meta {
  display: flex;
  gap: var(--space-md);
  align-items: center;
}

.paper-date {
  font-size: 0.65rem;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

.paper-source {
  font-size: 0.65rem;
  color: var(--accent-text);
  text-transform: uppercase;
  font-weight: 600;
}

.paper-actions {
  display: flex;
  gap: var(--space-xs);
  margin-top: var(--space-sm);
}

.action-btn {
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: 0.72rem;
  cursor: pointer;
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  color: var(--text-muted);
  transition: all var(--transition-fast);
}

.action-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-secondary);
}

.action-btn.view {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.action-btn.view:hover {
  background: var(--accent);
  color: var(--text-on-accent);
}

.action-btn.ignore {
  background: transparent;
  border-color: transparent;
}

.action-btn.ignore:hover {
  background: var(--error-bg);
  color: var(--error);
  border-color: rgba(234, 67, 53, 0.15);
}
```

### 4.10 Experiment Snapshot Window（实验快照）

**文件**：`src/windows/ExperimentSnapshotWindow.vue`  
**设计方向**：从"暗色表单"转变为"干净的记录表单"，类似 Apple Notes 或 Notion 快速捕捉的简洁白底风格。

```css
.experiment-snapshot-window {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  /* 移除：暗色背景 */
}

.snapshot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: move;
  -webkit-app-region: drag;
}

.header-title {
  font-size: 0.9rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

.snapshot-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-md) var(--space-lg);
}

/* Type Selector */
.type-selector {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
}

.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-xs);
  background: var(--bg-card);
  border: 1.5px solid var(--border-light);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  cursor: pointer;
  transition: all var(--transition-base);
}

.type-btn:hover {
  border-color: var(--border-medium);
  color: var(--text-secondary);
  background: var(--bg-card-hover);
}

.type-btn.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.type-icon {
  font-size: 1.25rem;
}

.type-label {
  font-size: 0.7rem;
  font-weight: 500;
}

/* Form Groups */
.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-bottom: var(--space-md);
}

.form-group label {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-weight: 600;
}

.form-group input,
.form-group textarea {
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  color: var(--text-primary);
  font-size: 0.85rem;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-base),
              box-shadow var(--transition-base);
}

.form-group input:focus,
.form-group textarea:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.form-group textarea {
  resize: vertical;
  min-height: 80px;
}

/* Save Button */
.save-btn {
  margin-top: auto;
  padding: var(--space-sm) var(--space-md);
  background: var(--accent);
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-on-accent);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: background var(--transition-fast);
  /* 移除：渐变 */
}

.save-btn:hover {
  background: var(--accent-hover);
}

.save-btn:disabled {
  background: var(--text-dim);
  cursor: not-allowed;
}

/* Toast */
.toast {
  position: absolute;
  bottom: var(--space-lg);
  right: var(--space-lg);
  padding: var(--space-sm) var(--space-md);
  background: var(--success-bg);
  border: 1px solid rgba(52, 168, 83, 0.15);
  border-radius: var(--radius-md);
  color: var(--success);
  font-size: 0.8rem;
  font-weight: 600;
  box-shadow: var(--shadow-lg);
  animation: toast-in 0.3s ease;
}

@keyframes toast-in {
  from {
    transform: translateY(10px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}
```

---

## 5. 组件级样式规范

### 5.1 按钮组件规范

```css
/* ===== 主要按钮（Primary）===== */
/* 用途：发送消息、保存设置、生成综述、确认操作 */
.btn-primary {
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  font-weight: 600;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-primary:active {
  transform: translateY(1px);
}

/* ===== 次要按钮（Secondary）===== */
/* 用途：取消、返回、关闭 */
.btn-secondary {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  font-weight: 500;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-secondary:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

/* ===== 幽灵按钮（Ghost）===== */
/* 用途：图标按钮、工具栏按钮 */
.btn-ghost {
  background: transparent;
  border: none;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: var(--space-xs);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-ghost:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

/* ===== 危险按钮（Danger）===== */
/* 用途：删除、取消操作 */
.btn-danger {
  background: var(--error-bg);
  border: 1px solid rgba(234, 67, 53, 0.2);
  color: var(--error);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  font-weight: 500;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-danger:hover {
  background: #f9d9d7;
  border-color: rgba(234, 67, 53, 0.3);
}

/* ===== 胶囊标签（Pill）===== */
/* 用途：状态标签、分类标签 */
.btn-pill {
  display: inline-flex;
  align-items: center;
  padding: var(--space-xs) var(--space-sm);
  background: var(--accent-subtle);
  border: none;
  border-radius: var(--radius-full);
  color: var(--accent-text);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.btn-pill:hover {
  background: var(--accent-border);
}
```

### 5.2 卡片组件规范

```css
/* ===== 标准卡片 ===== */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  transition: all var(--transition-fast);
}

.card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
  box-shadow: var(--shadow-sm);
}

/* ===== 可交互卡片（选择态）===== */
.card-interactive {
  background: var(--bg-card);
  border: 1.5px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  cursor: pointer;
  transition: all var(--transition-base);
}

.card-interactive:hover {
  border-color: var(--border-medium);
  background: var(--bg-card-hover);
}

.card-interactive.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
}

/* ===== 文件/文档项卡片 ===== */
.doc-card {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-xs);
  transition: all var(--transition-fast);
}

.doc-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
}
```

### 5.3 输入框组件规范

```css
/* ===== 标准输入框 ===== */
.input {
  width: 100%;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  color: var(--text-primary);
  font-size: 0.875rem;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-base),
              box-shadow var(--transition-base);
}

.input:hover {
  border-color: var(--border-medium);
}

.input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.input::placeholder {
  color: var(--text-dim);
}

.input:disabled {
  background: var(--bg-surface);
  color: var(--text-dim);
  cursor: not-allowed;
}

/* ===== 多行文本框 ===== */
.textarea {
  composes: input; /* 继承 .input 的所有属性 */
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
}
```

### 5.4 进度条组件规范

```css
/* ===== 标准进度条 ===== */
.progress-track {
  width: 100%;
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* ===== 带标签的进度条 ===== */
.progress-with-label {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.progress-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  min-width: 40px;
  text-align: right;
  font-family: var(--font-mono);
}
```

---

## 6. 暗色主题回退方案

### 6.1 为什么保留暗色主题？

尽管主主题切换为白色，但建议保留暗色主题作为**可选模式**，原因如下：

1. **用户习惯**：部分用户可能已经习惯了暗色主题
2. **夜间使用**：在低光环境下，暗色主题更护眼
3. **OLED 屏幕**：暗色主题在 OLED 屏幕上更省电

### 6.2 实现方案

通过 CSS 变量和媒体查询实现自动跟随系统主题：

```css
/* ===== 默认亮色主题 ===== */
:root {
  /* 所有亮色变量（已在第 2 节定义） */
}

/* ===== 暗色主题回退 ===== */
@media (prefers-color-scheme: dark) {
  :root {
    /* 暗色主题变量 — 恢复当前使用的暗色值 */
    --accent: #00e5cc;
    --accent-hover: #00b8a3;
    --accent-subtle: rgba(0, 229, 204, 0.1);
    --accent-border: rgba(0, 229, 204, 0.3);
    --accent-text: #00e5cc;

    --bg-base: #07070d;
    --bg-surface: rgba(13, 13, 20, 0.95);
    --bg-card: rgba(13, 13, 20, 0.98);
    --bg-card-hover: rgba(255, 255, 255, 0.04);
    --bg-input: rgba(255, 255, 255, 0.04);
    --bg-elevated: #12121c;
    --bg-overlay: rgba(0, 0, 0, 0.7);

    --text-primary: #f0f0f5;
    --text-secondary: rgba(240, 240, 245, 0.8);
    --text-muted: rgba(240, 240, 245, 0.5);
    --text-dim: rgba(240, 240, 245, 0.4);
    --text-on-accent: #06211f;

    --border-subtle: rgba(255, 255, 255, 0.06);
    --border-light: rgba(255, 255, 255, 0.08);
    --border-medium: rgba(255, 255, 255, 0.1);
    --border-focus: rgba(0, 229, 204, 0.4);

    --shadow-sm: 0 8px 32px rgba(0, 229, 204, 0.08);
    --shadow-md: 0 4px 20px rgba(0, 0, 0, 0.3);
    --shadow-lg: 0 24px 60px rgba(0, 0, 0, 0.6);
  }
}

/* ===== 手动切换类 ===== */
[data-theme="dark"] {
  /* 与上面的 @media 暗色变量完全相同 */
}
```

### 6.3 手动切换机制

在设置面板中添加"主题"选项：

```typescript
// stores/settings.ts 中新增
type ThemeMode = 'light' | 'dark' | 'system';

interface SettingsState {
  // ... 现有配置
  themeMode: ThemeMode;
}

// 在 App.vue 的 onMounted 中
document.documentElement.setAttribute('data-theme', settings.themeMode);
```

---

## 7. 实施清单与优先级

### 7.1 实施优先级

| 优先级 | 文件 | 工作量 | 影响范围 |
|--------|------|--------|----------|
| **P0** | `src/style.css` — 替换 `:root` 变量 | 30 min | 全局 |
| **P0** | `src/windows/WidgetWindow.vue` — 悬浮球样式 | 1 h | 核心入口 |
| **P0** | `src/windows/MainWindow.vue` + 聊天组件 | 2 h | 核心功能 |
| **P0** | `src/windows/PopupWindow.vue` — 剪贴板菜单 | 1.5 h | 高频使用 |
| **P1** | `src/windows/CaptureWindow.vue` — 截图遮罩 | 1 h | 中频使用 |
| **P1** | `src/windows/ResultWindow.vue` — 结果展示 | 1 h | 中频使用 |
| **P1** | `src/components/KnowledgePanel.vue` — 知识面板 | 1.5 h | 核心功能 |
| **P1** | `src/components/SettingsPanel.vue` — 设置面板 | 1 h | 低频使用 |
| **P2** | `src/windows/ReviewWizardWindow.vue` — 综述向导 | 1.5 h | 低频使用 |
| **P2** | `src/windows/SentinelBriefWindow.vue` — 文献简报 | 1 h | 低频使用 |
| **P2** | `src/windows/ExperimentSnapshotWindow.vue` — 实验快照 | 1 h | 低频使用 |

**总工作量估算**：约 **12-14 小时**（纯 CSS 替换，不含测试时间）

### 7.2 实施顺序建议

**第一步**：替换 `src/style.css` 中的 `:root` 变量块（全局生效，立即看到基础效果）  
**第二步**：逐个窗口修改，按照 P0 → P1 → P2 的顺序  
**第三步**：全局搜索遗留的硬编码颜色值（使用 VS Code 全局搜索 `#00e5cc`、`rgba(0,229,204` 等）  
**第四步**：添加暗色主题回退（可选，可后续迭代）

### 7.3 遗留硬编码颜色清理清单

以下颜色值在新主题中**不应再出现**，实施完成后需全局搜索确认已清理：

| 搜索关键词 | 旧用途 | 新替代 |
|-----------|--------|--------|
| `#00e5cc` | 主强调色（青色） | `var(--accent)` → `#1a73e8` |
| `#00b8a3` | 强调色深色 | `var(--accent-hover)` → `#1557b0` |
| `#07070d` | 暗色背景 | `var(--bg-base)` → `#ffffff` |
| `rgba(0,229,204` | 青色半透明变体 | `var(--accent-subtle)` / `var(--accent-border)` |
| `rgba(13,13,20` | 面板暗色背景 | `var(--bg-surface)` → `#f8f9fb` |
| `rgba(255,255,255,0.06)` | 暗色边框 | `var(--border-subtle)` → `#f0f2f5` |
| `rgba(255,255,255,0.04)` | 暗色卡片背景 | `var(--bg-card-hover)` → `#f4f6f9` |
| `rgba(240,240,245` | 暗色文字 | `var(--text-primary)` → `#1a1a2e` |
| `#8b5cf6` | 紫色（综述按钮） | `var(--accent)` → `#1a73e8` |
| `#3d74e7` | 蓝色（知识库按钮） | `var(--accent)` → `#1a73e8` |
| `linear-gradient(135deg, #00e5cc, #00b8a3)` | 按钮渐变 | `var(--accent)`（纯色） |

### 7.4 测试检查清单

实施完成后，请逐项检查以下视觉一致性：

- [ ] 悬浮球从青色发光球变为白色圆形按钮
- [ ] 所有窗口背景为白色/浅灰色，无黑色残留
- [ ] 主要按钮为蓝色纯色（无渐变），白色文字
- [ ] 输入框聚焦时有蓝色 ring 效果
- [ ] 消息气泡区分 AI（浅灰）和用户（蓝色）
- [ ] 截图遮罩区域为浅色半透明，选区框为蓝色
- [ ] 文献简报卡片为白底灰边框，悬停有微阴影
- [ ] 设置面板卡片与其他窗口风格一致
- [ ] 综述向导步骤指示器为蓝色圆点
- [ ] 所有文字清晰可读，对比度符合 WCAG AA 标准
- [ ] 滚动条为浅灰色，与白色主题融合
- [ ] 无青色（`#00e5cc`）残留元素
