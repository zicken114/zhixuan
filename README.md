# AI Research Assistant (科研悬浮小助手)

一款专为科研人员打造的 AI 桌面辅助工具,基于 **Tauri v2 + Vue 3 + Rust** 构建。
集成了对话、视觉提取、本地知识库、Zotero/Obsidian 双向桥接、多模型智能路由与用量统计,
全数据本地化(SQLite),无后台轮询、无静默监听。

---

## 功能特性

### 一、即时工具(快捷键驱动)

1. **桌面悬浮球 (Widget)**
   - 60×60 圆形小球,始终置顶、透明背景、可拖拽
   - 松手后自动吸附到屏幕左/右边缘,鼠标离开自动收缩为细长条
   - 单击 → 打开快捷菜单(Popup);双击 → 打开主窗口(Main)

2. **魔法快捷菜单 (Popup)** — `Alt + Q`
   - 基于剪贴板内容快速处理:🌍 翻译 / 🧹 净化转 Word / 📚 格式化引文
   - **上下文感知**:在写作类应用中(Word / WPS / Typora 等)额外显示 📖 推荐引文
   - 配置 Obsidian Vault 后追加 📝 一键存档至 Obsidian
   - 处理结果自动写入剪贴板,支持中途取消

3. **视觉提取引擎 (Capture)** — `Alt + S`
   - 全屏截图后框选任意区域,选区显示像素尺寸
   - 4 种提取模式:公式 → LaTeX、表格 → Markdown、纯文本 OCR、伪代码/流程图
   - 截图层自动隐藏("解放屏幕"),独立结果窗口实时流式输出
   - Markdown 结果以 CF_HTML 写入剪贴板,可带格式粘贴到 Word

### 二、AI 聊天与会话管理

4. **AI 聊天助手 (Main Window)**
   - 流式对话 + 历史会话切换/删除/搜索,持久化在 SQLite
   - 支持向消息中拖入截图/文件用于多模态对话
   - 长对话自动维护 `summary` 字段,跨会话注入上下文
   - 首次启动显示欢迎引导;无边框透明背景,标题栏拖拽

### 三、研究项目工作区

5. **项目空间 (Projects)**
   - 多研究项目并行,每个项目可绑定:关键词、本地论文文件夹、Zotero 集合、Obsidian Vault
   - 项目切换时聊天历史、知识库、Todo 同步切换
   - 内置 **Todo 面板**:per-project 任务清单(高/中/低优先级),AI 可在对话中建议待办

### 四、本地知识库与语义检索

