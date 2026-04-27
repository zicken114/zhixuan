# AI Research Assistant (科研悬浮小助手)

一款专为科研人员打造的 AI 桌面辅助工具，基于 Tauri v2 + Vue 3 + Rust 构建。

## 功能特性

### 核心功能

1. **桌面悬浮球 (Widget)**
   - 60x60 圆形悬浮球，始终置顶，透明背景
   - 支持拖拽移动，松手后自动吸附到屏幕左/右边缘
   - 吸附后自动收缩为细长条，鼠标悬停时展开
   - 右键禁用（防止误触菜单）

2. **AI 聊天助手 (Main Window)**
   - 流式输出（Typewriter 效果）的智能对话
   - 对话历史管理：新建、切换、删除会话
   - 首次启动时显示欢迎引导面板
   - 无边框透明背景，支持拖拽标题栏移动

3. **魔法快捷菜单 (Popup)** — `Alt + Q`
   - 基于当前剪贴板内容快速处理
   - 支持 5 个快捷操作：翻译、净化转 Word、格式化引文、打开设置、退出应用
   - 处理时显示伪进度条，支持中途取消
   - 处理结果自动写入剪贴板

4. **视觉提取引擎 (Capture)** — `Alt + S`
   - 全屏截图后，拖拽选择任意区域
   - 4 种提取模式：公式转 LaTeX、表格转 Markdown、纯文本 OCR、伪代码/流程图
   - 提取过程中解放屏幕（隐藏截图层），在独立结果窗口展示实时流式输出
   - 结果自动写入剪贴板（Markdown 格式以 CF_HTML 写入，支持带格式粘贴到 Word）

5. **结果展示窗口 (Result)**
   - 显示 AI 提取/处理的最终结果
   - 处理过程中展示伪进度条与实时流式预览
   - 支持复制后一键关闭

### 设计理念

**User-Driven（用户主动决策）原则**：
- 无后台轮询
- 无静默监听剪贴板
- 无全局鼠标划词监听
- 所有操作由用户主动触发（快捷键或点击）

## 技术栈

### 前端
- **框架**: Vue 3 (Composition API) + TypeScript
- **构建工具**: Vite 6
- **样式**: TailwindCSS v4 + PostCSS + 自定义 CSS
- **状态管理**: Pinia
- **动画**: @vueuse/motion
- **Markdown 解析**: marked

### 后端
- **框架**: Tauri v2
- **语言**: Rust
- **关键 Crate / 插件**:
  - `tauri-plugin-store` — 配置持久化
  - `tauri-plugin-global-shortcut` — 全局快捷键（Alt+Q / Alt+S）
  - `tauri-plugin-opener` — 外部链接打开
  - `arboard` — 跨平台剪贴板读写（含图片）
  - `screenshots` — 多显示器屏幕截图
  - `mouse-position` — 获取鼠标实时坐标
  - `image` + `base64` — 图像编码与处理
  - `windows-sys` — Windows 原生 API（CF_HTML 剪贴板格式）

## 安装要求

### 必需环境

1. **Node.js** (建议 v20+；最低 v18.18)
2. **Rust** (最新稳定版)
   - 安装: https://www.rust-lang.org/tools/install
   - Windows: 下载并运行 `rustup-init.exe`
3. **Tauri 系统依赖**
   - Windows: 需要 Microsoft Visual C++ 构建工具
   - 详见: https://tauri.app/start/prerequisites/

### 安装步骤

```bash
# 1. 进入项目目录
cd ai-research-assistant

# 2. 安装前端依赖
npm install

# 3. 开发模式运行
npm run tauri dev

# 4. 构建生产版本
npm run tauri build
```

## 项目结构

