# Phase 3 功能设计文档

## 日期
2026-04-29

## 目标
实现三个功能：
1. 自动会话摘要生成（每n轮触发，n可配置）
2. 写作伴侣（按Phase 3文档完整规格）
3. 阅读伴侣（按Phase 3文档完整规格）

## 整体架构

### 分层设计

```
Layer 4: 功能层
  - 会话摘要生成器 (session_summarizer.rs / sessionSummary.ts)
  - 写作伴侣 (writing_companion.rs / WritingCompanion.vue)
  - 阅读伴侣 (reading_companion.rs / ReadingCompanion.vue)

Layer 3: 公共基础设施（新增）
  - 选中文本获取 (text_selection.rs)
  - 文本回写 (text_injection.rs)
  - PDF路径/页码提取 (pdf_detection.rs)

Layer 2: Phase 0-2 已有基础设施
  - 窗口检测、事件采集、项目系统、AI路由、知识库、Zotero、Obsidian

Layer 1: Tauri 运行时 + SQLite + OS APIs
```

### 设计原则
- 公共基础设施独立成模块，不影响已有功能
- 新功能只依赖 Layer 3 接口，不直接调用 OS API
- 每个模块独立错误处理，失败不阻塞其他模块

---

## 1. 公共基础设施层（Rust）

### 1.1 选中文本获取 (src-tauri/src/text_selection.rs)

```rust
/// 获取当前活动窗口中选中的文本
/// 策略：先尝试辅助功能API，失败则回退到剪贴板方式
#[tauri::command]
pub fn get_selected_text() -> Result<String, String>

/// 剪贴板方式：备份原剪贴板 -> 模拟Ctrl+C -> 读取 -> 恢复
#[tauri::command]
pub fn get_selected_text_via_clipboard() -> Result<String, String>
```

**Windows实现：**
- 首选：`UI Automation` (`uiautomation` crate) 读取焦点元素的 `ValuePattern` 或 `TextPattern`
- 回退：备份剪贴板 -> `SendInput` 模拟 Ctrl+C -> 读取剪贴板 -> 恢复

### 1.2 文本回写 (src-tauri/src/text_injection.rs)

```rust
/// 将处理后的文本写入当前光标位置，替换原有选中文字
#[tauri::command]
pub fn replace_selected_text(text: String) -> Result<(), String>
```

**Windows实现：**
- 首选：如果活动窗口是 Word，尝试 Word COM 接口
- 次选：`SendInput` 模拟键盘输入
- 回退：写入剪贴板 + 模拟 Ctrl+V

### 1.3 PDF路径/页码提取 (src-tauri/src/pdf_detection.rs)

```rust
/// 获取当前PDF阅读器正在打开的文件路径
#[tauri::command]
pub fn get_current_pdf_path() -> Result<Option<String>, String>

/// 从PDF阅读器窗口标题中提取页码
#[tauri::command]
pub fn estimate_pdf_page(window_title: String) -> Option<u32>
```

**Windows实现：**
- 通过 `NtQuerySystemInformation` + `SystemHandleInformation` 枚举PDF阅读器进程的文件句柄
- 页码估计：正则匹配窗口标题中的 `Page N of M` 或 `N / M` 模式

---

## 2. 自动会话摘要生成

### 触发机制
- 在 `MainWindow.vue` 中，每次用户发送消息后检查消息计数
- 当对话轮数达到 `settings.summaryInterval`（用户可配置，默认5轮）时触发
- 触发后调用 AI 生成摘要，保存到数据库

### 数据流
```
用户发送消息 -> 检查消息轮数 % n === 0
              -> 是：调用 aiClient.chatOnce(summarization_prompt, messages)
              -> 保存到 conversations.summary
              -> 下次对话时自动加载作为上下文
```

### Settings 新增字段
```typescript
interface AIConfig {
  summaryInterval: number;  // 每n轮生成摘要，0表示关闭，默认5
}
```

---

## 3. 写作伴侣

### 3.1 写作应用检测
扩展 `classify_app`：
- 增加 WPS (`wps.exe`)、TeXstudio (`texstudio.exe`)
- VS Code 检测当前编辑文件扩展名是否为 `.tex`

### 3.2 动态菜单（PopupWindow.vue）
当 `currentAppType === 'writing'` 时显示：
- 润色为学术英语
- 简化表达
- 修正语法
- 推荐引用（已有）
- 格式检查

### 3.3 润色流程
```
选中文字 -> Alt+Q -> 点击"润色"
       -> Rust: get_selected_text()
       -> AI: chatOnce(polish_prompt, selected_text)
       -> ResultWindow 以 diff 模式展示
       -> 用户点击"采用" -> Rust: replace_selected_text()
       -> 或点击"复制" -> 写入剪贴板
```

### 3.4 Diff 对比视图
扩展 `ResultWindow.vue` 新增 `mode="diff"`：
- 左右分栏，差异高亮（删除红、新增绿）
- 按钮："采用此版本" / "复制" / "放弃"

### 3.5 引用格式修正
```
选中引用 -> Alt+Q -> 点击"修正引用格式"
        -> 解析作者和年份
        -> Zotero缓存搜索
        -> 找到：按目标格式渲染 -> replace_selected_text()
        -> 未找到：提示"请先导入Zotero"
```

---

## 4. 阅读伴侣

### 4.1 悬浮球状态变化（WidgetWindow.vue）
检测到 PDF 阅读器时：
- 球体边缘呼吸灯环（CSS animation）
- 悬停面板显示文献标题和页码
- 面板切换为阅读工具菜单

### 4.2 阅读工具菜单
- 提取当前页公式 (F2)
- 提取当前页表格 (F3)
- 生成阅读笔记 (F4)
- 查看已提取内容

### 4.3 公式提取流程
```
按 F2 -> Rust: get_current_pdf_path() + estimate_pdf_page()
      -> PDF在知识库：读取该页文本
      -> 不在：临时提取
      -> 正则匹配 LaTeX 公式
      -> ResultWindow 显示
```

### 4.4 阅读笔记生成
- 获取 PDF 元数据（Zotero缓存）
- AI 生成结构化笔记模板
- 可选择保存到 Obsidian 或本地

### 4.5 阅读进度追踪
```
检测到PDF活动窗口 -> 创建 ReadingSession
                  -> 定时轮询页码
                  -> 失活5分钟或关闭 -> 结束会话
                  -> 更新知识库阅读统计
```

---

## 实现顺序

1. **公共基础设施**（Rust端）
   - text_selection.rs
   - text_injection.rs
   - pdf_detection.rs

2. **自动会话摘要生成**
   - Settings 新增字段
   - 触发逻辑
   - 上下文注入整合

3. **写作伴侣**
   - 扩展窗口检测
   - 动态菜单
   - 润色/diff/回写
   - 引用格式修正

4. **阅读伴侣**
   - 悬浮球状态
   - 阅读工具菜单
   - 公式提取
   - 阅读笔记
   - 进度追踪
