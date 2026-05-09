# 科研助手后端工业级升级路线图 v2.0 — 工程化实施文档

> **目标读者**：Rust/Tauri 后端工程师  
> **核心目标**：基于现有架构分阶段升级，融入 MCP、Agent、RAG、Voice、AG-UI、Memory 等前沿技术，达到工业级可用标准  
> **关键约束**：**仅嵌入模型使用本地 ONNX Runtime，其余所有 LLM 推理任务（问答、翻译、综述、代码生成等）一律使用云端 API**。前端界面与交互逻辑保持不变，所有升级通过 Tauri IPC 向后兼容暴露  
> **技术栈**：Tauri v2 + Rust 2021 + SQLite + MCP + ONNX Runtime + Whisper

---

## 目录

1. [架构总览与核心设计决策](#1-架构总览与核心设计决策)
2. [Phase 1: MCP 协议基础设施](#2-phase-1-mcp-协议基础设施)
3. [Phase 2: Agent Runtime 核心](#3-phase-2-agent-runtime-核心)
4. [Phase 3: Agentic RAG 检索引擎](#4-phase-3-agentic-rag-检索引擎)
5. [Phase 4: AG-UI 流式状态反馈与动画系统](#5-phase-4-ag-ui-流式状态反馈与动画系统)
6. [Phase 5: 本地推理层（仅嵌入模型）](#6-phase-5-本地推理层仅嵌入模型)
7. [Phase 6: Workflow 引擎](#7-phase-6-workflow-引擎)
8. [Phase 7: PDF 多模态解析重构](#8-phase-7-pdf-多模态解析重构)
9. [Phase 8: Voice 语音交互层](#9-phase-8-voice-语音交互层)
10. [Phase 9: Memory 记忆系统](#10-phase-9-memory-记忆系统)
11. [Phase 10: Computer Use 桌面自动化](#11-phase-10-computer-use-桌面自动化)
12. [Phase 11: A2UI 生成式界面](#12-phase-11-a2ui-生成式界面)
13. [Phase 12: CRDT 离线协作与同步](#13-phase-12-crdt-离线协作与同步)
14. [Phase 13: 后端架构韧性升级](#14-phase-13-后端架构韧性升级)
15. [数据库迁移总脚本](#15-数据库迁移总脚本)
16. [分阶段实施甘特图](#16-分阶段实施甘特图)

---

## 1. 架构总览与核心设计决策

### 1.1 现有架构痛点

```
当前架构问题清单：

1. 工具调用层：硬编码 command 宏，新增工具需修改 lib.rs 并重新编译
2. AI 客户端：简单的 SSE 包装器，无状态管理，不支持多步推理
3. RAG 检索：静态单次向量检索，无查询分解、无多跳推理
4. 存储层：snapshot/plugin/team 使用内存 Mutex，重启数据丢失
5. PDF 解析：pdfjs-dist 文本提取，丢失版面信息（公式/表格/图表）
6. 向量存储：JSON 字符串存 SQLite，无索引，性能随数据量线性下降
7. 并发模型：命令-响应同步执行，CPU 密集型任务阻塞主线程
8. 可扩展性：无插件协议，功能扩展需侵入式修改源码
9. 用户体验：AI 执行任务时"黑盒"等待，用户不知道进度和状态
10. 输入方式：只能打字，无法语音快速输入
11. 跨会话：每次打开应用从零开始，不记住用户习惯
12. 协作能力：团队数据无法离线编辑后自动合并
```

### 1.2 目标架构总览

```
升级后架构（Backend Layer）：

┌──────────────────────────────────────────────────────────────────────┐
│                    Tauri Frontend (Vue 3) — 保持不变                   │
│                    IPC: invoke + event emit/listen                      │
└──────────────────────────────┬───────────────────────────────────────┘
│                              │ Tauri IPC Layer
└──────────────────────────────┼───────────────────────────────────────┘
│  Rust Backend — v2.0 架构                                             │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  1. MCP Hub (mcp_hub.rs)                                      │ │
│  │     - MCP Server 进程管理（启动/监控/重启/关闭）                │ │
│  │     - 工具注册表（动态发现/调用/缓存/权限控制）                  │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  2. Agent Runtime (agent_runtime.rs)                          │ │
│  │     - ReAct 决策循环（思考→行动→观察→修正）                   │ │
│  │     - 工具调用管理器（同步/异步/超时控制/权限拦截）              │ │
│  │     - 记忆管理（短期滑动窗口 + 长期 SQLite 持久化）             │ │
│  │     - Skill 加载器（SKILL.md 三级渐进加载）                    │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  3. Agentic RAG Engine (agentic_rag.rs)                       │ │
│  │     - 查询分解器（复杂查询拆分子查询）                          │ │
│  │     - 检索路由器（多源动态路由：本地KB/Zotero/arXiv/S2）         │ │
│  │     - 多跳检索引擎（迭代式深度检索）                            │ │
│  │     - 相关性评估器（轻量 ONNX 分类模型）                        │ │
│  │     - 证据融合器（多源结果合并去冲突）                          │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  4. AG-UI Event Stream (ag_ui.rs)                              │ │
│  │     - 心跳系统（每步执行进度实时推送）                         │ │
│  │     - 思考过程流式展示（Chain of Thought 可视化）               │ │
│  │     - 工具执行动画（进度条/脉冲/状态徽章）                       │ │
│  │     - 推理时间线（Reasoning Timeline 组件）                    │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  5. Local Inference Layer (local_inference.rs)                │ │
│  │     - ONNX Runtime：Embedding 编码（50MB，零负担）              │ │
│  │     - ONNX Runtime：意图分类/相关性评分（轻量）                  │ │
│  │     - Whisper：本地语音识别（按住说话，2秒转文字）                │ │
│  │     - ⚠️ 其余所有 LLM 任务 → 云端 API（GPT-4/Claude/DeepSeek）│ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  6. Workflow Engine (workflow_engine.rs)                      │ │
│  │     - DAG 执行器（事件驱动/状态持久化/故障恢复）                │ │
│  │     - 节点注册表（12+ 内置节点类型）                            │ │
│  │     - 预设模板库（深度调研/每日简报/实验记录自动化）              │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  7. PDF Multimodal Parser (pdf_parser.rs)                     │ │
│  │     - Docling MCP Server（高精度结构化解析）                    │ │
│  │     - 版面重建引擎（标题/段落/表格/公式/图表）                   │ │
│  │     - ColPali 视觉检索（像素级语义匹配，Phase 7 扩展）           │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  8. Voice Layer (voice.rs)                                    │ │
│  │     - Whisper 本地语音识别（Ctrl+Alt+V 按住说话）               │ │
│  │     - 语音转文字 → 直接输入聊天框                              │ │
│  │     - 语音备注录制（实验快照时口述备注）                        │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  9. Memory System (memory.rs)                               │ │
│  │     - 跨会话用户偏好持久化（研究领域/常用工具/输出风格）          │ │
│  │     - 自动学习（从对话中提取用户习惯）                         │ │
│  │     - 上下文预热（打开应用时自动加载相关记忆）                   │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  10. Computer Use (computer_use.rs)                            │ │
│  │     - 屏幕截图理解（分析当前窗口内容）                         │ │
│  │     - 自动操作 PDF 阅读器（翻页/标注/提取）                    │ │
│  │     - 自动操作代码编辑器（插入代码/运行测试）                    │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  11. A2UI Generator (a2ui.rs)                                │ │
│  │     - Agent 生成声明式 UI（JSON 组件描述）                      │ │
│  │     - 动态图表/表格/对比矩阵（根据任务类型自动选择）             │ │
│  │     - 跨窗口组件渲染（Widget/Popup/Main 共享 UI 组件）          │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  12. CRDT Sync (crdt_sync.rs)                                 │ │
│  │     - Yjs/Automerge 集成（离线编辑后自动合并）                 │ │
│  │     - P2P 网格同步（蓝牙/Wi-Fi 直连团队设备）                   │ │
│  │     - 冲突自动解决（无需人工介入）                             │ │
│  ├───────────────────────────────────────────────────────────────┤ │
│  │  13. Actor Runtime (actor_runtime.rs)                          │ │
│  │     - Actor 消息总线（tokio mpsc）                             │ │
│  │     - 后台任务调度器（CPU 密集型任务异步化）                    │ │
│  │     - 故障恢复（超时/重试/熔断）                               │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │  数据持久化层                                                  │ │
│  │  - SQLite (tauri-plugin-sql) → 元数据/配置/对话历史           │ │
│  │  - sqlite-vec (向量扩展) → 文档向量索引                       │ │
│  │  - 新增表: workflows/workflow_nodes/workflow_executions        │ │
│  │           agent_memories/mcp_tools/rag_cache/voice_memos      │ │
│  │           user_preferences/memory_entries/crdt_documents      │ │
│  └───────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 核心设计决策记录（ADR）

| 决策 | 选择 | 理由 | 拒绝的替代方案 |
|------|------|------|--------------|
| MCP 协议 | 自研 MCP Hub + tauri-plugin-mcp | Tauri 生态已有成熟插件 | 自研通用插件系统（工作量 3 倍） |
| Agent 架构 | ReAct 循环 + Function Calling | 工程复杂度可控 | Plan-and-Execute（稳定性差） |
| RAG 检索 | 混合检索(BM25+Vector) + 多跳 | 投入产出比最优 | GraphRAG（图数据库成本过高） |
| **LLM 策略** | **仅 Embedding 本地 ONNX，其余全部云端** | 普通用户硬件有限，大模型本地推理负担过重 | Ollama 7B+ 本地大模型（用户硬件不达标） |
| AG-UI 流式反馈 | 自研心跳系统 + Tauri Event | 直接控制前端渲染 | SSE 长连接（Tauri 多窗口场景复杂） |
| Voice 语音 | Whisper base/small 本地 | 1-2GB 内存，所有电脑都能跑 | Whisper API（增加网络依赖和费用） |
| 记忆系统 | SQLite 持久化 + 自动提取 | 轻量，无需向量数据库 | 专用记忆数据库（如 Mem0，增加复杂度） |
| Computer Use | 截图 + UIA API（Windows） | 与现有 window_detector 结合 | 纯视觉模型（需要大模型能力，成本过高） |
| A2UI | 自研 JSON Schema + Vue 动态渲染 | 与现有 Vue 前端无缝集成 | Google A2UI 官方 SDK（需额外依赖） |
| CRDT 协作 | Yjs WASM + SQLite 持久化 | Yjs 成熟稳定，WASM 可在 Rust 中运行 | Automerge（性能较差） |
| 并发模型 | Actor + tokio mpsc | Rust 原生，零额外依赖 | Actix（重量级，不必要） |

### 1.4 LLM 路由策略（明确约束）

```
┌─────────────────────────────────────────────────────────────┐
│                     LLM 路由决策树                           │
│                     （仅两类，极简）                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  输入任务类型                                               │
│       │                                                     │
│       ├── 嵌入编码（Embedding）                               │
│       │     │                                               │
│       │     └──→ ONNX Runtime 本地推理（50MB 模型）          │
│       │           理由：高频调用（每篇论文一次），无需联网    │
│       │                                                     │
│       └── 其他所有任务（问答/翻译/综述/代码/分析）           │
│             │                                               │
│             └──→ 云端 API（GPT-4 / Claude / DeepSeek）     │
│                   理由：模型能力强，普通用户硬件无法胜任        │
│                                                             │
│  路由决策因素：                                              │
│  - 任务类型：embedding → 本地，其他 → 云端                   │
│  - 网络状态：离线时 embedding 仍可工作，其他任务提示联网      │
│  - 隐私级别：高隐私数据（未发表论文）→ 本地分类模型过滤后     │
│             脱敏部分云端处理                                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Phase 1: MCP 协议基础设施

### 2.1 目标

将现有硬编码的 Rust command 接口升级为 MCP（Model Context Protocol）标准化的工具调用体系，使外部工具可以动态注册、发现和调用，无需修改 Rust 源码即可扩展功能。

### 2.2 现有代码分析

当前 Rust 后端采用 Tauri command 模式暴露功能：

```rust
// src-tauri/src/lib.rs（当前）
#[tauri::command]
async fn capture_fullscreen(state: tauri::State<'_, AppState>) -> Result<String, String> {
    screenshot::capture_fullscreen().await
}

#[tauri::command]
async fn get_clipboard_text() -> Result<String, String> {
    clipboard::get_text()
}

// ... 30+ 个硬编码命令

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            capture_fullscreen,
            get_clipboard_text,
            // ... 更多硬编码命令
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**问题**：每新增一个功能需要：① 写 Rust command 函数 → ② 在 `generate_handler!` 中注册 → ③ 编译 → ④ 发布新版本。侵入式扩展。

### 2.3 新模块设计

#### 2.3.1 文件结构

```
src-tauri/src/
├── mcp/
│   ├── mod.rs              # 模块入口 + Tauri command 桥接
│   ├── hub.rs              # MCP Hub: Server 进程管理 + 工具路由
│   ├── client.rs           # MCP Client: 协议实现
│   ├── registry.rs         # 工具注册表
│   └── transport.rs        # 传输层: StdioTransport
├── mcp_servers/            # 内置 MCP Server（独立进程）
│   ├── filesystem_server.js  # 文件系统操作
│   ├── brave_search_server/ # 网页搜索
│   ├── docling_server.py     # PDF 文档解析
│   └── zotero_server.js      # Zotero 集成
```

#### 2.3.2 MCP Hub 核心实现

```rust
// src-tauri/src/mcp/hub.rs

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, RwLock};
use serde::{Deserialize, Serialize};

/// MCP Hub：管理所有 MCP Server 的生命周期
pub struct McpHub {
    servers: Arc<RwLock<HashMap<String, McpServerInstance>>>,
    registry: Arc<RwLock<HashMap<String, ToolRegistration>>>,
    pending_calls: Arc<RwLock<HashMap<String, mpsc::Sender<ToolResult>>>>,
    servers_dir: std::path::PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub transport: TransportType,
    pub auto_start: bool,
    pub timeout_ms: u64,
}

#[derive(Debug, Clone)]
enum TransportType {
    Stdio,
    WebSocket { port: u16 },
}

#[derive(Debug, Clone)]
struct McpServerInstance {
    config: McpServerConfig,
    process: Option<tokio::process::Child>,
    status: ServerStatus,
    client: Arc<dyn McpClientTrait>,
    tools: Vec<ToolInfo>,
}

#[derive(Debug, Clone, Serialize)]
enum ServerStatus {
    Starting,
    Running,
    Error(String),
    Stopped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRegistration {
    pub info: ToolInfo,
    pub server_name: String,
    pub enabled: bool,
    pub permission_level: PermissionLevel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PermissionLevel {
    AlwaysAllow,
    AskUser,
    Deny,
}

impl McpHub {
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        let servers_dir = app_data_dir.join("mcp_servers");
        std::fs::create_dir_all(&servers_dir).ok();
        Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            registry: Arc::new(RwLock::new(HashMap::new())),
            pending_calls: Arc::new(RwLock::new(HashMap::new())),
            servers_dir,
        }
    }

    /// 启动所有配置为 auto_start 的 MCP Server
    pub async fn start_all(&self) -> Result<(), McpError> {
        let configs = self.load_server_configs().await?;
        for config in configs {
            if config.auto_start {
                self.start_server(config).await?;
            }
        }
        Ok(())
    }

    /// 启动单个 MCP Server
    pub async fn start_server(&self, config: McpServerConfig) -> Result<(), McpError> {
        let mut servers = self.servers.write().await;
        let client: Arc<dyn McpClientTrait> = match &config.transport {
            TransportType::Stdio => {
                let transport = StdioTransport::new(&config.command, &config.args, &config.env);
                Arc::new(McpClient::new(transport))
            }
            TransportType::WebSocket { port } => {
                let transport = WsTransport::new(*port).await?;
                Arc::new(McpClient::new(transport))
            }
        };
        client.initialize().await?;
        let tools = client.list_tools().await?;
        let instance = McpServerInstance {
            config: config.clone(),
            process: None,
            status: ServerStatus::Running,
            client: client.clone(),
            tools: tools.clone(),
        };
        servers.insert(config.name.clone(), instance);
        let mut registry = self.registry.write().await;
        for tool in tools {
            registry.insert(tool.name.clone(), ToolRegistration {
                info: tool,
                server_name: config.name.clone(),
                enabled: true,
                permission_level: PermissionLevel::AskUser,
            });
        }
        Ok(())
    }

    /// 调用 MCP 工具（核心接口）
    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> Result<ToolResult, McpError> {
        let registry = self.registry.read().await;
        let registration = registry.get(tool_name)
            .ok_or(McpError::ToolNotFound(tool_name.to_string()))?;
        if !registration.enabled {
            return Err(McpError::ToolDisabled(tool_name.to_string()));
        }
        let server_name = registration.server_name.clone();
        drop(registry);
        let servers = self.servers.read().await;
        let instance = servers.get(&server_name)
            .ok_or(McpError::ServerNotRunning(server_name))?;
        let result = tokio::time::timeout(
            std::time::Duration::from_millis(instance.config.timeout_ms),
            instance.client.call_tool(tool_name, arguments),
        ).await.map_err(|_| McpError::Timeout)?;
        result
    }

    /// 获取所有可用工具列表（供前端 AI Agent 使用）
    pub async fn list_available_tools(&self) -> Vec<ToolRegistration> {
        let registry = self.registry.read().await;
        registry.values().filter(|r| r.enabled).cloned().collect()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("工具未找到: {0}")]
    ToolNotFound(String),
    #[error("工具已禁用: {0}")]
    ToolDisabled(String),
    #[error("Server 未运行: {0}")]
    ServerNotRunning(String),
    #[error("调用超时")]
    Timeout,
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),
    #[error("序列化错误: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: Vec<ToolContent>,
    pub is_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolContent {
    Text { text: String },
    Image { data: String, mime_type: String },
    Resource { resource: serde_json::Value },
}
```

#### 2.3.3 Tauri Command 桥接

```rust
// src-tauri/src/mcp/mod.rs

#[tauri::command]
pub async fn mcp_list_tools(hub: State<'_, McpHub>) -> Result<Vec<ToolRegistration>, String> {
    hub.list_available_tools().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_call_tool(
    hub: State<'_, McpHub>,
    tool_name: String,
    arguments: serde_json::Value,
) -> Result<ToolResult, String> {
    hub.call_tool(&tool_name, arguments).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn mcp_toggle_tool(
    hub: State<'_, McpHub>,
    tool_name: String,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        hub.enable_tool(&tool_name).await.map_err(|e| e.to_string())
    } else {
        hub.disable_tool(&tool_name).await.map_err(|e| e.to_string())
    }
}
```

### 2.4 数据库新增表

```sql
CREATE TABLE IF NOT EXISTS mcp_servers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    command     TEXT NOT NULL,
    args        TEXT NOT NULL DEFAULT '[]',
    env         TEXT NOT NULL DEFAULT '{}',
    transport   TEXT NOT NULL DEFAULT 'stdio',
    port        INTEGER,
    auto_start  INTEGER NOT NULL DEFAULT 1,
    timeout_ms  INTEGER NOT NULL DEFAULT 30000,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_tools (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT NOT NULL,
    parameters      TEXT NOT NULL DEFAULT '{}',
    server_name     TEXT NOT NULL REFERENCES mcp_servers(name),
    enabled         INTEGER NOT NULL DEFAULT 1,
    permission_level TEXT NOT NULL DEFAULT 'ask_user',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_tool_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name   TEXT NOT NULL,
    arguments   TEXT NOT NULL DEFAULT '{}',
    result      TEXT,
    is_error    INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 2.5 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | 创建 `mcp/` 目录结构 + Transport 层 | 4h |
| 2 | 实现 MCP Client + Hub | 5h |
| 3 | 实现工具注册表 + 权限控制 | 3h |
| 4 | 编写 filesystem MCP Server | 2h |
| 5 | 数据库迁移 | 1h |
| 6 | 注册 MCP Hub 到 Tauri State | 1h |
| 7 | 集成测试 | 3h |

**Phase 1 总工作量：约 19 小时**

---

## 3. Phase 2: Agent Runtime 核心

### 3.1 目标

将现有 `aiClient.ts` 的简单 SSE 包装器升级为支持 ReAct 决策循环的 Agent Runtime，使 AI 能够执行多步工具调用任务。所有 LLM 推理通过云端 API。

### 3.2 核心数据结构

```rust
// src-tauri/src/agent/mod.rs

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub max_steps: u32,
    pub temperature: f32,
    pub context_window: usize,
    pub summary_threshold: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct AgentState {
    pub conversation_id: String,
    pub step_count: u32,
    pub status: AgentStatus,
    pub current_task: Option<String>,
    pub tools_used: Vec<String>,
    pub memory: ConversationMemory,
}

#[derive(Debug, Clone, Serialize)]
pub enum AgentStatus {
    Idle,
    Thinking,
    CallingTool { tool_name: String },
    ProcessingResult,
    Complete,
    Error(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMemory {
    pub messages: Vec<AgentMessage>,
    pub summary: Option<String>,
    pub total_tokens: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "role")]
pub enum AgentMessage {
    System { content: String },
    User { content: String, timestamp: chrono::DateTime<chrono::Utc> },
    Assistant { content: String, tool_calls: Option<Vec<ToolCall>> },
    Tool { tool_name: String, result: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}
```

### 3.3 ReAct 循环实现

```rust
// src-tauri/src/agent/runtime.rs

pub struct AgentRuntime {
    config: AgentConfig,
    mcp_hub: Arc<McpHub>,
    cloud_client: Arc<CloudLlmClient>,  // 云端 API 客户端
    memory_store: Arc<dyn MemoryStore>,
    state: Arc<RwLock<AgentState>>,
    ag_ui: Arc<AgUiEventStream>,       // Phase 4 的流式反馈系统
}

impl AgentRuntime {
    /// 运行 ReAct 决策循环
    pub async fn run(&self, user_query: String) -> Result<AgentRunResult, AgentError> {
        let mut steps: Vec<ReActStep> = Vec::new();
        let mut current_query = user_query.clone();
        
        // 初始化状态
        {
            let mut state = self.state.write().await;
            state.status = AgentStatus::Thinking;
            state.step_count = 0;
        }

        // 发送 AG-UI 事件：任务开始
        self.ag_ui.emit_event(AgUiEvent::TaskStarted {
            conversation_id: self.state.read().await.conversation_id.clone(),
            query: user_query.clone(),
        }).await;

        for step_idx in 0..self.config.max_steps {
            // Step 1: 构建系统提示词
            let system_prompt = self.build_system_prompt().await;
            
            // Step 2: 构建当前上下文
            let memory = self.memory_store.load(&self.state.read().await.conversation_id).await?;
            let available_tools = self.mcp_hub.list_available_tools().await;
            let tool_descriptions = self.format_tool_descriptions(&available_tools);
            
            // Step 3: 调用云端 LLM 进行推理
            let messages = self.build_messages(&system_prompt, &memory, &current_query);
            
            // 发送 AG-UI 事件：开始思考
            self.ag_ui.emit_event(AgUiEvent::Thinking {
                step: step_idx + 1,
                max_steps: self.config.max_steps,
            }).await;
            
            let llm_response = self.cloud_client.chat(messages, Some(&tool_descriptions)).await?;
            
            // Step 4: 解析 LLM 输出
            let (thought, action) = self.parse_llm_response(&llm_response);
            
            // 发送 AG-UI 事件：思考完成
            self.ag_ui.emit_event(AgUiEvent::ThoughtComplete {
                step: step_idx + 1,
                thought: thought.clone(),
            }).await;
            
            // Step 5: 执行动作
            let observation = match action {
                AgentAction::Think { content } => {
                    content
                }
                AgentAction::ToolCall { tool_name, arguments } => {
                    let mut state = self.state.write().await;
                    state.status = AgentStatus::CallingTool { tool_name: tool_name.clone() };
                    drop(state);
                    
                    // 发送 AG-UI 事件：开始调用工具
                    self.ag_ui.emit_event(AgUiEvent::ToolCalling {
                        step: step_idx + 1,
                        tool_name: tool_name.clone(),
                        arguments: arguments.clone(),
                    }).await;
                    
                    let result = self.mcp_hub.call_tool(&tool_name, arguments).await;
                    
                    let observation = match result {
                        Ok(tool_result) => {
                            // 发送 AG-UI 事件：工具调用成功
                            self.ag_ui.emit_event(AgUiEvent::ToolResult {
                                step: step_idx + 1,
                                tool_name: tool_name.clone(),
                                result: format!("{} content items", tool_result.content.len()),
                            }).await;
                            self.format_tool_result(&tool_result)
                        }
                        Err(e) => {
                            // 发送 AG-UI 事件：工具调用失败
                            self.ag_ui.emit_event(AgUiEvent::ToolError {
                                step: step_idx + 1,
                                tool_name: tool_name.clone(),
                                error: e.to_string(),
                            }).await;
                            format!("工具调用失败: {}", e)
                        }
                    };
                    observation
                }
                AgentAction::Respond { content } => {
                    let mut state = self.state.write().await;
                    state.status = AgentStatus::Complete;
                    
                    // 发送 AG-UI 事件：任务完成
                    self.ag_ui.emit_event(AgUiEvent::TaskComplete {
                        conversation_id: state.conversation_id.clone(),
                        final_answer: content.clone(),
                        steps_count: step_idx + 1,
                    }).await;
                    
                    return Ok(AgentRunResult {
                        final_answer: content,
                        steps,
                        tools_used: state.tools_used.clone(),
                    });
                }
                AgentAction::AskUser { question } => {
                    let mut state = self.state.write().await;
                    state.status = AgentStatus::Idle;
                    
                    self.ag_ui.emit_event(AgUiEvent::RequiresUserInput {
                        question: question.clone(),
                    }).await;
                    
                    return Ok(AgentRunResult {
                        final_answer: question,
                        steps,
                        requires_user_input: true,
                        ..Default::default()
                    });
                }
            };
            
            steps.push(ReActStep {
                step_number: step_idx + 1,
                thought: thought.clone(),
                action: action.clone(),
                observation: observation.clone(),
            });
            
            {
                let mut state = self.state.write().await;
                state.step_count = step_idx + 1;
                if let AgentAction::ToolCall { ref tool_name, .. } = action {
                    state.tools_used.push(tool_name.clone());
                }
            }
            
            current_query = observation;
            self.manage_context_window().await?;
        }
        
        Err(AgentError::MaxStepsReached(steps))
    }

    /// 构建系统提示词（包含可用工具列表）
    async fn build_system_prompt(&self) -> String {
        let base_prompt = r#"你是一个科研助手 Agent..."#;
        let tools = self.mcp_hub.list_available_tools().await.unwrap_or_default();
        let tool_desc = tools.iter()
            .map(|t| format!("- {}: {}", t.info.name, t.info.description))
            .collect::<Vec<_>>().join("\n");
        base_prompt.replace("{}  <!-- 动态填入工具列表 -->", &tool_desc)
    }
}
```

### 3.4 Tauri Command 接口

```rust
#[tauri::command]
pub async fn agent_run(
    runtime: State<'_, AgentRuntime>,
    query: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let conversation_id = uuid::Uuid::new_v4().to_string();
    let runtime_clone = Arc::clone(&runtime.0);
    let app_clone = app.clone();
    
    tokio::spawn(async move {
        let result = runtime_clone.run(query).await;
        match result {
            Ok(run_result) => {
                app_clone.emit("agent:complete", serde_json::json!({
                    "conversation_id": conversation_id,
                    "result": run_result,
                })).ok();
            }
            Err(e) => {
                app_clone.emit("agent:error", serde_json::json!({
                    "conversation_id": conversation_id,
                    "error": e.to_string(),
                })).ok();
            }
        }
    });
    
    Ok(conversation_id)
}
```

### 3.5 数据库新增表

```sql
CREATE TABLE IF NOT EXISTS agent_memories (
    conversation_id TEXT PRIMARY KEY,
    messages        TEXT NOT NULL DEFAULT '[]',
    summary         TEXT,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    query           TEXT NOT NULL,
    final_answer    TEXT,
    steps_json      TEXT NOT NULL DEFAULT '[]',
    tools_used      TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'running',
    error_message   TEXT,
    started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    duration_ms     INTEGER
);
```

### 3.6 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | 核心数据结构定义 | 2h |
| 2 | MemoryStore 接口 + SQLite 实现 | 4h |
| 3 | Cloud LLM Client 封装（SSE 流式 + Function Calling） | 4h |
| 4 | ReAct 循环核心逻辑 | 5h |
| 5 | 上下文窗口管理（摘要机制） | 3h |
| 6 | Tauri command 接口 | 2h |
| 7 | 数据库迁移 | 1h |
| 8 | 集成测试 | 4h |

**Phase 2 总工作量：约 25 小时**

---

## 4. Phase 3: Agentic RAG 检索引擎

### 4.1 目标

将现有静态向量检索升级为 Agentic RAG，支持查询分解、多源路由、多跳推理和相关性评估。Embedding 使用本地 ONNX 模型，LLM 推理使用云端 API。

### 4.2 查询分解器

```rust
// src-tauri/src/rag/mod.rs

pub struct QueryDecomposer {
    cloud_client: Arc<CloudLlmClient>,  // 云端 LLM 分解查询
}

impl QueryDecomposer {
    pub async fn decompose(&self, query: &str) -> Result<Vec<SubQuery>, RagError> {
        let prompt = format!(
            "将以下科研查询分解为多个子查询...\n\n查询: {}\n\n以 JSON 数组输出:",
            query
        );
        let response = self.cloud_client.chat_simple(&prompt).await?;
        let sub_queries: Vec<SubQuery> = serde_json::from_str(&response)?;
        Ok(sub_queries)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubQuery {
    pub query: String,
    pub query_type: QueryType,
    pub target_sources: Vec<RetrievalSource>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum QueryType {
    Methodology, Experimental, Review, RecentProgress, CodeImplementation,
}
```

### 4.3 混合检索实现（sqlite-vec）

```rust
pub struct LocalSearcher {
    db: tauri_plugin_sql::DbInstance,
    embedder: Arc<OnnxEmbedder>,  // 本地 ONNX 嵌入模型
    bm25_enabled: bool,
}

impl LocalSearcher {
    pub async fn search(&self, query: &str, top_k: usize) -> Result<Vec<RetrievalResult>, RagError> {
        // 本地 ONNX 编码查询向量
        let embedding = self.embedder.encode(query).await?;
        
        // 向量检索（sqlite-vec）
        let vector_results = self.vector_search(&embedding, top_k * 2).await?;
        
        // BM25 关键词检索
        let keyword_results = if self.bm25_enabled {
            self.bm25_search(query, top_k * 2).await?
        } else { vec![] };
        
        // RRF 融合排序
        self.reciprocal_rank_fusion(vector_results, keyword_results, top_k)
    }
}
```

### 4.4 数据库迁移

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_vec USING vec0(
    doc_id TEXT,
    page_number INTEGER,
    chunk_index INTEGER,
    embedding float[384] distance=cosine
);

CREATE TABLE IF NOT EXISTS rag_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    query_hash  TEXT NOT NULL UNIQUE,
    query       TEXT NOT NULL,
    results     TEXT NOT NULL DEFAULT '[]',
    expires_at  DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rag_cache_hash ON rag_cache(query_hash);
```

### 4.5 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | sqlite-vec 集成（Rust FFI） | 4h |
| 2 | QueryDecomposer + RetrievalRouter | 4h |
| 3 | LocalSearcher（混合检索 + RRF） | 5h |
| 4 | MultiHopRetriever + RelevanceEvaluator | 5h |
| 5 | 数据库迁移 | 2h |
| 6 | 集成测试 | 4h |

**Phase 3 总工作量：约 24 小时**

---

## 5. Phase 4: AG-UI 流式状态反馈与动画系统

### 5.1 目标

解决"AI 执行任务时黑盒等待"的核心痛点。通过 AG-UI（Agent-User Interaction Protocol）标准，将 Agent 内部的思考过程、工具调用、进度状态实时推送到前端，配合动画效果让助手"灵动起来"。

### 5.2 核心痛点

```
当前用户等待体验：

用户说："帮我调研蛋白质结构预测的最新进展"
    ↓
界面卡住 30-120 秒，没有任何反馈
    ↓
用户不知道 AI 在干什么
    ↓
用户焦虑，以为程序崩溃了，反复点击
    ↓
最后突然出现一大段文字

工业级标准体验（Anthropic / Cursor / ChatGPT Canvas）：

用户说同样的话
    ↓
AI 实时展示：
  [思考中...] 正在分析你的研究问题
  [工具调用] 正在搜索 arXiv: "protein structure prediction"
  [进度条] 已检索 15 篇论文，筛选中...
  [工具调用] 正在搜索 Semantic Scholar
  [分析中] 对比各方法在 CASP15 上的表现
  [完成] 生成综述大纲
    ↓
用户全程可见进度，可以中途取消或调整
```

### 5.3 事件流设计

```rust
// src-tauri/src/ag_ui/mod.rs

/// AG-UI 事件类型（实时推送到前端）
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum AgUiEvent {
    // 任务生命周期
    TaskStarted { conversation_id: String, query: String },
    TaskComplete { conversation_id: String, final_answer: String, steps_count: u32 },
    TaskError { conversation_id: String, error: String },
    TaskCancelled { conversation_id: String },
    
    // 思考过程（Chain of Thought 可视化）
    Thinking { step: u32, max_steps: u32 },
    ThoughtComplete { step: u32, thought: String },
    SelfCorrection { step: u32, original_thought: String, corrected_thought: String },
    
    // 工具调用进度
    ToolCalling { step: u32, tool_name: String, arguments: serde_json::Value },
    ToolProgress { step: u32, tool_name: String, progress_percent: u8, detail: String },
    ToolResult { step: u32, tool_name: String, result: String },
    ToolError { step: u32, tool_name: String, error: String },
    
    // 检索进度
    Searching { source: String, query: String },
    SearchResult { source: String, found_count: usize, relevant_count: usize },
    
    // 用户交互
    RequiresUserInput { question: String },
    
    // 心跳（防止前端认为卡死）
    Heartbeat { timestamp: i64, status: String },
}

/// AG-UI 事件流发射器
pub struct AgUiEventStream {
    app_handle: tauri::AppHandle,
}

impl AgUiEventStream {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
    
    /// 发射事件到前端（通过 Tauri Event）
    pub async fn emit_event(&self, event: AgUiEvent) {
        let event_type = match &event {
            AgUiEvent::TaskStarted { .. } => "ag-ui:task-started",
            AgUiEvent::Thinking { .. } => "ag-ui:thinking",
            AgUiEvent::ThoughtComplete { .. } => "ag-ui:thought-complete",
            AgUiEvent::ToolCalling { .. } => "ag-ui:tool-calling",
            AgUiEvent::ToolProgress { .. } => "ag-ui:tool-progress",
            AgUiEvent::ToolResult { .. } => "ag-ui:tool-result",
            AgUiEvent::Searching { .. } => "ag-ui:searching",
            AgUiEvent::SearchResult { .. } => "ag-ui:search-result",
            AgUiEvent::RequiresUserInput { .. } => "ag-ui:requires-input",
            AgUiEvent::TaskComplete { .. } => "ag-ui:task-complete",
            AgUiEvent::TaskError { .. } => "ag-ui:task-error",
            AgUiEvent::Heartbeat { .. } => "ag-ui:heartbeat",
            _ => "ag-ui:event",
        };
        
        let payload = serde_json::to_value(&event).unwrap_or_default();
        self.app_handle.emit(event_type, payload).ok();
    }
    
    /// 启动心跳任务（每 2 秒发送一次，防止前端卡死检测）
    pub fn start_heartbeat(&self, conversation_id: String) {
        let app = self.app_handle.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(2));
            loop {
                interval.tick().await;
                app.emit("ag-ui:heartbeat", serde_json::json!({
                    "conversation_id": conversation_id,
                    "timestamp": chrono::Utc::now().timestamp_millis(),
                    "status": "alive",
                })).ok();
            }
        });
    }
}
```

### 5.4 前端动画映射（后端需配合的事件）

后端发射的事件，前端如何渲染成动画：

| 后端事件 | 前端动画效果 | 实现方式 |
|---------|------------|---------|
| `ag-ui:thinking` | 灵动脉冲圆点 + "思考中..." 文字 | 三个圆点依次缩放动画 |
| `ag-ui:thought-complete` | 思考步骤卡片滑入时间线 | CSS transition + stagger delay |
| `ag-ui:tool-calling` | 工具图标旋转 + 名称高亮 | SVG 旋转动画 + 发光边框 |
| `ag-ui:tool-progress` | 进度条填充 + 百分比数字跳动 | CSS width transition + 计数器动画 |
| `ag-ui:searching` | 搜索图标脉冲 + 来源标签闪烁 | keyframes pulse + opacity 变化 |
| `ag-ui:search-result` | 结果数字"弹跳"出现 | CSS scale bounce |
| `ag-ui:heartbeat` | 状态指示灯绿色闪烁 | 2s 间隔 opacity 变化 |
| `ag-ui:task-complete` | 完成徽章弹出 + 彩虹光效 | CSS scale + 渐变色彩 |
| `ag-ui:self-correction` | 原步骤变灰/划掉，新步骤高亮 | CSS text-decoration + color transition |

### 5.5 状态徽章系统（供前端使用）

后端在工具调用时，向前端推送标准化的状态徽章：

```rust
#[derive(Debug, Clone, Serialize)]
pub struct StatusBadge {
    pub icon: String,           // emoji 或 SVG 图标名称
    pub label: String,          // 显示文字
    pub color: BadgeColor,      // 色彩主题
    pub animation: AnimationType,
}

#[derive(Debug, Clone, Serialize)]
pub enum BadgeColor {
    Blue,      // 思考中 / 分析中
    Green,     // 完成 / 成功
    Orange,    // 工具调用中
    Purple,    // 检索中
    Red,       // 错误 / 失败
    Gray,      // 等待中
}

#[derive(Debug, Clone, Serialize)]
pub enum AnimationType {
    Pulse,     // 脉冲（思考中）
    Spin,      // 旋转（工具调用）
    Bounce,    // 弹跳（完成）
    SlideIn,   // 滑入（新步骤）
    Fade,      // 淡入淡出（状态变更）
    Shake,     // 抖动（错误）
}
```

### 5.6 Tauri Command 接口

```rust
/// 前端订阅 AG-UI 事件（通过 listen）
/// 无需 invoke，前端直接使用:
/// import { listen } from '@tauri-apps/api/event'
/// const unlisten = await listen('ag-ui:thinking', (event) => { ... })

/// 取消正在运行的 Agent 任务
#[tauri::command]
pub async fn agent_cancel(
    runtime: State<'_, AgentRuntime>,
    conversation_id: String,
) -> Result<(), String> {
    runtime.0.cancel(&conversation_id).await.map_err(|e| e.to_string())
}
```

### 5.7 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | AgUiEvent 枚举定义 + 序列化 | 2h |
| 2 | AgUiEventStream 发射器实现 | 3h |
| 3 | 集成到 Agent Runtime（每个步骤发射事件） | 4h |
| 4 | 心跳系统实现 | 1h |
| 5 | 任务取消机制（AbortController Rust 等效） | 3h |
| 6 | 集成测试（验证事件流完整性） | 3h |

**Phase 4 总工作量：约 16 小时**

---

## 6. Phase 5: 本地推理层（仅嵌入模型）

### 6.1 目标

**仅保留嵌入模型和轻量级分类模型的本地推理，其余所有 LLM 任务使用云端 API**。这是基于"普通用户电脑配置有限"的现实约束做出的决策。

### 6.2 明确的设计边界

```
┌────────────────────────────────────────────────────────────┐
│                    本地推理（ONNX Runtime）                   │
│                    内存占用 < 500MB                           │
├────────────────────────────────────────────────────────────┤
│  ✅ Embedding 编码（all-MiniLM-L6-v2，22MB）               │
│     - 知识库文档索引                                        │
│     - 查询向量编码                                          │
│     - 相似度计算                                            │
│                                                             │
│  ✅ 意图分类模型（DistilBERT，66MB）                        │
│     - 用户输入意图识别（搜索/聊天/写作/翻译）               │
│     - 路由决策辅助                                          │
│                                                             │
│  ✅ 相关性评分模型（轻量 Cross-Encoder，~100MB）          │
│     - RAG 检索结果重排序                                    │
│     - 多跳检索相关性判断                                    │
│                                                             │
│  ✅ Whisper base（74MB，可选 small 244MB）                 │
│     - 语音转文字（Phase 8）                                 │
│                                                             │
└────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────┐
│                    云端 API（全部 LLM 任务）                  │
│                    需要网络连接                               │
├────────────────────────────────────────────────────────────┤
│  ✅ 对话问答（GPT-4 / Claude / DeepSeek）                   │
│  ✅ 文献综述生成                                            │
│  ✅ 翻译润色                                                │
│  ✅ 代码生成                                                │
│  ✅ 实验设计                                                │
│  ✅ 查询分解（Agentic RAG）                                 │
│  ✅ 摘要生成                                                │
│  ✅ 论文分析                                                │
│                                                             │
│  理由：普通电脑无法流畅运行 7B+ 模型                        │
│       云端模型能力更强、更可靠                              │
│       用户已配置 API key，使用习惯已建立                    │
└────────────────────────────────────────────────────────────┘
```

### 6.3 ONNX Runtime 封装

```rust
// src-tauri/src/local_inference/mod.rs

pub struct OnnxRuntime {
    embedding_session: ort::Session,
    classifier_session: ort::Session,
    cross_encoder_session: ort::Session,
}

impl OnnxRuntime {
    pub fn new(models_dir: &std::path::Path) -> Result<Self, InferenceError> {
        let embedding_session = ort::Session::builder()?
            .with_model_from_file(models_dir.join("all-MiniLM-L6-v2.onnx"))?;
        let classifier_session = ort::Session::builder()?
            .with_model_from_file(models_dir.join("intent-classifier.onnx"))?;
        let cross_encoder_session = ort::Session::builder()?
            .with_model_from_file(models_dir.join("cross-encoder.onnx"))?;
        
        Ok(Self {
            embedding_session,
            classifier_session,
            cross_encoder_session,
        })
    }
    
    /// 文本嵌入编码（供 RAG 使用）
    pub fn encode(&self, text: &str) -> Result<Vec<f32>, InferenceError> {
        // Tokenize → ONNX 推理 → 提取向量
        let input = self.tokenize(text);
        let outputs = self.embedding_session.run(vec![input])?;
        let embedding = outputs[0].try_extract::<f32>()?;
        Ok(embedding.view().to_slice().unwrap().to_vec())
    }
    
    /// 意图分类（供路由决策使用）
    pub fn classify_intent(&self, text: &str) -> Result<Intent, InferenceError> {
        let input = self.tokenize(text);
        let outputs = self.classifier_session.run(vec![input])?;
        let logits = outputs[0].try_extract::<f32>()?;
        // 取 softmax → 最大概率标签
        Ok(self.logits_to_intent(logits.view()))
    }
    
    /// 相关性评分（供 RAG 重排序使用）
    pub fn score_relevance(&self, query: &str, document: &str) -> Result<f32, InferenceError> {
        let input = self.tokenize_pair(query, document);
        let outputs = self.cross_encoder_session.run(vec![input])?;
        let score = outputs[0].try_extract::<f32>()?;
        Ok(score.view()[[0, 0]])
    }
}

#[derive(Debug, Clone, Serialize)]
pub enum Intent {
    Chat,       // 闲聊/问答
    Search,     // 知识库检索
    Write,      // 写作/润色
    Translate,  // 翻译
    Analyze,    // 分析
    Workflow,   // 工作流
}
```

### 6.4 模型按需下载

```rust
/// 模型管理器：按需下载，不预装
pub struct ModelManager {
    models_dir: std::path::PathBuf,
}

impl ModelManager {
    /// 检查模型是否存在，不存在则下载
    pub async fn ensure_model(&self, model_name: &str) -> Result<std::path::PathBuf, ModelError> {
        let model_path = self.models_dir.join(format!("{}.onnx", model_name));
        if model_path.exists() {
            return Ok(model_path);
        }
        
        // 下载模型（从 HuggingFace 或国内镜像）
        let download_url = match model_name {
            "all-MiniLM-L6-v2" => "https://hf-mirror.com/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx",
            "intent-classifier" => "https://hf-mirror.com/...",
            _ => return Err(ModelError::UnknownModel(model_name.to_string())),
        };
        
        let response = reqwest::get(download_url).await?;
        let bytes = response.bytes().await?;
        tokio::fs::write(&model_path, bytes).await?;
        
        Ok(model_path)
    }
}
```

### 6.5 Tauri Command 接口

```rust
/// 检查本地推理层是否就绪
#[tauri::command]
pub async fn inference_check_status() -> Result<InferenceStatus, String> {
    Ok(InferenceStatus {
        embedding_ready: model_exists("all-MiniLM-L6-v2"),
        classifier_ready: model_exists("intent-classifier"),
        whisper_ready: model_exists("whisper-base"),
    })
}

/// 下载模型（用户确认后触发）
#[tauri::command]
pub async fn inference_download_model(model_name: String) -> Result<(), String> {
    let manager = ModelManager::new();
    manager.ensure_model(&model_name).await.map_err(|e| e.to_string())
}
```

### 6.6 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | ONNX Runtime Rust 集成 | 3h |
| 2 | Embedding 模型封装 | 2h |
| 3 | 意图分类模型封装 | 2h |
| 4 | 相关性评分模型封装 | 2h |
| 5 | 模型管理器（按需下载） | 2h |
| 6 | Tauri command 接口 | 1h |
| 7 | 集成测试 | 2h |

**Phase 5 总工作量：约 14 小时**

---

## 7. Phase 6: Workflow 引擎

### 7.1 目标

实现可视化工作流引擎，支持 DAG 执行、12+ 节点类型、模板库和状态持久化。所有 LLM 节点调用云端 API。

### 7.2 DAG 执行器核心

```rust
// src-tauri/src/workflow/mod.rs

pub struct Workflow {
    pub id: String,
    pub name: String,
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub trigger: TriggerConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum NodeType {
    Trigger { trigger_type: TriggerType },
    Ai { model: String, temperature: f32, system_prompt: String },  // 调用云端 LLM
    Retrieval { sources: Vec<String>, top_k: usize },
    Tool { tool_name: String, arguments: serde_json::Value },
    Condition { expression: String },
    Loop { iterator: String, sub_workflow: String },
    Aggregate { strategy: AggregateStrategy },
    HumanInLoop { prompt: String },
    Output { format: OutputFormat },
    Delay { duration_ms: u64 },
    VoiceMemo { auto_transcribe: bool },  // Phase 8 集成
    MemoryRecall { key_pattern: String },   // Phase 9 集成
}

pub struct DagExecutor {
    db: tauri_plugin_sql::DbInstance,
    mcp_hub: Arc<McpHub>,
    agent_runtime: Arc<AgentRuntime>,
    ag_ui: Arc<AgUiEventStream>,
}

impl DagExecutor {
    pub async fn execute(&self, workflow_id: &str) -> Result<ExecutionResult, WorkflowError> {
        let workflow = self.load_workflow(workflow_id).await?;
        let execution_id = self.create_execution(workflow_id).await?;
        let execution_order = self.topological_sort(&workflow)?;
        let mut context: HashMap<String, serde_json::Value> = HashMap::new();
        
        for node_id in execution_order {
            let node = workflow.nodes.iter().find(|n| n.id == node_id)
                .ok_or(WorkflowError::NodeNotFound(node_id))?;
            
            self.update_execution_status(&execution_id, &node_id, "running").await?;
            
            // 发送 AG-UI 事件
            self.ag_ui.emit_event(AgUiEvent::WorkflowNodeRunning {
                workflow_id: workflow_id.to_string(),
                node_id: node_id.clone(),
                node_type: format!("{:?}", node.node_type),
            }).await;
            
            let result = self.execute_node(node, &context).await;
            
            match result {
                Ok(output) => {
                    context.insert(node_id, output);
                    self.update_execution_status(&execution_id, &node_id, "completed").await?;
                }
                Err(e) => {
                    self.update_execution_status(&execution_id, &node_id, &format!("error: {}", e)).await?;
                    return Err(e);
                }
            }
        }
        
        self.complete_execution(&execution_id).await?;
        Ok(ExecutionResult { execution_id, context })
    }
}
```

### 7.3 数据库表

```sql
CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    nodes       TEXT NOT NULL DEFAULT '[]',
    edges       TEXT NOT NULL DEFAULT '[]',
    trigger     TEXT NOT NULL DEFAULT '{}',
    is_template INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id              TEXT PRIMARY KEY,
    workflow_id     TEXT NOT NULL REFERENCES workflows(id),
    status          TEXT NOT NULL DEFAULT 'pending',
    context         TEXT NOT NULL DEFAULT '{}',
    node_statuses   TEXT NOT NULL DEFAULT '{}',
    started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    duration_ms     INTEGER,
    error_message   TEXT
);
```

### 7.4 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | DAG 执行器核心（拓扑排序） | 5h |
| 2 | 12 种节点类型实现 | 8h |
| 3 | AG-UI 集成到工作流执行 | 3h |
| 4 | 数据库表 + 预设模板 | 3h |
| 5 | Tauri command 接口 | 2h |
| 6 | 集成测试 | 3h |

**Phase 6 总工作量：约 24 小时**

---

## 8. Phase 7: PDF 多模态解析重构

### 8.1 目标

将 PDF 解析从 pdfjs-dist 升级为 Docling MCP Server，实现高精度结构化解析。

### 8.2 Docling MCP Server

```python
# src-tauri/src/mcp_servers/docling_server.py

from docling.document_converter import DocumentConverter
import json
import sys

def main():
    converter = DocumentConverter()
    for line in sys.stdin:
        request = json.loads(line)
        method = request.get("method", "")
        params = request.get("params", {})
        req_id = request.get("id", 0)
        
        if method == "tools/list":
            print(json.dumps({
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "tools": [
                        {
                            "name": "docling_parse_pdf",
                            "description": "Parse PDF to structured markdown with layout",
                            "parameters": {
                                "type": "object",
                                "properties": {
                                    "file_path": {"type": "string"},
                                    "include_images": {"type": "boolean", "default": False}
                                },
                                "required": ["file_path"]
                            }
                        }
                    ]
                }
            }), flush=True)
            
        elif method == "tools/call":
            tool_name = params.get("name", "")
            args = params.get("arguments", {})
            
            if tool_name == "docling_parse_pdf":
                file_path = args.get("file_path", "")
                result = converter.convert(file_path)
                print(json.dumps({
                    "jsonrpc": "2.0", "id": req_id,
                    "result": {
                        "content": [{
                            "type": "text",
                            "text": json.dumps({
                                "markdown": result.document.export_to_markdown(),
                                "title": result.document.title,
                                "tables": [t.export_to_dataframe().to_dict() for t in result.document.tables],
                            })
                        }]
                    }
                }), flush=True)

if __name__ == "__main__":
    main()
```

### 8.3 语义分块

```rust
/// 基于 Markdown 标题层级的语义分块
fn semantic_chunk(&self, markdown: &str) -> Result<Vec<Chunk>, PdfError> {
    let mut chunks: Vec<Chunk> = Vec::new();
    let mut current_chunk = String::new();
    let mut current_page = 1;
    let mut chunk_index = 0;
    
    for line in markdown.lines() {
        // 标题行触发新块
        if line.starts_with("# ") || line.starts_with("## ") || line.starts_with("### ") {
            if !current_chunk.is_empty() {
                chunks.push(Chunk {
                    content: current_chunk.trim().to_string(),
                    page_number: current_page,
                    index: chunk_index,
                });
                chunk_index += 1;
                current_chunk.clear();
            }
        }
        current_chunk.push_str(line);
        current_chunk.push('\n');
    }
    
    if !current_chunk.is_empty() {
        chunks.push(Chunk {
            content: current_chunk.trim().to_string(),
            page_number: current_page,
            index: chunk_index,
        });
    }
    
    Ok(chunks)
}
```

### 8.4 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | Docling MCP Server 开发 | 3h |
| 2 | sqlite-vec 集成 | 4h |
| 3 | 语义分块实现 | 2h |
| 4 | 索引流程重构 | 3h |
| 5 | 集成测试 | 3h |

**Phase 7 总工作量：约 15 小时**

---

## 9. Phase 8: Voice 语音交互层

### 9.1 目标

集成 Whisper 本地语音识别，让用户可以**按住快捷键说话**，2 秒内转为文字输入。这是提升科研人员输入效率的关键功能——口述比打字快 3 倍。

### 9.2 为什么选 Whisper 本地？

| 方案 | 延迟 | 隐私 | 离线 | 费用 | 适合场景 |
|------|------|------|------|------|---------|
| **Whisper base 本地** | 1-2s | ✅ 完全本地 | ✅ 可离线 | 零 | 日常口述笔记 |
| **Whisper small 本地** | 2-4s | ✅ 完全本地 | ✅ 可离线 | 零 | 高准确度需求 |
| **OpenAI Whisper API** | 1-3s | ❌ 上传音频 | ❌ 需联网 | 按分钟计费 | 不推荐 |
| **Google Speech API** | 1-2s | ❌ 上传音频 | ❌ 需联网 | 按分钟计费 | 不推荐 |

**选择**：Whisper base 本地（74MB 模型，1GB 内存即可运行，所有电脑都能跑）。

### 9.3 交互设计

```
按住 Ctrl+Alt+V（可配置）
    ↓
听到"滴"声提示开始录音
    ↓
说话："帮我搜索最近关于蛋白质折叠的论文"
    ↓
松开按键
    ↓
"滴"声提示录音结束
    ↓
1-2 秒后文字出现在当前输入框
    ↓
自动发送（或等待用户确认）
```

### 9.4 核心实现

```rust
// src-tauri/src/voice/mod.rs

use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};

pub struct VoiceRecognizer {
    whisper: WhisperContext,
    sample_rate: u32,
}

impl VoiceRecognizer {
    pub fn new(model_path: &str) -> Result<Self, VoiceError> {
        let params = WhisperContextParameters::default();
        let whisper = WhisperContext::new_with_params(model_path, params)
            .map_err(|e| VoiceError::ModelLoad(e.to_string()))?;
        
        Ok(Self {
            whisper,
            sample_rate: 16000,
        })
    }
    
    /// 将音频 PCM 数据转文字
    pub fn transcribe(&self, pcm_data: &[f32]) -> Result<String, VoiceError> {
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language("auto");  // 自动检测语言
        params.set_translate(false);
        params.set_no_context(true);
        
        let mut state = self.whisper.create_state()
            .map_err(|e| VoiceError::StateCreate(e.to_string()))?;
        
        state.full(params, pcm_data)
            .map_err(|e| VoiceError::Transcription(e.to_string()))?;
        
        let num_segments = state.full_n_segments()
            .map_err(|e| VoiceError::SegmentCount(e.to_string()))?;
        
        let mut text = String::new();
        for i in 0..num_segments {
            let segment = state.full_get_segment_text(i)
                .map_err(|e| VoiceError::SegmentText(e.to_string()))?;
            text.push_str(&segment);
            text.push(' ');
        }
        
        Ok(text.trim().to_string())
    }
}

/// 音频录制器
pub struct AudioRecorder {
    recording: bool,
    buffer: Vec<f32>,
}

impl AudioRecorder {
    pub fn start_recording(&mut self) {
        self.recording = true;
        self.buffer.clear();
    }
    
    pub fn stop_recording(&mut self) -> Vec<f32> {
        self.recording = false;
        self.buffer.clone()
    }
    
    pub fn push_samples(&mut self, samples: &[f32]) {
        if self.recording {
            self.buffer.extend_from_slice(samples);
        }
    }
}
```

### 9.5 Tauri Command 接口

```rust
/// 开始录音（按住快捷键时调用）
#[tauri::command]
pub async fn voice_start_recording(state: State<'_, VoiceState>) -> Result<(), String> {
    let mut recorder = state.recorder.lock().await;
    recorder.start_recording();
    
    // 播放提示音
    state.play_beep().await;
    
    Ok(())
}

/// 停止录音并转文字（松开快捷键时调用）
#[tauri::command]
pub async fn voice_stop_and_transcribe(
    state: State<'_, VoiceState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let mut recorder = state.recorder.lock().await;
    let pcm_data = recorder.stop_recording();
    drop(recorder);
    
    // 播放结束提示音
    state.play_beep().await;
    
    // 转文字
    let recognizer = state.recognizer.lock().await;
    let text = recognizer.transcribe(&pcm_data)
        .map_err(|e| e.to_string())?;
    
    // 发送到前端
    app.emit("voice:transcription-complete", serde_json::json!({
        "text": text,
        "confidence": 0.95,  // 可扩展
    })).ok();
    
    Ok(text)
}
```

### 9.6 数据库表

```sql
CREATE TABLE IF NOT EXISTS voice_memos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT,
    text        TEXT NOT NULL,
    audio_path  TEXT,
    duration_ms INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 9.7 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | whisper-rs 集成（Rust 绑定） | 3h |
| 2 | 音频录制器（Web Audio API → Tauri） | 3h |
| 3 | 语音转文字核心逻辑 | 2h |
| 4 | 快捷键绑定（Ctrl+Alt+V） | 1h |
| 5 | 提示音 + 动画反馈 | 2h |
| 6 | 数据库表 + Tauri command | 1h |
| 7 | 集成测试 | 2h |

**Phase 8 总工作量：约 14 小时**

---

## 10. Phase 9: Memory 记忆系统

### 10.1 目标

让科研助手**跨会话记住用户偏好和习惯**，每次打开应用时自动加载相关记忆，无需从零开始。

### 10.2 记忆类型

| 记忆类型 | 内容 | 自动学习 | 使用场景 |
|---------|------|---------|---------|
| **研究领域** | 用户的科研方向关键词 | 从对话中提取 | 打开时自动推荐相关文献 |
| **偏好设置** | 喜欢的模型/语言/引用格式 | 用户显式设置 | 新对话自动应用 |
| **常用工具** | 经常调用的 MCP 工具 | 从工具调用记录统计 | 优先推荐常用工具 |
| **输出风格** | 喜欢的回答长度/格式 | 用户反馈（点赞/修改） | 生成内容自动匹配风格 |
| **项目关联** | 各项目的关键文献/笔记 | 手动标记 | 切换项目时自动加载上下文 |
| **人员网络** | 合作者、导师、常引作者 | 从 Zotero/知识库提取 | 写论文时推荐引用 |

### 10.3 核心实现

```rust
// src-tauri/src/memory/mod.rs

pub struct MemorySystem {
    db: tauri_plugin_sql::DbInstance,
    cloud_client: Arc<CloudLlmClient>,  // 云端模型提取记忆
}

impl MemorySystem {
    /// 从对话中自动提取记忆
    pub async fn extract_from_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        let conversation = self.load_conversation(conversation_id).await?;
        
        // 使用云端 LLM 提取结构化记忆
        let prompt = format!(
            "从以下对话中提取用户的科研偏好和习惯。\n\n对话:\n{}\n\n以 JSON 输出:",
            conversation
        );
        
        let response = self.cloud_client.chat_simple(&prompt).await?;
        let entries: Vec<MemoryEntry> = serde_json::from_str(&response)?;
        
        // 保存到数据库
        for entry in &entries {
            self.save_entry(entry).await?;
        }
        
        Ok(entries)
    }
    
    /// 加载与用户当前任务相关的记忆
    pub async fn load_relevant_memories(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<MemoryEntry>, MemoryError> {
        // 本地 ONNX 编码查询向量
        let query_embedding = self.local_embedder.encode(query).await?;
        
        // 向量检索相关记忆
        let memories = self.db.select(
            "SELECT key, value, category, confidence 
             FROM memory_entries 
             ORDER BY vec_distance_euclidean(embedding, vec_f32(?)) ASC
             LIMIT ?",
            vec![
                serde_json::to_string(&query_embedding)?.into(),
                (limit as i64).into(),
            ],
        ).await?;
        
        Ok(memories.into_iter().map(|row| MemoryEntry {
            key: row.get("key").unwrap_or_default(),
            value: row.get("value").unwrap_or_default(),
            category: row.get("category").unwrap_or_default(),
            confidence: row.get::<f64>("confidence").unwrap_or(1.0) as f32,
        }).collect())
    }
    
    /// 注入记忆到 Agent 上下文
    pub async fn inject_into_context(
        &self,
        conversation_id: &str,
        query: &str,
    ) -> Result<String, MemoryError> {
        let memories = self.load_relevant_memories(query, 5).await?;
        
        if memories.is_empty() {
            return Ok(String::new());
        }
        
        let context = memories.iter()
            .map(|m| format!("- {}: {} (置信度: {:.0}%)", m.key, m.value, m.confidence * 100.0))
            .collect::<Vec<_>>()
            .join("\n");
        
        Ok(format!("\n[用户偏好记忆]\n{}\n", context))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryEntry {
    pub key: String,
    pub value: String,
    pub category: String,       // research_field / preference / tool / style / project / person
    pub confidence: f32,        // 0-1
    pub embedding: Vec<f32>,    // 用于向量检索
}
```

### 10.4 数据库表

```sql
CREATE TABLE IF NOT EXISTS memory_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'general',
    confidence  REAL NOT NULL DEFAULT 1.0,
    embedding   TEXT,  -- JSON Vec<f32>
    source      TEXT,  -- auto_extracted / user_set / inferred
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_entries(category);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
    key TEXT,
    embedding float[384] distance=cosine
);
```

### 10.5 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | MemorySystem 核心实现 | 4h |
| 2 | 记忆自动提取（LLM 调用） | 3h |
| 3 | 记忆向量检索集成 | 2h |
| 4 | 记忆注入 Agent 上下文 | 2h |
| 5 | 数据库表 + 迁移 | 1h |
| 6 | 集成测试 | 2h |

**Phase 9 总工作量：约 14 小时**

---

## 11. Phase 10: Computer Use 桌面自动化

### 11.1 目标

让 AI **理解屏幕内容并操作应用程序**。这是科研助手的终极能力——不只是聊天窗口里的助手，而是能真正帮你操作 PDF 阅读器、代码编辑器、浏览器的桌面伙伴。

### 11.2 应用场景

| 场景 | AI 操作 | 用户收益 |
|------|---------|---------|
| PDF 精读 | 自动翻页到你上次阅读的位置，提取当前页公式 | 无缝续读 |
| 文献对比 | 打开两个 PDF 窗口，高亮相同术语的不同表述 | 快速对比 |
| 代码复现 | 读取论文中的伪代码，在 VS Code 中生成实现 | 加速复现 |
| 实验记录 | 截图当前终端输出，自动记录到实验快照 | 一键记录 |
| 数据整理 | 打开 Excel，按论文表格格式填入数据 | 减少手工操作 |

### 11.3 实现策略

基于现有 `window_detector.rs` 和 `screenshot.rs` 扩展：

```rust
// src-tauri/src/computer_use/mod.rs

pub struct ComputerUseAgent {
    window_detector: Arc<WindowDetector>,
    screenshot: Arc<ScreenshotService>,
    uiautomation: Arc<UiAutomationService>,
    cloud_client: Arc<CloudLlmClient>,  // 云端 Vision 模型理解屏幕
    mcp_hub: Arc<McpHub>,
}

impl ComputerUseAgent {
    /// 分析当前屏幕状态
    pub async fn analyze_screen(&self) -> Result<ScreenState, ComputerUseError> {
        // 1. 截图
        let screenshot_b64 = self.screenshot.capture_fullscreen().await?;
        
        // 2. 获取当前窗口信息
        let window = self.window_detector.get_active_window().await?;
        
        // 3. 使用云端 Vision 模型分析截图
        let prompt = format!(
            "分析以下屏幕截图。当前活动窗口: {} ({})。\n\n描述屏幕上的内容，识别可交互元素。",
            window.title, window.process_name
        );
        
        let analysis = self.cloud_client.vision_analyze(&screenshot_b64, &prompt).await?;
        
        Ok(ScreenState {
            screenshot: screenshot_b64,
            window,
            elements: analysis.elements,
            text_content: analysis.text,
        })
    }
    
    /// 执行操作序列
    pub async fn execute_actions(&self, actions: Vec<ComputerAction>) -> Result<(), ComputerUseError> {
        for action in actions {
            match action {
                ComputerAction::Click { x, y } => {
                    self.uiautomation.click(x, y).await?;
                }
                ComputerAction::Type { text } => {
                    self.uiautomation.type_text(&text).await?;
                }
                ComputerAction::KeyCombo { keys } => {
                    self.uiautomation.key_combo(&keys).await?;
                }
                ComputerAction::Scroll { direction, amount } => {
                    self.uiautomation.scroll(direction, amount).await?;
                }
                ComputerAction::Wait { ms } => {
                    tokio::time::sleep(Duration::from_millis(ms)).await;
                }
            }
        }
        Ok(())
    }
}
```

### 11.4 安全约束

```rust
/// Computer Use 安全策略
pub struct ComputerUsePolicy {
    /// 禁止操作的白名单应用（系统关键应用）
    blocked_processes: Vec<String>,
    /// 需要用户确认的危险操作
    confirmation_required: Vec<ComputerActionType>,
    /// 单次会话最大操作数
    max_actions_per_session: u32,
    /// 是否允许网络操作
    allow_network_actions: bool,
}

impl Default for ComputerUsePolicy {
    fn default() -> Self {
        Self {
            blocked_processes: vec![
                "explorer.exe".to_string(),
                "lsass.exe".to_string(),
                "csrss.exe".to_string(),
            ],
            confirmation_required: vec![
                ComputerActionType::Delete,
                ComputerActionType::Format,
                ComputerActionType::Execute,
            ],
            max_actions_per_session: 50,
            allow_network_actions: false,  // 默认不允许
        }
    }
}
```

### 11.5 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | 屏幕分析接口（截图 + Vision API） | 4h |
| 2 | UIA 操作封装（点击/输入/快捷键） | 4h |
| 3 | 操作序列执行引擎 | 3h |
| 4 | 安全策略 + 用户确认机制 | 3h |
| 5 | 与 window_detector 集成 | 2h |
| 6 | 集成测试 | 3h |

**Phase 10 总工作量：约 19 小时**

---

## 12. Phase 11: A2UI 生成式界面

### 12.1 目标

Agent 不再只是返回纯文本，而是**根据任务类型动态生成 UI 组件**——数据用图表展示、对比用表格展示、流程用时间线展示。

### 12.2 核心概念

A2UI（Agent to UI）是一种协议：Agent 输出 JSON 描述界面组件，前端渲染为真实 UI。

```rust
// src-tauri/src/a2ui/mod.rs

/// A2UI 组件定义（Agent 生成，前端渲染）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "component")]
pub enum A2uiComponent {
    Chart {
        chart_type: String,  // "bar" | "line" | "scatter" | "pie"
        data: Vec<serde_json::Value>,
        x_axis: String,
        y_axis: String,
        title: String,
    },
    Table {
        columns: Vec<String>,
        rows: Vec<Vec<serde_json::Value>>,
        title: String,
        sortable: bool,
    },
    ComparisonMatrix {
        items: Vec<String>,
        criteria: Vec<String>,
        scores: Vec<Vec<f32>>,  // [item][criterion]
        title: String,
    },
    Timeline {
        events: Vec<TimelineEvent>,
        title: String,
    },
    Card {
        title: String,
        content: String,
        metadata: HashMap<String, String>,
    },
    Badge {
        label: String,
        color: String,  // "blue" | "green" | "red" | "orange" | "purple"
        icon: String,
    },
    Progress {
        percent: u8,
        label: String,
        status: String,  // "running" | "success" | "error"
    },
    Markdown {
        content: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineEvent {
    pub timestamp: String,
    pub title: String,
    pub description: String,
    pub icon: String,
}
```

### 12.3 Agent 生成 A2UI 的决策逻辑

```rust
impl AgentRuntime {
    /// 根据任务类型选择输出格式
    async fn choose_output_format(&self, task: &TaskDescriptor) -> OutputFormat {
        match task.task_type {
            TaskType::LiteratureReview => {
                // 文献综述 → 生成结构化 Markdown + 引用表格
                OutputFormat::A2ui(vec![
                    A2uiComponent::Markdown { content: "...".to_string() },
                    A2uiComponent::Table {
                        columns: vec!["论文".to_string(), "方法".to_string(), "关键发现".to_string()],
                        rows: vec![],
                        title: "文献对比".to_string(),
                        sortable: true,
                    },
                ])
            }
            TaskType::MethodComparison => {
                // 方法对比 → 生成对比矩阵
                OutputFormat::A2ui(vec![
                    A2uiComponent::ComparisonMatrix {
                        items: vec!["Method A".to_string(), "Method B".to_string()],
                        criteria: vec!["准确率".to_string(), "速度".to_string(), "内存".to_string()],
                        scores: vec![vec![0.95, 0.8, 0.7], vec![0.88, 0.95, 0.9]],
                        title: "方法对比矩阵".to_string(),
                    },
                ])
            }
            TaskType::DataAnalysis => {
                // 数据分析 → 生成图表
                OutputFormat::A2ui(vec![
                    A2uiComponent::Chart {
                        chart_type: "bar".to_string(),
                        data: vec![],
                        x_axis: "年份".to_string(),
                        y_axis: "论文数量".to_string(),
                        title: "领域发展趋势".to_string(),
                    },
                ])
            }
            _ => OutputFormat::PlainText,
        }
    }
}
```

### 12.4 前端渲染方式

后端发送 `a2ui:component` 事件，前端 Vue 组件根据 `component` 字段动态渲染：

```typescript
// 前端监听 A2UI 事件
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen('a2ui:component', (event) => {
  const component = event.payload;
  switch (component.component) {
    case 'Chart':
      renderChart(component);  // 使用 echarts / chart.js
      break;
    case 'Table':
      renderTable(component);  // 使用自定义表格组件
      break;
    case 'ComparisonMatrix':
      renderMatrix(component); // 热力图矩阵
      break;
    case 'Timeline':
      renderTimeline(component);
      break;
    case 'Progress':
      renderProgress(component); // AG-UI 进度条
      break;
    // ...
  }
});
```

### 12.5 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | A2UI 组件 Schema 定义 | 2h |
| 2 | Agent 输出格式决策逻辑 | 3h |
| 3 | 前端动态渲染组件（Chart/Table/Matrix） | 4h |
| 4 | AG-UI 集成（A2UI 组件也是 AG-UI 事件） | 2h |
| 5 | Tauri command + 事件 | 1h |
| 6 | 集成测试 | 2h |

**Phase 11 总工作量：约 14 小时**

---

## 13. Phase 12: CRDT 离线协作与同步

### 13.1 目标

实现团队科研数据的**离线编辑后自动合并**。团队成员在断网时编辑实验记录，恢复网络后自动同步，无需人工解决冲突。

### 13.2 为什么需要 CRDT？

传统同步方式（如 Git）需要中央服务器协调，离线时无法工作。CRDT（Conflict-free Replicated Data Type）允许：
- 每个设备独立编辑
- 恢复连接后自动合并
- 数学保证不会产生冲突

### 13.3 技术选型

| 库 | 语言 | 特点 | 选择 |
|-----|------|------|------|
| **Yjs** | JS/WASM | 最成熟，文档协作标准 | ✅ 主选 |
| Automerge | Rust/JS | 简洁但性能差 | 备选 |
| Loro | Rust | 新一代高性能 | 未来升级 |

方案：Yjs WASM 模块嵌入 Rust，通过 SQLite 持久化。

### 13.4 核心实现

```rust
// src-tauri/src/crdt_sync/mod.rs

use wasm_bindgen::prelude::*;

#[wasm_bindgen(module = "/mcp_servers/yjs_wasm.js")]
extern "C" {
    type YjsDoc;
    
    #[wasm_bindgen(constructor)]
    fn new() -> YjsDoc;
    
    #[wasm_bindgen(method)]
    fn get_text(this: &YjsDoc, name: &str) -> YjsText;
    
    #[wasm_bindgen(method)]
    fn get_map(this: &YjsDoc, name: &str) -> YjsMap;
    
    #[wasm_bindgen(method)]
    fn encode_state_as_update(this: &YjsDoc) -> Vec<u8>;
    
    #[wasm_bindgen(method)]
    fn apply_update(this: &YjsDoc, update: &[u8]);
}

pub struct CrdtSyncManager {
    db: tauri_plugin_sql::DbInstance,
    local_doc: YjsDoc,
    peer_id: String,
}

impl CrdtSyncManager {
    pub fn new(db: tauri_plugin_sql::DbInstance, peer_id: String) -> Self {
        Self {
            db,
            local_doc: YjsDoc::new(),
            peer_id,
        }
    }
    
    /// 编辑实验记录（本地操作，无需网络）
    pub fn edit_snapshot(&mut self, snapshot_id: &str, field: &str, value: &str) {
        let map = self.local_doc.get_map("snapshots");
        let snapshot = map.get_map(snapshot_id);
        snapshot.set(field, value);
        
        // 生成更新并保存到本地 SQLite
        let update = self.local_doc.encode_state_as_update();
        self.save_update_to_db(snapshot_id, &update);
    }
    
    /// 同步到远程（恢复网络后调用）
    pub async fn sync_to_remote(&self, team_id: &str) -> Result<(), SyncError> {
        // 1. 获取本地所有待同步的更新
        let pending_updates = self.load_pending_updates().await?;
        
        // 2. 发送到同步服务器或 P2P 直连
        self.send_updates(team_id, pending_updates).await?;
        
        // 3. 接收远程更新并合并
        let remote_updates = self.receive_updates(team_id).await?;
        for update in remote_updates {
            self.local_doc.apply_update(&update);
        }
        
        Ok(())
    }
    
    /// P2P 网格同步（同一局域网内设备直连）
    pub async fn sync_p2p(&self, peer_address: &str) -> Result<(), SyncError> {
        // 使用 WebRTC 或本地 TCP 直连
        // 适用于同一实验室内的设备
        todo!()
    }
}
```

### 13.5 数据库表

```sql
CREATE TABLE IF NOT EXISTS crdt_documents (
    id          TEXT PRIMARY KEY,
    doc_type    TEXT NOT NULL,  -- snapshot / note / workflow / setting
    content     BLOB NOT NULL, -- Yjs 二进制更新数据
    peer_id     TEXT NOT NULL,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS crdt_sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      TEXT NOT NULL REFERENCES crdt_documents(id),
    update_data BLOB NOT NULL,
    target_peer TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 13.6 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | Yjs WASM 集成到 Rust | 4h |
| 2 | CRDT 文档管理器 | 3h |
| 3 | SQLite 持久化层 | 2h |
| 4 | 同步协议（WebSocket/REST） | 3h |
| 5 | P2P 直连（局域网） | 3h |
| 6 | 数据库表 + 迁移 | 1h |
| 7 | 集成测试 | 3h |

**Phase 12 总工作量：约 19 小时**

---

## 14. Phase 13: 后端架构韧性升级

### 14.1 目标

引入 Actor 并发模型，将 CPU 密集型任务异步化，实现故障恢复机制。

### 14.2 Actor 消息总线

```rust
// src-tauri/src/actor/mod.rs

pub struct ActorSystem {
    actors: HashMap<String, mpsc::UnboundedSender<ActorMessage>>,
}

#[derive(Debug, Clone)]
pub enum ActorMessage {
    PdfParse { file_path: String, reply_to: String },
    Embedding { text: String, reply_to: String },
    ToolCall { tool_name: String, arguments: serde_json::Value, reply_to: String },
    WorkflowExecute { workflow_id: String, reply_to: String },
    SentinelCheck { topic: String, reply_to: String },
}

/// 故障恢复装饰器
pub async fn with_retry<F, Fut, T>(max_retries: u32, backoff_ms: u64, operation: F) -> Result<T, ActorError>
where F: Fn() -> Fut, Fut: std::future::Future<Output = Result<T, ActorError>>,
{
    let mut last_error = None;
    for attempt in 0..max_retries {
        match operation().await {
            Ok(result) => return Ok(result),
            Err(e) => {
                last_error = Some(e);
                if attempt < max_retries - 1 {
                    tokio::time::sleep(Duration::from_millis(backoff_ms * (attempt + 1))).await;
                }
            }
        }
    }
    Err(last_error.unwrap_or(ActorError::Unknown))
}
```

### 14.3 实施步骤

| 步骤 | 任务 | 工作量 |
|------|------|--------|
| 1 | Actor 消息总线 | 3h |
| 2 | PDF 解析 Actor | 2h |
| 3 | Embedding Actor | 2h |
| 4 | 故障恢复机制 | 3h |
| 5 | 集成测试 | 2h |

**Phase 13 总工作量：约 12 小时**

---

## 15. 数据库迁移总脚本

```sql
-- ==========================================
-- 科研助手 v2.0 完整数据库迁移脚本
-- 在应用启动时由 Rust 后端自动执行
-- ==========================================

-- Phase 1: MCP 基础设施
CREATE TABLE IF NOT EXISTS mcp_servers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    command     TEXT NOT NULL,
    args        TEXT NOT NULL DEFAULT '[]',
    env         TEXT NOT NULL DEFAULT '{}',
    transport   TEXT NOT NULL DEFAULT 'stdio',
    port        INTEGER,
    auto_start  INTEGER NOT NULL DEFAULT 1,
    timeout_ms  INTEGER NOT NULL DEFAULT 30000,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_tools (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL UNIQUE,
    description     TEXT NOT NULL,
    parameters      TEXT NOT NULL DEFAULT '{}',
    server_name     TEXT NOT NULL REFERENCES mcp_servers(name),
    enabled         INTEGER NOT NULL DEFAULT 1,
    permission_level TEXT NOT NULL DEFAULT 'ask_user',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mcp_tool_calls (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name   TEXT NOT NULL,
    arguments   TEXT NOT NULL DEFAULT '{}',
    result      TEXT,
    is_error    INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Phase 2: Agent Runtime
CREATE TABLE IF NOT EXISTS agent_memories (
    conversation_id TEXT PRIMARY KEY,
    messages        TEXT NOT NULL DEFAULT '[]',
    summary         TEXT,
    total_tokens    INTEGER NOT NULL DEFAULT 0,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    query           TEXT NOT NULL,
    final_answer    TEXT,
    steps_json      TEXT NOT NULL DEFAULT '[]',
    tools_used      TEXT NOT NULL DEFAULT '[]',
    status          TEXT NOT NULL DEFAULT 'running',
    error_message   TEXT,
    started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    duration_ms     INTEGER
);

-- Phase 3: Agentic RAG
CREATE TABLE IF NOT EXISTS rag_cache (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    query_hash  TEXT NOT NULL UNIQUE,
    query       TEXT NOT NULL,
    results     TEXT NOT NULL DEFAULT '[]',
    expires_at  DATETIME,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_rag_cache_hash ON rag_cache(query_hash);

-- Phase 5: Workflow Engine
CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    nodes       TEXT NOT NULL DEFAULT '[]',
    edges       TEXT NOT NULL DEFAULT '[]',
    trigger     TEXT NOT NULL DEFAULT '{}',
    is_template INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id              TEXT PRIMARY KEY,
    workflow_id     TEXT NOT NULL REFERENCES workflows(id),
    status          TEXT NOT NULL DEFAULT 'pending',
    context         TEXT NOT NULL DEFAULT '{}',
    node_statuses   TEXT NOT NULL DEFAULT '{}',
    started_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at    DATETIME,
    duration_ms     INTEGER,
    error_message   TEXT
);

-- Phase 8: Voice
CREATE TABLE IF NOT EXISTS voice_memos (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT,
    text        TEXT NOT NULL,
    audio_path  TEXT,
    duration_ms INTEGER,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Phase 9: Memory
CREATE TABLE IF NOT EXISTS memory_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'general',
    confidence  REAL NOT NULL DEFAULT 1.0,
    embedding   TEXT,
    source      TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    access_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_memory_category ON memory_entries(category);

-- Phase 12: CRDT
CREATE TABLE IF NOT EXISTS crdt_documents (
    id          TEXT PRIMARY KEY,
    doc_type    TEXT NOT NULL,
    content     BLOB NOT NULL,
    peer_id     TEXT NOT NULL,
    timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP,
    synced      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS crdt_sync_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id      TEXT NOT NULL REFERENCES crdt_documents(id),
    update_data BLOB NOT NULL,
    target_peer TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 默认 MCP Server 配置
INSERT OR IGNORE INTO mcp_servers (name, command, args, auto_start, timeout_ms) VALUES
    ('filesystem', 'node', '["filesystem_server.js"]', 1, 30000),
    ('docling', 'python', '["docling_server.py"]', 0, 120000);

-- 预设工作流模板
INSERT OR IGNORE INTO workflows (id, name, description, nodes, edges, trigger, is_template) VALUES
    ('tpl_deep_research', '深度文献调研', '自动分解研究问题、多源检索、综合分析',
     '[...]', '[...]', '{"type":"Manual"}', 1),
    ('tpl_daily_brief', '每日文献简报', '自动检索昨日新论文并生成简报',
     '[...]', '[...]', '{"type":"Scheduled","cron":"0 8 * * *"}', 1),
    ('tpl_paper_reading', '论文精读笔记', '自动解析论文结构并生成阅读笔记',
     '[...]', '[...]', '{"type":"Event","event_name":"pdf_open"}', 1),
    ('tpl_experiment_record', '实验记录自动化', '截图+识别+结构化记录',
     '[...]', '[...]', '{"type":"Manual"}', 1);
```

---

## 16. 分阶段实施甘特图

### 16.1 实施优先级排序

根据依赖关系和投入产出比，重新排序实施优先级：

| 优先级 | Phase | 功能 | 工作量 | 用户感知度 | 前置依赖 |
|--------|-------|------|--------|-----------|---------|
| **P0** | Phase 4 | **AG-UI 流式反馈** | 16h | ⭐⭐⭐⭐⭐ 极高 | Phase 1, 2 |
| **P0** | Phase 5 | **本地嵌入模型** | 14h | ⭐⭐⭐⭐ 高 | 无 |
| **P0** | Phase 1 | **MCP 基础设施** | 19h | ⭐⭐⭐⭐ 高 | 无 |
| **P0** | Phase 2 | **Agent Runtime** | 25h | ⭐⭐⭐⭐⭐ 极高 | Phase 1 |
| **P1** | Phase 3 | **Agentic RAG** | 24h | ⭐⭐⭐⭐ 高 | Phase 2, 5 |
| **P1** | Phase 8 | **Voice 语音** | 14h | ⭐⭐⭐⭐⭐ 极高 | Phase 5 |
| **P1** | Phase 7 | **PDF 解析重构** | 15h | ⭐⭐⭐ 中 | Phase 1, 5 |
| **P2** | Phase 6 | **Workflow 引擎** | 24h | ⭐⭐⭐ 中 | Phase 1, 2, 4 |
| **P2** | Phase 9 | **Memory 记忆** | 14h | ⭐⭐⭐⭐ 高 | Phase 2, 5 |
| **P2** | Phase 10 | **Computer Use** | 19h | ⭐⭐⭐⭐⭐ 极高 | Phase 1, 2 |
| **P3** | Phase 11 | **A2UI 生成界面** | 14h | ⭐⭐⭐⭐ 高 | Phase 2, 4 |
| **P3** | Phase 12 | **CRDT 协作** | 19h | ⭐⭐ 低 | Phase 1 |
| **P3** | Phase 13 | **Actor 架构** | 12h | ⭐ 低（内部） | Phase 1 |

### 16.2 推荐实施路径

```
第 1-2 周：Phase 5（本地嵌入）+ Phase 1（MCP）
          ↓ 并行，无依赖
第 2-3 周：Phase 2（Agent Runtime）
          ↓ 依赖 Phase 1
第 3-4 周：Phase 4（AG-UI 流式反馈）— 核心差异化功能
          ↓ 依赖 Phase 1, 2
第 4-5 周：Phase 3（Agentic RAG）+ Phase 8（Voice）
          ↓ 并行
第 5-6 周：Phase 7（PDF 解析）+ Phase 9（Memory）
          ↓ 并行
第 6-7 周：Phase 6（Workflow）+ Phase 10（Computer Use）
          ↓ 并行
第 7-8 周：Phase 11（A2UI）+ Phase 12（CRDT）+ Phase 13（Actor）
          ↓ 并行
```

**总计：约 229 小时（约 8 周，按每周 28 小时有效时间计算）**

### 16.3 关键路径

```
Phase 5（嵌入模型） → Phase 1（MCP） → Phase 2（Agent） → Phase 4（AG-UI）
                                                      ↓
                                              Phase 3（RAG）
                                                      ↓
                                              Phase 10（Computer Use）
```

**AG-UI 流式反馈是最核心的差异化功能**，应在 Phase 2 完成后立即实施，给用户带来"哇"的体验。

---

## 附录 A：关键接口汇总

### 新增 Tauri Command 清单

| Command | 所在模块 | 功能 | 前端调用方 |
|---------|---------|------|----------|
| `mcp_list_tools` | mcp | 获取可用工具列表 | AI 客户端 |
| `mcp_call_tool` | mcp | 调用 MCP 工具 | Agent Runtime |
| `mcp_toggle_tool` | mcp | 启用/停用工具 | 设置面板 |
| `agent_run` | agent | 启动 Agent 运行 | 聊天窗口 |
| `agent_get_state` | agent | 获取 Agent 状态 | 聊天窗口 |
| `agent_cancel` | agent | 取消运行中任务 | 聊天窗口 |
| `agent_user_response` | agent | 用户响应 Agent 提问 | 聊天窗口 |
| `rag_search` | rag | Agentic RAG 检索 | 知识面板 |
| `inference_check_status` | local_inference | 检查本地模型状态 | 设置面板 |
| `inference_download_model` | local_inference | 下载模型 | 设置面板 |
| `workflow_create` | workflow | 创建工作流 | 工作流编辑器 |
| `workflow_execute` | workflow | 执行工作流 | 工作流编辑器 |
| `workflow_list_templates` | workflow | 列出模板 | 工作流编辑器 |
| `voice_start_recording` | voice | 开始录音 | 全局快捷键 |
| `voice_stop_and_transcribe` | voice | 停止并转文字 | 全局快捷键 |
| `memory_load_relevant` | memory | 加载相关记忆 | Agent Runtime |
| `computer_use_analyze` | computer_use | 分析屏幕 | Computer Use 面板 |
| `computer_use_execute` | computer_use | 执行操作序列 | Computer Use 面板 |
| `crdt_sync` | crdt_sync | 同步文档 | 团队协作 |

### 新增 Tauri Event 清单（前端订阅）

| Event | 发射方 | 说明 |
|-------|--------|------|
| `ag-ui:task-started` | Agent Runtime | 任务开始 |
| `ag-ui:thinking` | Agent Runtime | 正在思考 |
| `ag-ui:thought-complete` | Agent Runtime | 思考步骤完成 |
| `ag-ui:self-correction` | Agent Runtime | 自我修正 |
| `ag-ui:tool-calling` | Agent Runtime | 正在调用工具 |
| `ag-ui:tool-progress` | MCP Hub | 工具执行进度 |
| `ag-ui:tool-result` | MCP Hub | 工具返回结果 |
| `ag-ui:tool-error` | MCP Hub | 工具调用失败 |
| `ag-ui:searching` | RAG Engine | 正在检索 |
| `ag-ui:search-result` | RAG Engine | 检索结果 |
| `ag-ui:requires-input` | Agent Runtime | 需要用户输入 |
| `ag-ui:task-complete` | Agent Runtime | 任务完成 |
| `ag-ui:task-error` | Agent Runtime | 任务出错 |
| `ag-ui:heartbeat` | Agent Runtime | 心跳（每 2s） |
| `ag-ui:workflow-node-running` | Workflow Engine | 工作流节点执行中 |
| `a2ui:component` | A2UI Generator | 生成 UI 组件 |
| `voice:transcription-complete` | Voice Layer | 语音转文字完成 |
| `agent:complete` | Agent Runtime | Agent 运行完成 |
| `agent:error` | Agent Runtime | Agent 运行出错 |

### 新增 Rust 模块清单

| 模块 | 文件路径 | 核心功能 | 依赖 Phase |
|------|---------|---------|-----------|
| `mcp` | `src/mcp/` | MCP 协议实现 | — |
| `agent` | `src/agent/` | Agent Runtime | 1 |
| `rag` | `src/rag/` | Agentic RAG 引擎 | 2, 5 |
| `ag_ui` | `src/ag_ui/` | 流式状态反馈 | 1, 2 |
| `local_inference` | `src/local_inference/` | ONNX 本地推理 | — |
| `workflow` | `src/workflow/` | 工作流引擎 | 1, 2, 4 |
| `pdf_parser` | `src/pdf_parser/` | PDF 多模态解析 | 1 |
| `voice` | `src/voice/` | Whisper 语音识别 | 5 |
| `memory` | `src/memory/` | 跨会话记忆 | 2, 5 |
| `computer_use` | `src/computer_use/` | 桌面自动化 | 1, 2 |
| `a2ui` | `src/a2ui/` | 生成式界面 | 2, 4 |
| `crdt_sync` | `src/crdt_sync/` | 离线协作同步 | — |
| `actor` | `src/actor/` | Actor 并发层 | — |
