<<<<<<< HEAD
# proj0407
=======
# AI Research Assistant (科研悬浮小助手)

一款专为科研人员打造的 AI 桌面辅助工具，基于 Tauri + Vue 3 + Rust 构建。

## 功能特性

### ✨ 核心功能

1. **桌面悬浮球** - 可拖拽的桌面小部件，快速访问所有功能
2. **AI 聊天助手** - 支持流式输出的智能对话界面
3. **魔法快捷菜单** (Alt+Q)
   - 🌍 智能翻译（中英互译）
   - 🧹 Markdown 净化转 Word（支持富文本格式）
   - 📚 引文格式化为 BibTeX
4. **视觉提取引擎** (Alt+S)
   - 📐 提取公式为 LaTeX
   - 📊 提取表格为 Markdown
   - 📝 提取文字为纯文本
   - 🔣 提取伪代码/流程图

### 🎯 设计理念

**User-Driven（用户主动决策）原则**：
- ❌ 无后台轮询
- ❌ 无静默监听剪贴板
- ❌ 无全局鼠标划词监听
- ✅ 所有操作由用户主动触发（快捷键或点击）

## 技术栈

### 前端
- **框架**: Vue 3 (Composition API) + TypeScript
- **构建工具**: Vite
- **样式**: TailwindCSS
- **状态管理**: Pinia
- **动画**: @vueuse/motion
- **Markdown**: marked

### 后端
- **框架**: Tauri v2
- **语言**: Rust
- **关键 Crate**:
  - `tauri-plugin-store` - 配置持久化
  - `tauri-plugin-global-shortcut` - 全局快捷键
  - `arboard` - 剪贴板操作
  - `screenshots` - 屏幕截图
  - `mouse-position` - 鼠标坐标
  - `windows-sys` - Windows API (富文本剪贴板)

## 安装要求

### 必需环境

1. **Node.js** (v18+)
2. **Rust** (最新稳定版)
   - 安装: https://www.rust-lang.org/tools/install
   - Windows: 下载并运行 `rustup-init.exe`
3. **Tauri 依赖**
   - Windows: 需要 Microsoft Visual C++ 构建工具
   - 详见: https://tauri.app/start/prerequisites/

### 安装步骤

```bash
# 1. 克隆项目
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
├── src/                          # Vue 前端代码
│   ├── windows/                  # 窗口组件
│   │   ├── WidgetWindow.vue      # 悬浮球
│   │   ├── MainWindow.vue        # AI 聊天主窗口
│   │   ├── PopupWindow.vue       # 快捷菜单
│   │   └── CaptureWindow.vue     # 截图窗口
│   ├── components/               # 通用组件
│   │   └── SettingsPanel.vue    # 设置面板
│   ├── stores/                   # Pinia 状态管理
│   │   └── settings.ts           # 配置存储
│   ├── utils/                    # 工具函数
│   │   └── aiClient.ts           # AI API 客户端
│   ├── App.vue                   # 根组件
│   └── main.ts                   # 入口文件
├── src-tauri/                    # Rust 后端代码
│   ├── src/
│   │   └── lib.rs                # 主逻辑
│   ├── Cargo.toml                # Rust 依赖
│   └── tauri.conf.json           # Tauri 配置
└── package.json                  # Node 依赖
```

## 窗口架构

应用由 4 个独立的 WebView 窗口组成：

1. **widget** (60x60) - 悬浮球，始终置顶，可拖拽
2. **main** (400x800) - 侧边栏聊天界面，默认隐藏
3. **popup** (200x150) - 快捷菜单，默认隐藏
4. **capture** (全屏) - 截图选择界面，默认隐藏

## 使用指南

### 首次配置

1. 双击悬浮球打开主窗口
2. 点击右上角齿轮图标 ⚙️
3. 配置 AI 模型参数：
   - Base URL (如 `https://api.openai.com/v1`)
   - API Key
   - Text Model (如 `gpt-4`)
   - Vision Model (如 `gpt-4-vision-preview`)

### 快捷键

- **Alt + Q**: 魔法快捷菜单
  1. 复制文本 (Ctrl+C)
  2. 按 Alt+Q
  3. 选择操作（翻译/净化/引文）
  4. 结果自动写入剪贴板
  5. Ctrl+V 粘贴

- **Alt + S**: 截图提取
  1. 按 Alt+S
  2. 拖动鼠标选择区域
  3. 选择提取类型
  4. 等待 AI 处理
  5. 结果自动写入剪贴板

### 悬浮球操作

- **拖拽**: 移动悬浮球位置
- **单击**: 显示快捷菜单（Phase 3 已实现）
- **双击**: 打开 AI 聊天主窗口

## 核心技术实现

### 1. 富文本剪贴板 (Windows CF_HTML)

```rust
// 将 HTML 转换为 Windows CF_HTML 格式
// 支持带格式粘贴到 Word
fn set_clipboard_html(html: String) -> Result<(), String>
```

**格式规范**:
```
Version:0.9
StartHTML:0000000000
EndHTML:0000000000
StartFragment:0000000000
EndFragment:0000000000
<!DOCTYPE html><html><body>
<!--StartFragment-->
<your HTML content>
<!--EndFragment-->
</body></html>
```

### 2. 全局快捷键

```rust
// 注册系统级快捷键
app.global_shortcut().register("Alt+Q")?;
app.global_shortcut().on_shortcut("Alt+Q", |app, shortcut, event| {
    // 处理快捷键事件
});
```

### 3. 屏幕截图与裁剪

```rust
// 捕获全屏
fn capture_fullscreen() -> Result<ScreenshotPayload, String>

// 捕获指定区域
fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String>
```

### 4. AI 流式输出

```typescript
await aiClient.chatStream(messages, {
  onStart: () => { /* 开始 */ },
  onToken: (token) => { /* 逐字渲染 */ },
  onComplete: (fullText) => { /* 完成 */ },
  onError: (error) => { /* 错误处理 */ }
});
```

## 开发阶段

- ✅ **Phase 1**: 基础设施搭建（窗口架构、悬浮球）
- ✅ **Phase 2**: 设置面板与 AI 联通（流式对话）
- ✅ **Phase 3**: 主动决策面板与富文本剪贴板
- ✅ **Phase 4**: 全屏截图与视觉大模型接入

## 常见问题

### Q: 如何更换 AI 模型？
A: 打开设置面板，修改 Base URL 和模型名称。支持任何 OpenAI 兼容的 API。

### Q: 富文本粘贴到 Word 失败？
A: 确保使用的是 Windows 系统。macOS/Linux 暂不支持 CF_HTML 格式。

### Q: 截图快捷键不生效？
A: 检查是否有其他软件占用了 Alt+S 快捷键。可在代码中修改为其他组合。

### Q: Vision 模型调用失败？
A: 确保配置的 Vision Model 支持图像输入（如 gpt-4-vision-preview, gpt-4o）。

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 致谢

- [Tauri](https://tauri.app/) - 跨平台桌面应用框架
- [Vue.js](https://vuejs.org/) - 渐进式 JavaScript 框架
- [TailwindCSS](https://tailwindcss.com/) - 实用优先的 CSS 框架

---

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Vue - Official](https://marketplace.visualstudio.com/items?itemName=Vue.volar) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

>>>>>>> 9b319c2 (第一轮大致框架)
