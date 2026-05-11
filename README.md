# 「知玄」- 知乎全场景悬浮创作舱

一款专为知乎创作者打造的 AI 桌面悬浮创作舱,基于 **Tauri v2 + Vue 3 + Rust** 构建。支持多窗口协作、AI 流式对话、视觉素材提取、灵感库语义检索、创作快照、热点哨兵、插件扩展与团队协作空间。

---

## 目录

- [快速开始](#快速开始)
- [系统架构](#系统架构)
- [窗口体系](#窗口体系)
- [功能模块详解](#功能模块详解)
- [数据库设计](#数据库设计)
- [后端模块 (Rust)](#后端模块-rust)
- [前端架构 (Vue)](#前端架构-vue)
- [功能联动关系](#功能联动关系)
- [开发指南](#开发指南)
- [常见问题](#常见问题)

---

## 快速开始

### 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | >= 18.18.0 |
| Rust | 最新稳定版 |
| Windows | Windows 10/11 (部分功能依赖 Win32 API) |

```bash
# 安装前端依赖
npm install

# 开发模式启动
npm run tauri dev

# 生产构建
npm run tauri build
```

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         前端 (Vue 3 + Vite)                          │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ │
│  │   Widget    │ │    Main     │ │   Popup     │ │    Capture    │ │
│  │  (悬浮球)   │ │ (AI 聊天)   │ │ (快捷菜单)  │ │  (截图提取)   │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────────┘ │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ │
│  │   Result    │ │ReviewWizard │ │SentinelBrief│ │ExpSnapshot    │ │
│  │ (结果展示)  │ │ (文献综述)  │ │ (文献简报)  │ │ (实验快照)    │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────────┘ │
│                                                                     │
│  Stores: settings / history / projects / knowledgeBase / usage      │
│  Composables: useWindow / useClipboard / useDatabase / useEvents    │
└──────────────────────────────┬──────────────────────────────────────┘
│                              │ IPC (invoke + event emit/listen)      │
└──────────────────────────────┼──────────────────────────────────────┘
│                         后端 (Rust + Tauri)                         │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ │
│  │app_control  │ │window_mgr   │ │screenshot   │ │ clipboard    │ │
│  │event_collect│ │window_detect│ │text_select  │ │ text_inject  │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────────┘ │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ │
│  │sentinel     │ │experiment   │ │plugin       │ │ team         │ │
│  │pdf_detect   │ │content_detect│ │             │ │              │ │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────────┘ │
│                                                                     │
│  Plugins: tauri-plugin-sql | -http | -global-shortcut | -fs        │
└─────────────────────────────────────────────────────────────────────┘
│                              SQLite (本地)                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端框架** | Vue 3.5 + TypeScript | Composition API, `<script setup>` |
| **构建工具** | Vite 6 | 开发端口 1420 |
| **状态管理** | Pinia 3 | 按窗口独立实例（重要！见下文） |
| **样式** | TailwindCSS v4 + PostCSS + 自定义 CSS | 暗色主题为主 |
| **UI 动画** | @vueuse/motion | 悬浮球、面板过渡动画 |
| **Markdown** | marked | 消息渲染 |
| **PDF 解析** | pdfjs-dist | 知识库文档索引 |
| **向量化** | @huggingface/transformers | 本地 embedding 模型 |
| **桌面框架** | Tauri v2 | 多窗口 WebView |
| **后端语言** | Rust 2021 Edition | 系统级调用 |
| **数据库** | SQLite (tauri-plugin-sql) | 本地文件存储 |
| **剪贴板** | arboard (Rust) | 跨平台，支持 CF_HTML |
| **截图** | screenshots (Rust) | 多显示器支持 |
| **窗口检测** | windows-sys + uiautomation | Win32 API |

---

## 窗口体系

每个 Tauri WebView 窗口拥有 **完全独立的 JavaScript 执行上下文**，这意味着：

> **Pinia stores 在不同窗口之间不共享。** `main` 窗口的 `useProjectStore().currentProjectId` 与 `review_wizard` 窗口的同名 state 是两套独立的数据。跨窗口状态同步必须通过 Tauri Event (`emit`/`listen`) 或后端数据库。

| 窗口 | 标签 | URL 参数 | 默认状态 | 核心功能 |
|------|------|----------|----------|----------|
| **悬浮球** | `widget` | `?window=widget` | 可见 | 全局入口，边缘吸附，上下文感知 |
| **主窗口** | `main` | `?window=main` | 隐藏 | AI 聊天、侧边栏导航、项目管理 |
| **快捷菜单** | `popup` | `?window=popup` | 隐藏 | 剪贴板智能处理（翻译/润色/引文） |
| **截图遮罩** | `capture` | `?window=capture` | 隐藏 | 全屏选区、视觉提取 |
| **结果窗口** | `result` | `?window=result` | 隐藏 | 流式结果展示、一键复制 |
| **综述向导** | `review_wizard` | `?window=review_wizard` | 隐藏 | 文献综述生成（Zotero/KB/DOI） |
| **哨兵简报** | `sentinel_brief` | `?window=sentinel_brief` | 隐藏 | 新文献推送简报 |
| **实验快照** | `experiment_snapshot` | `?window=experiment_snapshot` | 隐藏 | 实验过程记录面板 |

窗口路由由 `App.vue` 根据 `URLSearchParams(window.location.search).get('window')` 决定渲染哪个组件。

---

## 功能模块详解

### Phase 0 — 基础设施

#### 0.1 窗口活动检测 (`window_detector`)
- **技术实现**: Rust 侧通过 `windows-sys` 调用 `GetForegroundWindow` + `GetWindowThreadProcessId` + 进程名白名单映射
- **检测类型**: `PdfReader` / `CodeEditor` / `Browser` / `WritingApp` / `Zotero` / `Unknown`
- **联动**: 进入 PDF 阅读器时自动注册 `Ctrl+Shift+1/2/3` 快捷键，触发阅读助手功能；离开时注销，避免热键冲突
- **事件**: 每 3 秒轮询，通过 `window:activity-changed` 事件广播到所有窗口

#### 0.2 事件采集 (`event_collector`)
- **技术实现**: Rust 侧 `EventCollector` 持有一个内存队列，后台任务每 30 秒 flush 到 SQLite `activity_events` 表
- **采集事件**: `app_open`, `pdf_open`, `pdf_close`, `chat_message`, `screenshot_capture`, `zotero_sync`, `reading_session_start`, `synthesis_start`, `kb_index_start/complete`
- **联动**: 为 Dashboard 数据面板提供统计来源；为 Usage 计费追踪提供原始数据

---

### Phase 1 — AI 对话核心

#### 1.1 AI 客户端 (`utils/aiClient.ts`)
- **接口**: `AIClient.chatStream(messages, callbacks, useVision)` / `AIClient.chatSingle(messages, useVision)`
- **技术实现**:
  - 文本模型使用 SSE 流式输出（`fetch` + `ReadableStream` 解析）
  - Vision 模型使用非流式 JSON 响应（兼容性更好）
  - 支持 `AbortController` 中途取消
  - 内置 token 估算（字符数 / 4）和费用计算
- **模型路由**: `settings.ts` 中定义 `TaskRoutingRule`，按 `taskType` 自动选择首选模型和 fallback 模型

#### 1.2 对话历史 (`stores/history.ts` + `useDatabase.ts`)
- **存储**: SQLite `conversations` + `messages` 表
- **联动**: 切换 project 时自动过滤对话；支持会话摘要（`summary` 字段）用于上下文注入

#### 1.3 欢迎面板 (`components/WelcomePanel.vue`)
- 首次启动引导，展示功能概览和快捷键说明

---

### Phase 2 — 设置与配置

#### 2.1 设置面板 (`components/SettingsPanel.vue`)
- **配置项**:
  - **Text/Vision Model**: 8 个预设提供商（OpenAI / DeepSeek / Kimi / 百炼 / 智谱 / 阶跃 / MiniMax / Custom）
  - **翻译语言**: 15 种语言，支持自动检测
  - **外部工具**: Zotero 集合选择、Obsidian Vault 路径
  - **隐私模式**: 关闭事件采集
- **跨窗口同步**: 设置保存后触发 `settings-updated` Tauri Event，所有窗口的 Pinia store 监听并刷新
- **持久化**: `settings` 表单条 key-value 存储（JSON 序列化）

#### 2.2 项目系统 (`stores/projects.ts`)
- **模型**: Project { id, name, color, keywords[], folderPath, zoteroCollection, obsidianVault, citationStyle }
- **联动**:
  - 切换项目 → KnowledgePanel 自动过滤该项目文档
  - 切换项目 → Dashboard 显示该项目统计
  - 切换项目 → Zotero 同步可限定集合
  - 项目可绑定 Obsidian Vault，笔记一键写入

---

### Phase 3 — 阅读与文献助手

#### 3.1 剪贴板智能处理 (`PopupWindow.vue`)
- **触发**: `Alt + Q` 全局快捷键
- **流程**:
  1. 读取当前剪贴板文本
  2. 根据当前窗口类型（写作/PDF/浏览器）动态调整菜单项
  3. 用户选择操作（翻译/润色/净化/引文推荐/引文格式化）
  4. AI 处理 → 结果写入剪贴板（Markdown 通过 `set_clipboard_html` 以 CF_HTML 格式写入，支持带格式粘贴到 Word）
- **技术栈**: `arboard` (Rust) + `windows-sys` (CF_HTML) + `aiClient.chatStream`

#### 3.2 阅读伴侣 (Reading Companion)
- **触发**: 检测到 PDF 阅读器为活动窗口时，自动注册 `Ctrl+Shift+1/2/3`
  - `Ctrl+Shift+1`: 打开阅读笔记面板（基于当前选中文本生成笔记）
  - `Ctrl+Shift+2`: 截图提取公式
  - `Ctrl+Shift+3`: 截图提取表格
- **阅读会话追踪** (`composables/useReadingSession.ts`):
  - 进入 PDF 时 `startReadingSession`，记录 `document_title`, `document_path`, `start_page`
  - 每 10 秒检测当前页码（通过 `pdf_detection::estimate_pdf_page`）
  - 离开 PDF 时 `endReadingSession`，计算阅读时长和页数
  - 数据存入 `reading_sessions` 表，用于 Dashboard 统计和"继续阅读"推荐

#### 3.3 文本选择与注入 (`text_selection` / `text_injection`)
- **选择**: Rust 侧使用 Windows UI Automation API 获取当前焦点元素的选中文本
- **注入**: 模拟键盘输入替换选中文本（`replace_selected_text`）或追加输入（`simulate_text_input`）
- **联动**: 润色/翻译后的结果可直接注入回原编辑器，无需手动复制粘贴

#### 3.4 PDF 内容检测 (`pdf_detection`)
- **功能**: 检测当前活动窗口是否为 PDF 阅读器，尝试获取文档路径和当前页码
- **实现**: 进程名白名单（Acrobat, SumatraPDF, Chrome, Edge 等）+ 窗口标题正则解析

#### 3.5 内容类型检测 (`content_type_detection`)
- **功能**: 分析页面内容是否包含可提取元素（公式、表格、代码块）
- **联动**: 截图提取时自动推荐最可能的提取类型

---

### Phase 4 — 视觉提取与实验记录

#### 4.1 截图提取 (`CaptureWindow.vue`)
- **触发**: `Alt + S`
- **流程**:
  1. Rust `screenshot::capture_fullscreen` 捕获全屏（多显示器自动识别）
  2. 前端显示全屏遮罩，支持拖拽选区
  3. 用户选择提取类型（公式/表格/文本/伪代码）
  4. Rust `screenshot::capture_region` 裁剪选区
  5. 隐藏 capture 窗口，显示 result 窗口
  6. AI Vision 模型流式处理，实时展示进度
  7. 结果自动写入剪贴板
- **预设支持**: 可通过 `capture:preset` 事件（如阅读伴侣热键触发）自动选择提取类型

#### 4.2 实验快照 (`experiment.rs` / `ExperimentSnapshotWindow.vue`)
- **触发**: `Alt + E`
- **功能**: 记录实验过程中的截图、代码、终端输出、语音备注
- **数据模型**: `ExperimentSnapshot` { title, snapshot_type, parameters, notes, screenshot_path, audio_path, tags }
- **存储**: 当前使用 Rust 侧内存存储（`Mutex<Vec>`），前端计划迁移到 SQLite
- **联动**: 快照可关联项目，用于后续实验复盘和报告撰写

#### 4.3 文献哨兵 (`sentinel.rs` / `SentinelPanel.vue`)
- **功能**: 自动检索 arXiv 和 Semantic Scholar，追踪领域最新文献
- **实现**:
  - `search_arxiv_command`: 关键词 → arXiv Atom API → 解析 XML
  - `search_semantic_scholar_command`: 关键词 → Semantic Scholar API
  - `infer_research_directions_command`: 基于用户近期对话和阅读记录推断研究方向
- **联动**: 检测到新论文时，通过 `sentinel:new-papers` 事件通知 Widget 显示未读计数角标；点击打开 `sentinel_brief` 窗口展示简报

---

### Phase 5 — 文献综述、插件与团队

#### 5.1 文献综述生成 (`ReviewWizardWindow.vue`)
- **入口**: KnowledgePanel 点击"生成综述"
- **数据源**: Zotero 缓存 / 知识库文档 / DOI 手动输入
- **流程**:
  1. Step 1: 选择来源（Zotero / KB / DOI）
  2. Step 2: 选择具体文献（复选框列表）
  3. Step 3: 配置综述风格（学术综述/调研简报/简要概述）+ 聚焦方向
  4. Step 4: AI Map-Reduce 生成（每批 3 篇并行分析 → 汇总生成 5 个章节）
- **技术细节**:
  - `taskType: 'literature_review'` 通过 `aiClient.selectProfiles()` 路由到长上下文模型
  - 超时 120 秒
  - KB 文档通过 `loadDocChunks` 获取全文内容注入 prompt
- **跨窗口数据加载**: 由于 Pinia store 隔离，`loadKbItems()` 直接调用 `loadKnowledgeDocs(undefined)` 加载所有项目文档，而非依赖 `kbStore.projectDocuments`

#### 5.2 插件市场 (`plugin.rs` / `PluginPanel.vue`)
- **架构**:
  - **Manifest**: `PluginManifest` { id, name, version, permissions, menu_items, slash_commands }
  - **Registry**: 内置 5 个示例插件（BLAST Helper, Molecule Drawer, LaTeX Formatter, Citation Validator, Word Cloud Generator）
  - **Storage**: Rust 侧内存存储（`Mutex<Vec<PluginDef>>` + `Mutex<Vec<PluginSetting>>`）
- **命令**: `get_plugin_registry`, `list_plugins`, `install_plugin`, `uninstall_plugin`, `toggle_plugin`, `get_plugin_settings`, `set_plugin_setting`, `get_plugin_menu_items`
- **扩展点**: 插件可注册剪贴板菜单项、斜杠命令、全局操作

#### 5.3 团队科研空间 (`team.rs` / `TeamPanel.vue`)
- **模型**: Team { id, name, sync_mode, encryption_key, owner_id } / TeamMember { role } / TeamActivity / TeamInvite
- **功能**:
  - 创建/加入团队（邀请码机制）
  - 成员角色管理（owner / member / viewer）
  - 团队活动流（文献分享、实验快照同步、阅读笔记共享）
- **存储**: Rust 侧内存存储（`Mutex`），计划对接后端服务实现 P2P 或 Server 同步

---

## 数据库设计

SQLite 数据库文件：`{app_data_dir}/ai_research_assistant.db`

| 表名 | 用途 | 关键字段 |
|------|------|----------|
| `settings` | 应用配置 | `key`, `value` (JSON) |
| `projects` | 科研项目 | `id`, `name`, `color`, `keywords`, `folder_path`, `zotero_collection`, `obsidian_vault`, `citation_style` |
| `conversations` | 对话会话 | `id`, `title`, `project_id`, `summary`, `created_at`, `updated_at` |
| `messages` | 消息记录 | `id`, `conversation_id`, `role`, `content`, `created_at` |
| `project_todos` | 项目待办 | `id`, `project_id`, `content`, `priority`, `status`, `created_at`, `completed_at` |
| `activity_events` | 行为事件 | `id`, `event_type`, `timestamp`, `project_id`, `duration_ms`, `resource_id`, `metadata` |
| `usage_records` | AI 用量 | `id`, `timestamp`, `task_type`, `model_name`, `input_tokens`, `output_tokens`, `latency_ms`, `estimated_cost` |
| `knowledge_docs` | 知识库文档 | `id`, `project_id`, `file_path`, `file_name`, `file_type`, `total_pages`, `index_status` |
| `doc_chunks` | 文档分块 | `id`, `doc_id`, `content`, `page_number`, `chunk_index`, `embedding` |
| `zotero_items_cache` | Zotero 文献缓存 | `id`, `key`, `item_type`, `title`, `creators`, `abstract`, `url`, `doi`, `date`, `publication`, `tags`, `collections`, `json_data`, `version`, `synced_at` |
| `zotero_collections_cache` | Zotero 集合缓存 | `id`, `key`, `name`, `parent_key`, `version`, `synced_at` |
| `reading_sessions` | 阅读会话 | `id`, `project_id`, `document_title`, `document_path`, `start_page`, `end_page`, `pages_read`, `duration_seconds`, `started_at`, `ended_at` |
| `reading_notes` | 阅读笔记 | `id`, `session_id`, `page_number`, `content`, `created_at` |
| `experiment_snapshots` | 实验快照 | `id`, `project_id`, `title`, `snapshot_type`, `parameters`, `notes`, `screenshot_path`, `audio_path`, `tags`, `created_at` |
| `sentinel_papers` | 哨兵文献 | `id`, `project_id`, `title`, `authors`, `abstract`, `url`, `source`, `published_at`, `is_read`, `created_at` |
| `sentinel_checks` | 哨兵检查记录 | `id`, `project_id`, `keywords`, `source`, `results_count`, `created_at` |
| `sentinel_topics` | 哨兵追踪主题 | `id`, `project_id`, `topic`, `keywords`, `is_active`, `created_at` |
| `plugins` | 已安装插件 | `id`, `name`, `version`, `enabled`, `manifest`, `created_at` |
| `plugin_settings` | 插件配置 | `plugin_id`, `key`, `value` |
| `teams` | 团队 | `id`, `name`, `sync_mode`, `encryption_key`, `owner_id` |
| `team_members` | 团队成员 | `team_id`, `user_id`, `user_name`, `role`, `joined_at` |
| `team_activities` | 团队活动 | `id`, `team_id`, `user_id`, `activity_type`, `title`, `content`, `created_at` |
| `team_invites` | 团队邀请 | `id`, `team_id`, `invite_code`, `role`, `expires_at` |

**初始化**: `useDatabase.ts` 中的 `initDatabase()` 在应用启动时自动创建所有表，并通过 `try/catch ALTER TABLE` 实现增量迁移。

---

## 后端模块 (Rust)

### `lib.rs` — 应用入口与全局状态
- **AppState**: 共享状态 `{ window_detector, current_window, event_collector, text_selector }`
- **插件初始化**: `tauri-plugin-sql`, `tauri-plugin-global-shortcut`, `tauri-plugin-http`, `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-store`, `tauri-plugin-opener`
- **热键注册**: `Alt+Q` (popup), `Alt+S` (capture), `Alt+E` (experiment snapshot)
- **动态热键**: `Ctrl+Shift+1/2/3` 在检测到 PDF 阅读器时注册，离开时注销
- **窗口关闭保护**: `review_wizard` 的 `CloseRequested` 事件拦截，改为 `hide()` 防止窗口被销毁后无法重新打开
- **轮询任务**: `tokio::time::interval(3s)` 检测活动窗口，触发 PDF 进入/离开逻辑

### `app_control.rs` — 应用控制与外部 API 代理
| 命令 | 功能 |
|------|------|
| `quit_app` | 退出应用 |
| `show_popup_with_clipboard` | 读取剪贴板并显示 popup 窗口 |
| `show_popup_with_action` | 显示 popup 并预设 action（如 reading_note） |
| `show_window_with_settings` | 显示主窗口并打开设置面板 |
| `write_text_file` | 写入文本文件（Obsidian 笔记导出） |
| `check_file_exists` | 检查文件是否存在 |
| `fetch_zotero` | 代理 Zotero 本地 HTTP API (127.0.0.1:23119) 请求 |

### `clipboard.rs` — 剪贴板操作
| 命令 | 功能 |
|------|------|
| `get_clipboard_text` | 获取纯文本 |
| `set_clipboard_text` | 设置纯文本 |
| `set_clipboard_html` | 设置 CF_HTML 格式（Windows 专用，支持富文本粘贴到 Word） |

### `screenshot.rs` — 屏幕截图
| 命令 | 功能 |
|------|------|
| `capture_fullscreen` | 捕获全屏（多显示器支持）返回 Base64 PNG |
| `capture_region` | 捕获指定区域（自动识别对应显示器） |
| `trigger_capture` | 触发 capture 窗口显示 |

### `window_manager.rs` — 窗口管理
| 命令 | 功能 |
|------|------|
| `show_window` / `hide_window` | 显示/隐藏窗口 |
| `resize_window` | 调整窗口大小 |
| `center_window` | 窗口居中 |
| `set_widget_position` | 设置悬浮球位置 |
| `snap_widget_to_bounds` | 边缘吸附计算 |
| `get_primary_monitor_frame` | 获取主显示器尺寸 |
| `result_window_ready` / `wait_for_result_window_ready` | result 窗口就绪信号 |

### `window_detector.rs` — 窗口活动检测
- **实现**: Windows `EnumWindows` + `GetWindowTextW` + `GetWindowThreadProcessId`
- **映射规则**: 进程名 → `AppType` (PdfReader / CodeEditor / Browser / WritingApp / Zotero)
- **输出**: `WindowInfo` { process_name, window_title, app_type, document_path }

### `event_collector.rs` — 事件采集
- **内存队列**: `Vec<EventRecord>`，后台 tokio 任务每 30s flush
- **批量写入**: `INSERT INTO activity_events` 批量事务
- **命令**: `record_event`, `set_incognito_mode`, `flush_events`

### `text_selection.rs` / `text_injection.rs`
- **选择**: Windows UI Automation API (`uiautomation` crate) 获取当前焦点元素选中文本
- **注入**: `replace_selected_text` 先删除后输入；`simulate_text_input` 直接模拟键盘

### `pdf_detection.rs`
- **命令**: `get_current_pdf_path`, `estimate_pdf_page`
- **实现**: 进程白名单 + 窗口标题正则匹配（如 "Page (\d+)"）

### `content_type_detection.rs`
- **命令**: `detect_page_content_types`, `has_extractable_content`
- **实现**: 基于 OCR 或 UIA 文本分析，检测公式、表格、代码块特征

### `sentinel.rs` — 文献哨兵
- **arXiv 搜索**: `export.arxiv.org/api/query` Atom XML 解析
- **Semantic Scholar**: `api.semanticscholar.org` REST API
- **方向推断**: 基于近期对话关键词和阅读记录聚合生成搜索关键词

### `experiment.rs` — 实验快照
- **当前状态**: Rust 内存存储，计划对接前端 SQLite
- **命令**: `save_experiment_snapshot`, `get_experiment_snapshots`, `search_experiment_snapshots`, `delete_experiment_snapshot`, `trigger_experiment_screenshot`

### `plugin.rs` — 插件系统
- **存储**: 内存 `Mutex<Vec<PluginDef>>`
- **注册表**: 硬编码 5 个示例插件
- **命令**: 安装/卸载/开关/设置/菜单项查询

### `team.rs` — 团队空间
- **存储**: 内存 `Mutex`
- **命令**: CRUD + 成员管理 + 邀请码 + 活动流

---

## 前端架构 (Vue)

### 窗口组件 (`src/windows/`)

| 组件 | 职责 | 关键依赖 |
|------|------|----------|
| `WidgetWindow.vue` | 悬浮球入口，边缘吸附，上下文感知，未读角标 | `useWindow`, `useReadingSession`, `usePdfDetection`, `useContentDetection` |
| `MainWindow.vue` | AI 聊天主界面，侧边栏路由，项目管理 | `aiClient`, `useHistoryStore`, `useProjectStore`, `useKnowledgeBaseStore` |
| `PopupWindow.vue` | 剪贴板处理，翻译/润色/引文/阅读笔记 | `aiClient`, `useClipboard`, `useTextInjection`, `zoteroBridge`, `obsidianBridge` |
| `CaptureWindow.vue` | 全屏截图选区，视觉提取 | `useScreenshotSelection`, `aiClient` |
| `ResultWindow.vue` | 流式结果展示 | `listen('extraction-complete')`, `listen('extraction-error')` |
| `ReviewWizardWindow.vue` | 文献综述向导 | `aiClient`, `zoteroBridge`, `useDatabase.loadKnowledgeDocs/loadDocChunks` |
| `SentinelBriefWindow.vue` | 新文献简报展示 | `listen('sentinel:new-papers')` |
| `ExperimentSnapshotWindow.vue` | 实验快照面板 | `invoke('experiment:...')` |

### 状态管理 (Pinia Stores)

> **重要**: 每个 WebView 窗口拥有独立的 Pinia 实例。跨窗口状态必须通过 Tauri Event 或后端数据库同步。

| Store | 文件 | 职责 | 持久化 |
|-------|------|------|--------|
| `settings` | `stores/settings.ts` | AI 配置、模型预设、翻译语言、路由规则 | SQLite `settings` 表 |
| `history` | `stores/history.ts` | 对话历史、当前会话 | SQLite `conversations` + `messages` |
| `projects` | `stores/projects.ts` | 项目列表、当前项目 | SQLite `projects` |
| `knowledgeBase` | `stores/knowledgeBase.ts` | 知识库文档、搜索状态、embedder 加载 | SQLite `knowledge_docs` |
| `usage` | `stores/usage.ts` | API 用量统计 | SQLite `usage_records` |

### 组合式函数 (`src/composables/`)

| Composable | 职责 | 后端命令 |
|------------|------|----------|
| `useWindow.ts` | 窗口显示/隐藏/移动/关闭 | `show_window`, `hide_window`, `resize_window`, `center_window` 等 |
| `useClipboard.ts` | 剪贴板读写 | `get_clipboard_text`, `set_clipboard_text`, `set_clipboard_html` |
| `useDatabase.ts` | SQLite CRUD 封装 | `sql:allow-load`, `sql:allow-select`, `sql:allow-execute` |
| `useEvents.ts` | 事件采集辅助 | `record_event`, `set_incognito_mode` |
| `useScreenshotSelection.ts` | 截图选区计算 | 纯前端 Canvas 坐标映射 |
| `useTextSelection.ts` | 获取选中文本 | `get_selected_text`, `get_selected_text_via_clipboard` |
| `useTextInjection.ts` | 文本注入 | `replace_selected_text`, `simulate_text_input` |
| `usePdfDetection.ts` | PDF 路径/页码检测 | `get_current_pdf_path`, `estimate_pdf_page` |
| `useContentDetection.ts` | 内容类型检测 | `detect_page_content_types`, `has_extractable_content` |
| `useReadingSession.ts` | 阅读会话追踪 | `createReadingSession`, `updateReadingSession` (DB) |
| `useSessionSummary.ts` | 会话摘要生成 | 调用 `aiClient` |
| `useProgress.ts` | 伪进度条 | 纯前端 |

### 工具库 (`src/utils/`)

| 工具 | 职责 |
|------|------|
| `aiClient.ts` | OpenAI-compatible API 客户端，流式/非流式，模型路由，token 估算 |
| `zoteroBridge.ts` | Zotero 本地 API 客户端，同步/搜索/缓存/引文格式化 |
| `obsidianBridge.ts` | Obsidian Vault 笔记写入 |
| `knowledgeBase.ts` | 知识库索引、语义搜索、向量相似度计算 |
| `embedder.ts` | HuggingFace transformers.js 本地 embedding 模型加载 |
| `pdfExtractor.ts` | PDF 文本提取（pdfjs-dist） |
| `textChunker.ts` | 文本分块（固定长度 + 重叠） |

---

## 功能联动关系

```
Widget (悬浮球)
  ├── 双击 → MainWindow (AI 聊天)
  ├── 单击 → PopupWindow (剪贴板处理)
  ├── Alt+Q → PopupWindow
  ├── Alt+S → CaptureWindow → ResultWindow
  ├── Alt+E → ExperimentSnapshotWindow
  ├── 检测到 PDF → 注册 Ctrl+Shift+1/2/3
  │     ├── Ctrl+Shift+1 → PopupWindow (reading_note)
  │     ├── Ctrl+Shift+2 → CaptureWindow (formula preset)
  │     └── Ctrl+Shift+3 → CaptureWindow (table preset)
  └── 哨兵新文献角标 → 点击打开 SentinelBriefWindow

MainWindow (AI 聊天)
  ├── 侧边栏 KnowledgePanel
  │     ├── 知识库管理 → knowledgeBase store → SQLite
  │     ├── Zotero 同步 → zoteroBridge → Zotero API
  │     └── 生成综述 → ReviewWizardWindow
  ├── 侧边栏 LiteratureSidebar
  │     └── Zotero 文献浏览/引用
  ├── 侧边栏 SentinelPanel
  │     └── 文献哨兵配置/结果
  ├── 侧边栏 ExperimentPanel
  │     └── 实验快照查看
  ├── 侧边栏 DashboardPanel
  │     └── 统计数据 ← activity_events / usage_records
  ├── 侧边栏 PluginPanel
  │     └── 插件安装/管理
  ├── 侧边栏 TeamPanel
  │     └── 团队管理
  └── 项目切换 → 联动过滤所有项目相关数据

KnowledgeBase (知识库)
  ├── 添加文件夹 → pdfExtractor 提取文本 → textChunker 分块
  │     → embedder 计算向量 → SQLite doc_chunks
  ├── 搜索 → embedder 编码查询 → 向量相似度排序 → 返回 Top-K
  └── AI 聊天时自动注入相关 chunks 作为上下文

Settings (设置)
  ├── 修改模型配置 → emit 'settings-updated' → 所有窗口刷新
  └── 隐私模式 → setIncognitoMode → 停止 event_collector 记录
```

---

## 开发指南

### 添加新的 Rust 命令

1. 在对应模块文件中添加 `#[tauri::command]` 函数
2. 在 `lib.rs` 的 `invoke_handler!` 宏中注册
3. 如果涉及数据库操作，在前端 `useDatabase.ts` 中添加封装函数
4. **权限**: 如果新窗口需要调用，更新 `src-tauri/capabilities/default.json` 的 `windows` 数组

### 添加新窗口

1. `tauri.conf.json` → `app.windows` 添加窗口配置
2. `App.vue` → 添加 `v-else-if="windowType === 'new_window'"` 路由
3. 创建 `src/windows/NewWindow.vue`
4. `default.json` → `windows` 数组添加新窗口标签（否则 SQL/HTTP 等权限会被拒绝）
5. `lib.rs` 中注册 `on_window_event` 处理关闭行为（如需要防止销毁）

### 跨窗口通信

```typescript
// 发送事件
import { emit } from '@tauri-apps/api/event';
await emit('my-custom-event', { data: 'hello' });

// 接收事件
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen('my-custom-event', (event) => {
  console.log(event.payload);
});
// 记得在 onUnmounted 中调用 unlisten()
```

### 数据库迁移

`useDatabase.ts` 的 `initDatabase()` 使用 `try/catch` 包裹 `ALTER TABLE` 实现增量迁移：

```typescript
try {
  await db.execute(`ALTER TABLE existing_table ADD COLUMN new_field TEXT`);
} catch {
  // Column already exists — ignore
}
```

新表直接使用 `CREATE TABLE IF NOT EXISTS`。

### 模型路由扩展

在 `stores/settings.ts` 中：
1. 扩展 `TaskType` 联合类型
2. 在 `routingConfig` 的 `defaultRules` 中添加新的 `TaskRoutingRule`
3. 在 `aiClient.ts` 的 `selectProfiles()` 中确保新 taskType 被正确处理

---

## 常见问题

**Q: 新窗口调用 SQL/HTTP/FS 报错 "not allowed on window X"？**
A: 检查 `src-tauri/capabilities/default.json`，确保窗口标签在 `windows` 数组中。Tauri v2 的 Capability 系统按窗口名精确匹配权限。

**Q: 窗口关闭后无法重新打开？**
A: 检查 `lib.rs` 中是否为该窗口注册了 `CloseRequested` 事件拦截。如果窗口被原生关闭按钮销毁（而非 `hide()`），Tauri 不会自动重新创建。

**Q: Pinia store 数据在不同窗口不一致？**
A: 这是预期行为。每个 WebView 有独立的 JS 上下文。跨窗口共享状态请使用 Tauri Event 或后端数据库。

**Q: 富文本粘贴到 Word 失败？**
A: CF_HTML 格式仅在 Windows 上受支持（`windows-sys` 实现）。macOS/Linux 会回退到纯文本。

**Q: 截图快捷键不生效？**
A: 检查是否有其他软件占用了 `Alt+Q` / `Alt+S`。如果冲突，需要修改 `lib.rs` 中的快捷键注册逻辑。

**Q: Embedding 模型下载失败？**
A: 检查网络是否能访问 HuggingFace。可在设置中配置镜像地址（`hf-mirror.com`）。

**Q: Zotero 同步返回 0 条文献？**
A: 确保 Zotero 桌面客户端已打开，且已启用本地 API（Edit → Preferences → Advanced → Allow other applications...）。

---

## 许可证

MIT License

## 致谢

- [Tauri](https://tauri.app/) — 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) — 渐进式 JavaScript 框架
- [TailwindCSS](https://tailwindcss.com/) — 实用优先的 CSS 框架
- [Vite](https://vitejs.dev/) — 下一代前端构建工具
- [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js) — 浏览器端机器学习