```
ai-research-assistant/
├── src/                          # Vue 前端源码
│   ├── windows/                  # 多窗口页面组件
│   │   ├── WidgetWindow.vue      # 悬浮球（自动吸附/收缩）
│   │   ├── MainWindow.vue        # AI 聊天主窗口 + 历史记录
│   │   ├── PopupWindow.vue       # 快捷菜单（Alt+Q）
│   │   ├── CaptureWindow.vue     # 全屏截图选区 + 视觉提取
│   │   └── ResultWindow.vue      # 结果展示（进度条 + 流式预览）
│   ├── components/               # 共享组件
│   │   ├── SettingsPanel.vue     # 设置面板（可折叠卡片式）
│   │   ├── WelcomePanel.vue      # 首次启动欢迎引导
│   │   ├── ChatHeader.vue        # 聊天窗口标题栏
│   │   ├── HistoryPanel.vue      # 历史会话侧边栏
│   │   ├── ChatMessageList.vue   # 消息列表（含空态、流式指示器）
│   │   ├── ChatInputArea.vue     # 输入框与发送按钮
│   │   ├── ExtractPromptMenu.vue      # 截图提取类型选择菜单
│   │   ├── ExtractProcessingOverlay.vue # 提取处理中遮罩
│   │   └── ExtractResultOverlay.vue     # 提取结果展示
│   ├── composables/              # Vue 组合式函数
│   │   ├── useProgress.ts        # 伪进度条逻辑
│   │   ├── useClipboard.ts       # 剪贴板读写封装
│   │   ├── useWindow.ts          # Tauri 窗口管理
│   │   └── useScreenshotSelection.ts # 截图选区与 Canvas 裁剪
│   ├── stores/                   # Pinia 状态管理
│   │   ├── settings.ts           # AI 配置 / 提供商预设 / 翻译语言
│   │   └── history.ts            # 会话历史（localStorage 持久化）
│   ├── utils/
│   │   └── aiClient.ts           # OpenAI-compatible API 客户端（流式/单次）
│   ├── App.vue                   # 根组件（按 window 参数路由）
│   ├── main.ts                   # 入口（Pinia + MotionPlugin）
│   └── style.css                 # 全局样式 + CSS 变量 + Google Fonts
├── src-tauri/                    # Rust 后端源码
│   ├── src/
│   │   ├── lib.rs                # 模块聚合与 Tauri Builder 配置
│   │   ├── main.rs               # 程序入口
│   │   ├── models.rs             # 数据结构定义
│   │   ├── clipboard.rs          # 剪贴板读写指令
│   │   ├── screenshot.rs         # 屏幕截图指令
│   │   ├── window_manager.rs     # 窗口位置/显示/隐藏指令
│   │   ├── events.rs             # Tauri 事件发射
│   │   └── app_control.rs        # 应用生命周期与菜单触发
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # 5 窗口配置 + 安全策略
├── package.json                  # Node 依赖与脚本
├── vite.config.ts                # Vite 配置（Tauri 适配端口 1420）
├── tailwind.config.js            # Tailwind 配置
└── postcss.config.js             # PostCSS 配置
```

## 窗口架构

应用由 **5 个独立 WebView 窗口**组成：

| 窗口 | 尺寸 | 特性 | 默认状态 |
|------|------|------|----------|
| **widget** | 60x60 | 悬浮球，alwaysOnTop，skipTaskbar，可拖拽吸附 | 可见 |
| **main** | 400x800 | AI 聊天，透明背景，可拖拽标题栏 | 隐藏 |
| **popup** | 200x280 | 快捷菜单，alwaysOnTop，跟随鼠标位置 | 隐藏 |
| **capture** | 全屏 | 截图遮罩，crosshair 光标，ESC 取消 | 隐藏 |
| **result** | 480x360 | 结果展示，居中显示，可调整大小 | 隐藏 |

## 使用指南

### 首次配置

1. 启动后自动显示 **Welcome 面板**，点击 "Start With Floating Ball" 进入
2. 双击悬浮球打开主窗口，点击右上角齿轮 ⚙️ 打开设置
3. 在 Settings 中配置：
   - **Text Model**: 选择预设提供商（OpenAI / DeepSeek / Kimi / 阿里百炼 / 智谱 / 阶跃星辰 / MiniMax）或自定义
   - **Vision Model**: 支持图像输入的模型（用于截图提取）
   - **Translation**: 设置源语言（支持自动检测）和目标语言（15 种语言）
   - API Key 和模型名称会自动根据预设填充，也可手动覆盖

### 快捷键

- **Alt + Q** — 魔法快捷菜单
  1. 复制任意文本（Ctrl+C）
  2. 按 Alt+Q，菜单出现在鼠标位置
  3. 选择操作（翻译 / 净化 / 引文 / 设置 / 退出）
  4. AI 处理完成后结果自动写入剪贴板
  5. Ctrl+V 粘贴到目标位置

- **Alt + S** — 截图提取
  1. 按 Alt+S，屏幕截图并显示遮罩层
  2. 拖动鼠标选择目标区域（显示实时尺寸）
  3. 选择提取类型（公式 / 表格 / 文本 / 伪代码）
  4. 截图层自动隐藏，结果窗口显示实时 AI 处理进度
  5. 完成后结果自动写入剪贴板，可直接粘贴
  6. 按 ESC 随时取消

### 悬浮球操作

- **拖拽**: 移动悬浮球，松手后自动吸附到左/右边缘
- **吸附后**: 鼠标离开自动收缩为细条，悬停时展开
- **单击**: 打开快捷菜单（Popup）
- **双击**: 打开 AI 聊天主窗口（Main）

## 核心技术实现

### 1. 富文本剪贴板 (Windows CF_HTML)