6. **知识库 (Knowledge Base)**
   - 拖入 PDF → 自动解析(`pdfjs-dist`)→ 分段(`textChunker`)→ 嵌入(`Xenova/all-MiniLM-L6-v2`,本地 384 维向量)
   - 模型首次使用时自动从 [HF Mirror](https://hf-mirror.com/) 下载并缓存(~22 MB,通过 Tauri 后端 fetch 绕过 CORS)
   - **kbAutoRetrieve** 开启后,聊天提问时自动检索 Top-K 相关片段注入上下文
   - 索引状态可视化:pending → indexing → completed / error

### 五、文献管理双向桥接

7. **Zotero 集成**
   - 通过 Zotero 本地 HTTP API(`127.0.0.1:23119`)同步,Rust 后端代理绕过 CORS
   - 元数据缓存进 SQLite,支持离线全文搜索
   - 一键格式化引文(GB7714 / APA / IEEE),从 PopupWindow 即可推荐引用

8. **Obsidian 集成**
   - 直接写入 Vault 文件夹(YAML frontmatter + 自动标签 + 反向链接)
   - 3 种笔记模板:summary / full / qa
   - 可通过 `obsidian://` URI 打开生成的笔记

### 六、多模型智能路由

9. **Routing(任务级模型路由)**
   - 7 类任务,每类可独立配置首选模型 + 多级 Fallback + 超时时长:
     - `chat` / `translation` / `vision_extraction` / `literature_review` / `citation_format` / `text_cleanup` / `polish`
   - 主模型失败(超时/错误)时自动降级,Fallback 链按顺序重试
   - 模型 Profile 由设置中的 ProviderKeys 自动构建,启用/禁用可控

10. **预设模型提供商(8 种,一键切换)**

| 预设 | Base URL | 文本模型 | 视觉模型 |
|------|----------|----------|----------|
| OpenAI | `api.openai.com/v1` | gpt-4o | gpt-4o |
| DeepSeek | `api.deepseek.com/v1` | deepseek-chat | — |
| Kimi | `api.moonshot.cn/v1` | kimi-k2.5 | kimi-k2.5 |
| 阿里百炼 | `dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus | qwen-vl-max |
| 智谱 GLM | `open.bigmodel.cn/api/paas/v4` | glm-5 | glm-4.6v |
| StepFun | `api.stepfun.com/v1` | step-3.5-flash | step-1v-8k |
| MiniMax | `api.minimaxi.com/v1` | MiniMax-M2.5 | — |
| Custom | 手动输入 | 手动输入 | 手动输入 |

### 七、用量统计与隐私

11. **Usage 统计**
   - 每次 AI 调用记录:模型、任务类型、输入/输出 tokens、延迟、成功与否、是否走 Fallback、估算成本
   - UsageStore 提供 today / 7d / 30d 维度统计,在主窗口侧边栏可查看

12. **Activity Collector(可选)**
   - Rust 端环形缓冲区(容量 100,30s 周期 flush)记录窗口切换、PDF 打开/关闭、剪贴板/截图操作类型(无内容)
   - 全部数据存本地 SQLite,**仅用于自身的活动回顾**
   - **隐私模式 (Incognito)**:开启后停止一切事件与用量记录

### 八、设计理念

**User-Driven(用户主动决策)**:
- ❌ 无后台轮询、无静默剪贴板监听、无全局划词监听
- ✅ 所有 AI 调用由用户主动触发(快捷键 / 点击 / 拖入文件)
- ✅ 所有数据本地存储,远端 API 仅在调用时传输

---

## 技术栈

### 前端

| 类别 | 依赖 |
|------|------|
| 框架 | **Vue 3** (Composition API) + **TypeScript** |
| 构建 | Vite 6 |
| 状态 | Pinia 3(每个 WebView 独立 store,通过 Tauri 事件跨窗口同步) |
| 样式 | Tailwind CSS v4 + PostCSS + 自定义 CSS |
| 动画 | @vueuse/motion |
| 工具 | @vueuse/core / marked / pdfjs-dist |
| AI | OpenAI-compatible REST + SSE |
| 嵌入 | **@huggingface/transformers**(浏览器端推理) |

### 后端 (Tauri / Rust)

| Crate / 插件 | 用途 |
|-----|------|
| `tauri` v2 | 跨平台桌面框架 |
| `tauri-plugin-sql` (sqlite) | 本地数据库 |
| `tauri-plugin-store` | 旧版配置回退 |
| `tauri-plugin-global-shortcut` | Alt+Q / Alt+S 全局热键 |
| `tauri-plugin-dialog` | 文件夹/文件选择 |
| `tauri-plugin-fs` | 写入 Obsidian Vault、读取 PDF |
| `tauri-plugin-http` | 代理 HuggingFace 镜像 / Zotero 本地 API |
| `tauri-plugin-opener` | `obsidian://` URI 打开 |
| `arboard` | 跨平台剪贴板(含图片) |
| `screenshots` | 多显示器截图 |
| `mouse_position` | 鼠标实时坐标 |
| `image` + `base64` | 图像编码 |
| `rusqlite` | 事件采集器直写数据库 |
| `windows-sys` | Win32 API(CF_HTML 富文本剪贴板、活动窗口检测) |
| `reqwest` | 后端代理 HTTP 请求 |

---

## 安装与运行

### 必需环境

1. **Node.js** ≥ v20(最低 v18.18)
2. **Rust** 最新稳定版 → https://www.rust-lang.org/tools/install
3. **Tauri 系统依赖** → https://tauri.app/start/prerequisites/
   - Windows: Microsoft Visual C++ Build Tools

### 步骤

```bash
# 进入项目目录
cd ai-research-assistant

# 安装前端依赖
npm install

# 开发模式运行(自动开启 5 个窗口)
npm run tauri dev

# 构建生产版本
npm run tauri build
```

> 首次进入 KB 索引会自动下载 `Xenova/all-MiniLM-L6-v2` 模型(约 22MB,默认走 hf-mirror.com)。
> 可在设置中改为 `https://huggingface.co/` 直连。

---

## 项目结构

```
ai-research-assistant/
├── src/                                # Vue 前端源码
│   ├── windows/                        # 5 个独立 WebView
│   │   ├── WidgetWindow.vue            # 悬浮球(吸附 / 收缩)
│   │   ├── MainWindow.vue              # AI 聊天 + 历史 + 项目 + 知识库
│   │   ├── PopupWindow.vue             # 快捷菜单(Alt+Q,上下文感知)
│   │   ├── CaptureWindow.vue           # 截图选区 + 视觉提取
│   │   └── ResultWindow.vue            # 结果展示(进度条 + 流式预览)
│   ├── components/
│   │   ├── SettingsPanel.vue           # 设置面板(可折叠卡片式)
│   │   ├── WelcomePanel.vue            # 首次启动引导
│   │   ├── ChatHeader.vue              # 聊天标题栏
│   │   ├── ChatInputArea.vue           # 输入框
│   │   ├── ChatMessageList.vue         # 消息列表(空态 / 流式指示器)
│   │   ├── HistoryPanel.vue            # 会话侧边栏
│   │   ├── KnowledgePanel.vue          # 知识库 + Zotero 浏览器
│   │   ├── TodoPanel.vue               # 项目 Todo 列表
│   │   ├── ExtractPromptMenu.vue       # 截图提取类型选择
│   │   ├── ExtractProcessingOverlay.vue
│   │   └── ExtractResultOverlay.vue
│   ├── composables/
│   │   ├── useDatabase.ts              # SQLite 单例 + 全表 CRUD + 迁移
│   │   ├── useEvents.ts                # 事件采集(invoke Rust)+ 隐身模式开关
│   │   ├── useProgress.ts              # 伪进度条
│   │   ├── useClipboard.ts             # 剪贴板读写(含 CF_HTML)
│   │   ├── useWindow.ts                # 窗口管理
│   │   └── useScreenshotSelection.ts   # Canvas 选区裁剪
│   ├── stores/                         # Pinia 状态(跨窗口通过 Tauri 事件同步)
│   │   ├── settings.ts                 # AI 配置 / 路由 / 预设 / 翻译 / 外部工具
│   │   ├── history.ts                  # 会话历史
│   │   ├── projects.ts                 # 研究项目 + Todo
│   │   ├── knowledgeBase.ts            # 文档 / 块 / 检索
│   │   └── usage.ts                    # 用量统计聚合
│   ├── utils/
│   │   ├── aiClient.ts                 # OpenAI 客户端(流式 / 路由 / Fallback)
│   │   ├── embedder.ts                 # Transformers.js 嵌入(HF 镜像代理)
│   │   ├── knowledgeBase.ts            # KB 索引主流程
│   │   ├── textChunker.ts              # PDF 文本分段
│   │   ├── pdfExtractor.ts             # pdfjs-dist 文本抽取
│   │   ├── zoteroBridge.ts             # Zotero 本地 API 同步 + 引文格式化
│   │   └── obsidianBridge.ts           # 写笔记到 Vault + 模板渲染
│   ├── App.vue                         # 根组件(按 ?window= 路由)
│   ├── main.ts                         # bootstrap(Pinia + Motion + DB 初始化)
│   └── style.css                       # 全局样式 + CSS 变量
│
├── src-tauri/                          # Rust 后端
│   ├── src/
│   │   ├── lib.rs                      # Tauri Builder + 插件注册 + 后台任务
│   │   ├── main.rs
│   │   ├── models.rs                   # WindowInfo / AppType / AppEvent
│   │   ├── clipboard.rs                # 文本/HTML 剪贴板指令
│   │   ├── screenshot.rs               # 全屏 / 区域截图
│   │   ├── window_manager.rs           # 5 窗口位置/显隐/吸附指令
│   │   ├── window_detector.rs          # 活动窗口检测(3s 轮询,分类 PDF / Writing / …)
│   │   ├── event_collector.rs          # 事件采集器(环形缓冲 + 30s flush 至 SQLite)
│   │   ├── events.rs                   # Tauri 事件桥接
│   │   └── app_control.rs              # 退出 / 写文件 / 提取 / Zotero 代理
│   ├── capabilities/default.json       # 5 窗口权限配置(sql / fs / http / dialog / shortcut)
│   ├── Cargo.toml
│   └── tauri.conf.json                 # 5 窗口定义 + CSP
│
├── package.json
├── vite.config.ts
├── tailwind.config.js
└── tsconfig.json
```

---

## 窗口架构

应用由 **5 个独立 WebView** 组成,每个有独立的 JS 上下文与 Pinia store。

| 窗口 | 尺寸 | 特性 | 默认状态 |
|------|------|------|----------|
| **widget** | 60×60 | 始终置顶,skipTaskbar,可拖拽吸附 | 可见 |
| **main** | 400×800 | AI 聊天 + 项目 + 知识库,可调整大小 | 隐藏 |
| **popup** | 200×280 | 快捷菜单,跟随鼠标位置 | 隐藏 |
| **capture** | 全屏 | 截图遮罩,crosshair 光标,ESC 取消 | 隐藏 |
| **result** | 480×360 | 结果展示,居中,可调整大小 | 隐藏 |

### 跨窗口设置同步

由于每个 WebView 拥有独立的 Pinia store,主窗口 `SettingsPanel` 保存配置后会通过
`emit('settings-updated')` 广播 Tauri 事件,其他窗口的 settings store 监听后从 SQLite
重新加载,确保 popup / capture / result 永远拿到最新配置。

```typescript
// 写入端
await saveSettings(config);
await emit('settings-updated');

// 监听端(每个窗口 init 时一次性注册)
await listen('settings-updated', () => reloadFromDb());
```

---

## 数据持久化(SQLite)

数据库文件位于系统 `app_data_dir`(Windows: `%APPDATA%/com.research.assistant/`)下的
`ai_research_assistant.db`。共 11 张表 + 多个索引:

| 表 | 用途 |
|------|------|
| `settings` | 单行 KV,保存完整 AIConfig JSON |
| `projects` | 研究项目(名称、关键词、关联 Zotero/Obsidian) |
| `conversations` | 聊天会话(可关联 project_id,带 summary) |
| `messages` | 会话消息 |
| `project_todos` | 项目待办(优先级 / 状态) |
| `activity_events` | 用户活动事件(脱敏,可关闭) |
| `usage_records` | AI 调用统计(token / cost / latency) |
| `knowledge_docs` | 知识库文档元数据 + 索引状态 |
| `doc_chunks` | 文档块 + 嵌入向量(JSON 序列化) |
| `zotero_items_cache` | Zotero 条目本地缓存 |
| `zotero_collections_cache` | Zotero 集合本地缓存 |

模式变更通过 `ALTER TABLE ... ADD COLUMN`(忽略已存在错误)实现增量迁移,旧版本数据无损升级。

---

## 使用指南

### 首次配置

1. 启动后显示 **Welcome 面板**,点 "Start With Floating Ball" 进入
2. 双击悬浮球 → 主窗口 → ⚙️ 打开设置
3. 至少完成:
   - **Text Model**:选择预设 + 填入 API Key
   - (可选)**Vision Model**:支持图像的模型(用于截图提取)
   - (可选)**Translate**:源语言(支持自动检测)+ 目标语言(15 种)
   - (可选)**Routing**:为不同任务指定首选/Fallback 模型
   - (可选)**External Tools**:Zotero User ID / Obsidian Vault Path
   - (可选)**Knowledge Base**:开启 Auto-Retrieve、设置 Top-K
4. 保存后会自动广播给其他窗口

### 常用工作流

#### 📄 翻译/净化粘贴的文本
1. `Ctrl+C` 复制任意文本
2. `Alt+Q` → 选择"翻译"或"净化转 Word"
3. `Ctrl+V` 粘贴结果

#### 📸 论文里的公式/表格转 Markdown
1. `Alt+S` → 框选目标区域
2. 选择"公式 → LaTeX"或"表格 → Markdown"
3. Result 窗口流式输出后自动复制 → 粘贴到笔记

#### 📚 写作时找参考文献
1. 在 Word/Typora 等写作软件中选中一段话(主题描述)
2. `Ctrl+C` → `Alt+Q`
3. 因检测到写作场景,菜单出现"📖 推荐引文"
4. 点击后自动从 Zotero 缓存中模糊匹配,可一键复制 GB7714 / APA / IEEE 格式

#### 🧠 让 AI 基于你的论文库回答
1. 主窗口左侧切到 **Knowledge** 面板
2. 拖入 PDF(可批量),等待 indexing → completed
3. 设置中开启 `kbAutoRetrieve`,设置 `kbTopK`(默认 5)
4. 在 Chat 中提问 → 自动注入相关片段上下文

#### 📝 把当前对话存到 Obsidian
1. 设置中填入 Obsidian Vault Path 与默认 Folder
2. 主窗口对话标题栏 → "Save to Obsidian"
3. 自动生成 YAML frontmatter + 反向链接

---

## 核心技术实现

### 1. 富文本剪贴板 (Windows CF_HTML)

通过 `windows-sys` 调用 Win32 API,将 Markdown 渲染为带 `Version:0.9` 头的 HTML 写入
`HTML Format` 剪贴板格式:

```
Version:0.9
StartHTML:0000000xxx
EndHTML:0000000xxx
StartFragment:0000000xxx
EndFragment:0000000xxx
<!DOCTYPE html><html><body><!--StartFragment-->
<table>...</table>
<!--EndFragment--></body></html>
```

支持 Word / WPS / Typora 等富文本软件直接 `Ctrl+V` 带格式粘贴。

### 2. 多模型路由与 Fallback

```typescript
// settings.ts 中定义任务路由规则
{
  taskType: 'literature_review',
  preferredModelId: 'kimi-profile',
  fallbackModelIds: ['deepseek-profile', 'openai-profile'],
  timeoutMs: 120000
}

// aiClient.ts 中按规则尝试
for (const profile of [primary, ...fallbacks]) {
  try {
    return await this.doChatStream(messages, callbacks, profile);
  } catch {
    isFallback = true;
    fallbackReason = `主模型失败: ${err.message}`;
  }
}
```

每次调用记录到 `usage_records`,失败也记录(`success=0`)以便分析。

### 3. 本地嵌入与镜像代理

`@huggingface/transformers` 默认从 `huggingface.co` 拉模型,国内访问受限。
我们覆盖 `window.fetch`,把 `huggingface.co` 替换为 `hf-mirror.com`,并将请求路由到
Tauri 后端的 `tauri-plugin-http`(在 `capabilities/default.json` 中显式 allow),
绕开浏览器 CORS。

```typescript
window.fetch = async (input, init) => {
  if (url.includes('huggingface.co') || url.includes('hf-mirror.com')) {
    const newUrl = url.replace('https://huggingface.co/', mirrorUrl);
    return tauriFetch(newUrl, init);  // Rust 后端 reqwest
  }
  return browserFetch(input, init);
};
```

### 4. 活动窗口检测 (Rust)

`window_detector.rs` 通过 Win32 `GetForegroundWindow` + `GetWindowTextW` 每 3 秒读取一次,
按进程名分类成 `AppType::PdfReader` / `Writing` / `Browser` / `Unknown`,有变化时
`emit('window:activity-changed', info)` 给前端。PopupWindow 据此调整菜单(写作软件 → 多
显示一个"推荐引文")。

### 5. 截图与区域裁剪

```rust
fn capture_fullscreen() -> Result<ScreenshotPayload>           // 多显示器全屏
fn capture_region(x, y, w, h) -> Result<String>                // 指定区域
```

前端通过 Canvas 把用户在 viewport 上的选区坐标精确映射回原图坐标,实现像素级裁剪,
裁剪后转 base64 data URL 喂给 Vision 模型。

### 6. 流式输出

```typescript
await aiClient.chatStream(messages, {
  onStart, onToken, onComplete, onError, onInterrupted
}, useVision, taskType);
```

- 文本任务走 SSE(`stream: true`),按行解析 `data: { delta: ... }`
- Vision 任务走 JSON(`stream: false`,部分服务商对 SSE + 多模态不友好)
- 通过 `AbortController` 支持用户随时中断

### 7. 全局快捷键

```rust
let alt_q = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);
let alt_s = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);
app.global_shortcut().register(alt_q)?;
app.global_shortcut().register(alt_s)?;
```

handler 内调用 `app_control::show_popup_with_clipboard` 或 `screenshot::trigger_capture`。

### 8. 悬浮球边缘吸附

```rust
fn snap_widget_to_bounds() -> Result<WidgetDockState>
```

阈值 28px 内贴边,返回 `left / right / none`,前端根据 `dockSide` 控制 CSS 收缩/展开动画。

---

## 开发阶段

- **Phase 1**:基础设施 — Tauri 多窗口、悬浮球、Vite 构建
- **Phase 2**:设置面板 + AI 联通(流式对话、历史、欢迎引导)
- **Phase 3**:主动决策面板 + 富文本剪贴板(Alt+Q、翻译、伪进度条、取消)
- **Phase 4**:全屏截图 + 视觉模型(Alt+S、4 种提取模式、解放屏幕)
- **Phase 5**:悬浮球体验(边缘吸附、自动收缩、默认位置)
- **Phase 6**:SQLite 持久化(settings、conversations、messages、迁移)
- **Phase 7**:研究项目 + Todo + 知识库(PDF 解析、本地嵌入、Top-K 检索)
- **Phase 8**:Zotero / Obsidian 双向桥接(同步、缓存、模板)
- **Phase 9**:多模型路由 + 用量统计(任务级 Fallback、成本估算)
- **Phase 10**:活动检测 + 隐私模式(Rust 事件采集、上下文感知菜单、跨窗口设置同步)

---

## 常见问题

**Q: 翻译/截图功能拿不到回复?**
A: 这通常是各窗口 settings store 未同步。1) 在主窗口 SettingsPanel 重新点一次"保存"
触发 `settings-updated` 广播;2) 检查 Vision Model 已配置(截图功能需要)。