Rust 后端通过 `windows-sys` 直接调用 Win32 API，将 HTML 内容写入 `HTML Format` 剪贴板格式：

```
Version:0.9
StartHTML:{:010}
EndHTML:{:010}
StartFragment:{:010}
EndFragment:{:010}
<!DOCTYPE html><html><body><!--StartFragment-->
{your HTML}
<!--EndFragment--></body></html>
```

支持带格式粘贴到 Microsoft Word、WPS 等富文本编辑器。

### 2. 全局快捷键

通过 `tauri-plugin-global-shortcut` 注册系统级热键：

```rust
let alt_q = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);
let alt_s = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);
app.global_shortcut().register(alt_q)?;
```

### 3. 屏幕截图与区域裁剪

```rust
// 捕获全屏（多显示器支持）
fn capture_fullscreen() -> Result<ScreenshotPayload, String>

// 捕获指定区域（自动识别对应显示器）
fn capture_region(x, y, width, height) -> Result<String, String>
```

前端通过 Canvas 将用户选区坐标从 viewport 空间精确映射到原始图像空间，实现像素级裁剪。

### 4. 悬浮球边缘吸附

```rust
fn snap_widget_to_bounds() -> Result<WidgetDockState, String>
```

- 检测悬浮球与屏幕边缘的距离（阈值 28px）
- 自动贴边并返回吸附侧（left / right / none）
- 前端根据 `dockSide` 状态控制 CSS 收缩/展开动画

### 5. AI 流式输出

```typescript
await aiClient.chatStream(messages, {
  onStart: () => { /* 开始 */ },
  onToken: (token) => { /* 逐字渲染 */ },
  onComplete: (fullText) => { /* 完成 */ },
  onError: (error) => { /* 错误处理 */ }
}, useVision);
```
2026/04/27/21:21
- 文本模型使用 SSE 流式输出
- Vision 模型使用非流式 JSON 响应（兼容性更好）
- 支持请求中途取消（AbortController）

### 6. 预设模型提供商

内置 8 个预设，一键切换：

| 预设 | Base URL | 文本模型 | 视觉模型 |
|------|----------|----------|----------|
| OpenAI | `api.openai.com/v1` | gpt-4o | gpt-4o |
| DeepSeek | `api.deepseek.com/v1` | deepseek-chat | — |
| Kimi | `api.moonshot.cn/v1` | kimi-k2.5 | kimi-k2.5 |
| Bailian (阿里) | `dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus | qwen-vl-max |
| Zhipu (智谱) | `open.bigmodel.cn/api/paas/v4` | glm-5 | glm-4.6v |
| StepFun | `api.stepfun.com/v1` | step-3.5-flash | step-1v-8k |
| MiniMax | `api.minimaxi.com/v1` | MiniMax-M2.5 | — |
| Custom | 手动输入 | 手动输入 | 手动输入 |

## 开发阶段

- **Phase 1**: 基础设施搭建（Tauri 多窗口架构、悬浮球、Vite 构建）
- **Phase 2**: 设置面板与 AI 联通（流式对话、历史记录、欢迎引导）
- **Phase 3**: 主动决策面板与富文本剪贴板（Alt+Q 快捷菜单、翻译语言选择、伪进度条、任务取消）
- **Phase 4**: 全屏截图与视觉大模型接入（Alt+S 截图选区、4 种提取模式、结果窗口、屏幕解放）
- **Phase 5**: 悬浮球体验优化（边缘吸附、自动收缩/展开、默认位置计算）

## 常见问题

**Q: 如何更换 AI 模型？**  
A: 打开 Settings，选择预设提供商或手动输入 Base URL 和模型名称。支持任何 OpenAI-compatible API。

**Q: 富文本粘贴到 Word 失败？**  
A: CF_HTML 剪贴板格式仅在 Windows 上受支持。macOS/Linux 会回退到纯文本粘贴。

**Q: 截图快捷键不生效？**  
A: 检查是否有其他软件占用了 Alt+S。目前快捷键为硬编码，后续版本计划支持自定义。

**Q: Vision 模型调用失败？**  
A: 确保配置的 Vision Model 支持图像输入，且 Base URL 正确。可在浏览器 DevTools 中查看 `[Vision Request]` 日志排错。

**Q: 悬浮球位置错乱？**  
A: 拖拽悬浮球到屏幕任意位置，松手后会自动吸附到最近的左/右边缘。首次启动时自动计算默认位置（屏幕宽度 72% / 高度 22% 处）。

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 致谢

- [Tauri](https://tauri.app/) — 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) — 渐进式 JavaScript 框架
- [TailwindCSS](https://tailwindcss.com/) — 实用优先的 CSS 框架
- [Vite](https://vitejs.dev/) — 下一代前端构建工具

---

## 推荐 IDE 配置

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