**Q: 知识库索引卡在 indexing?**
A: 首次需要从 hf-mirror.com 下载嵌入模型(约 22MB),网络慢时较久。检查
DevTools 网络面板,或在设置中切换 `hfMirrorUrl`。

**Q: Zotero 同步显示"Connection Refused"?**
A: 需先打开 Zotero 桌面端(本地 API 默认端口 23119)。Zotero 6/7 默认开启,
Zotero 5 需在设置中手动启用 "Allow other applications on this computer to communicate
with Zotero"。

**Q: 富文本粘贴到 Word 失败?**
A: CF_HTML 仅支持 Windows。macOS/Linux 会回退到纯文本。

**Q: 想完全离线使用?**
A: 把所有 Provider Key 留空就不会有任何外发请求(除了 KB 嵌入模型一次性下载)。
启用 **Incognito 模式**还可停止本地事件记录。

**Q: 在哪里能看到我用了多少 API?**
A: 主窗口右上角 → Usage 面板,展示今天/7 天/30 天的调用次数、token 数、估算成本、
Fallback 比例。

**Q: 截图快捷键不生效?**
A: 检查是否被其他软件占用了 Alt+S(常见冲突:微信"截屏"、QQ "屏幕截图")。
目前快捷键硬编码,后续版本计划支持自定义。

---

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request!

## 致谢

- [Tauri](https://tauri.app/) — 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) — 渐进式 JavaScript 框架
- [Hugging Face Transformers.js](https://huggingface.co/docs/transformers.js) — 浏览器端推理
- [pdf.js](https://mozilla.github.io/pdf.js/) — PDF 解析
- [Zotero](https://www.zotero.org/) / [Obsidian](https://obsidian.md/) — 文献与笔记生态
- [TailwindCSS](https://tailwindcss.com/) / [Vite](https://vitejs.dev/)

---

## 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/) +
  [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) +
  [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) +
  [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
