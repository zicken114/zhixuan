use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn};

use super::client::{McpClient, McpClientError, ToolInfo, ToolResult};
use super::registry::{PermissionLevel, RegistryError, ToolRegistration, ToolRegistry};
use super::transport::{StdioTransport, TransportError};

/// Configuration for an MCP server.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpServerConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    #[serde(default)]
    pub transport: TransportType,
    #[serde(default = "default_auto_start")]
    pub auto_start: bool,
    #[serde(default = "default_timeout_ms")]
    pub timeout_ms: u64,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
}

fn default_auto_start() -> bool {
    true
}
fn default_timeout_ms() -> u64 {
    30000
}
fn default_enabled() -> bool {
    true
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            name: String::new(),
            command: String::new(),
            args: Vec::new(),
            env: HashMap::new(),
            transport: TransportType::Stdio,
            auto_start: true,
            timeout_ms: 30000,
            enabled: true,
        }
    }
}

/// Transport type for MCP server communication.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TransportType {
    Stdio,
    WebSocket { port: u16 },
}

impl Default for TransportType {
    fn default() -> Self {
        TransportType::Stdio
    }
}

/// Status of an MCP server instance.
#[derive(Debug, Clone, Serialize)]
pub enum ServerStatus {
    Starting,
    Running,
    Error(String),
    Stopped,
}

/// Serializable server info for the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct McpServerInfo {
    pub name: String,
    pub status: String,
    pub error_message: Option<String>,
}

/// An active MCP server instance.
#[derive(Debug, Clone)]
pub struct McpServerInstance {
    pub config: McpServerConfig,
    pub status: ServerStatus,
    pub tools: Vec<ToolInfo>,
    client: Option<Arc<RwLock<McpClient>>>,
}

/// MCP Hub: manages all MCP server lifecycles and tool routing.
#[derive(Clone)]
pub struct McpHub {
    servers: Arc<RwLock<HashMap<String, McpServerInstance>>>,
    registry: Arc<ToolRegistry>,
    servers_dir: PathBuf,
    db_path: PathBuf,
}

/// MCP Hub errors.
#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("Tool not found: {0}")]
    ToolNotFound(String),
    #[error("Tool disabled: {0}")]
    ToolDisabled(String),
    #[error("Server not running: {0}")]
    ServerNotRunning(String),
    #[error("Server already running: {0}")]
    ServerAlreadyRunning(String),
    #[error("Server config not found: {0}")]
    ConfigNotFound(String),
    #[error("Call timeout")]
    Timeout,
    #[error("Transport error: {0}")]
    Transport(String),
    #[error("Client error: {0}")]
    Client(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Registry error: {0}")]
    Registry(#[from] RegistryError),
    #[error("Permission denied: tool '{0}' requires user confirmation")]
    PermissionDenied(String),
    #[error("Database error: {0}")]
    Database(String),
}

impl From<TransportError> for McpError {
    fn from(e: TransportError) -> Self {
        McpError::Transport(e.to_string())
    }
}

impl From<McpClientError> for McpError {
    fn from(e: McpClientError) -> Self {
        McpError::Client(e.to_string())
    }
}

impl From<rusqlite::Error> for McpError {
    fn from(e: rusqlite::Error) -> Self {
        McpError::Database(e.to_string())
    }
}

impl McpHub {
    /// Create a new MCP Hub and run database migrations.
    pub fn new(app_data_dir: &std::path::Path) -> Self {
        let servers_dir = app_data_dir.join("mcp_servers");
        let db_path = app_data_dir.join("ai_research_assistant.db");

        std::fs::create_dir_all(&servers_dir).ok();

        let hub = Self {
            servers: Arc::new(RwLock::new(HashMap::new())),
            registry: Arc::new(ToolRegistry::new()),
            servers_dir: servers_dir.clone(),
            db_path: db_path.clone(),
        };

        // Run database migrations synchronously on creation
        if let Err(e) = hub.run_migrations() {
            eprintln!("[McpHub] Database migration failed: {}", e);
        }

        // Insert default server configs if table is empty
        if let Err(e) = hub.ensure_default_configs(&servers_dir) {
            eprintln!("[McpHub] Failed to ensure default configs: {}", e);
        }

        hub
    }

    /// Run database migrations for MCP tables.
    fn run_migrations(&self) -> Result<(), rusqlite::Error> {
        let conn = rusqlite::Connection::open(&self.db_path)?;

        // Phase 1: MCP infrastructure tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS mcp_servers (
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
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS mcp_tools (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                name            TEXT NOT NULL UNIQUE,
                description     TEXT NOT NULL,
                parameters      TEXT NOT NULL DEFAULT '{}',
                server_name     TEXT NOT NULL REFERENCES mcp_servers(name),
                enabled         INTEGER NOT NULL DEFAULT 1,
                permission_level TEXT NOT NULL DEFAULT 'ask_user',
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS mcp_tool_calls (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                tool_name   TEXT NOT NULL,
                arguments   TEXT NOT NULL DEFAULT '{}',
                result      TEXT,
                is_error    INTEGER NOT NULL DEFAULT 0,
                duration_ms INTEGER,
                timestamp   DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;

        // Create indexes
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_mcp_tools_server ON mcp_tools(server_name)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_name ON mcp_tool_calls(tool_name)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_time ON mcp_tool_calls(timestamp)",
            [],
        )?;

        Ok(())
    }

    /// Insert default MCP server configurations. Uses INSERT OR IGNORE so
    /// existing configs are preserved while missing ones are added.
    fn ensure_default_configs(&self,
        servers_dir: &PathBuf,
    ) -> Result<(), rusqlite::Error> {
        let conn = rusqlite::Connection::open(&self.db_path)?;

        let defaults = vec![
            ("filesystem", "filesystem_server.js"),
            ("web_search", "web_search.js"),
            ("arxiv_search", "arxiv_search.js"),
            ("calculator", "calculator.js"),
            ("semantic_scholar", "semantic_scholar_server.js"),
            ("bibtex", "bibtex_server.js"),
            ("code_runner", "code_runner_server.js"),
            ("zotero", "zotero_server.js"),
            ("translator", "translator_server.js"),
        ];

        for (name, filename) in defaults {
            let script_path = servers_dir.join(filename);
            conn.execute(
                "INSERT OR IGNORE INTO mcp_servers
                 (name, command, args, env, transport, auto_start, timeout_ms, enabled)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                rusqlite::params![
                    name,
                    "node",
                    serde_json::to_string(&[script_path.to_string_lossy().to_string()]).unwrap_or_default(),
                    "{}",
                    "stdio",
                    1,
                    30000,
                    1
                ],
            )?;
            info!("Ensured default MCP server configuration for '{}'", name);
        }

        Ok(())
    }

    /// Load server configurations from the SQLite database.
    pub async fn load_server_configs(&self) -> Result<Vec<McpServerConfig>, McpError> {
        let db_path = self.db_path.clone();

        let configs = tokio::task::spawn_blocking(move || -> Result<Vec<McpServerConfig>, McpError> {
            let conn = rusqlite::Connection::open(&db_path)?;
            let mut stmt = conn.prepare(
                "SELECT name, command, args, env, transport, port,
                        auto_start, timeout_ms, enabled
                 FROM mcp_servers
                 WHERE enabled = 1
                 ORDER BY created_at"
            )?;

            let rows = stmt.query_map([], |row| {
                let name: String = row.get(0)?;
                let command: String = row.get(1)?;
                let args_json: String = row.get(2)?;
                let env_json: String = row.get(3)?;
                let transport_str: String = row.get(4)?;
                let port: Option<i64> = row.get(5)?;
                let auto_start: i64 = row.get(6)?;
                let timeout_ms: i64 = row.get(7)?;
                let enabled: i64 = row.get(8)?;

                let args: Vec<String> = serde_json::from_str(&args_json).unwrap_or_default();
                let env: HashMap<String, String> = serde_json::from_str(&env_json).unwrap_or_default();

                let transport = if transport_str == "websocket" {
                    TransportType::WebSocket { port: port.unwrap_or(8080) as u16 }
                } else {
                    TransportType::Stdio
                };

                Ok(McpServerConfig {
                    name,
                    command,
                    args,
                    env,
                    transport,
                    auto_start: auto_start != 0,
                    timeout_ms: timeout_ms as u64,
                    enabled: enabled != 0,
                })
            })?;

            let mut configs = Vec::new();
            for row in rows {
                configs.push(row?);
            }

            Ok(configs)
        })
        .await
        .map_err(|e| McpError::Database(format!("Task join error: {}", e)))??;

        Ok(configs)
    }

    /// Save server configurations to the SQLite database.
    pub async fn save_server_configs(
        &self,
        configs: &[McpServerConfig],
    ) -> Result<(), McpError> {
        let db_path = self.db_path.clone();
        let configs = configs.to_vec();

        tokio::task::spawn_blocking(move || -> Result<(), McpError> {
            let mut conn = rusqlite::Connection::open(&db_path)?;
            let tx = conn.transaction()?;

            for config in &configs {
                let transport_str = match config.transport {
                    TransportType::Stdio => "stdio",
                    TransportType::WebSocket { .. } => "websocket",
                };
                let port = match config.transport {
                    TransportType::Stdio => None,
                    TransportType::WebSocket { port } => Some(port as i64),
                };

                tx.execute(
                    "INSERT INTO mcp_servers
                     (name, command, args, env, transport, port, auto_start, timeout_ms, enabled)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                     ON CONFLICT(name) DO UPDATE SET
                         command = excluded.command,
                         args = excluded.args,
                         env = excluded.env,
                         transport = excluded.transport,
                         port = excluded.port,
                         auto_start = excluded.auto_start,
                         timeout_ms = excluded.timeout_ms,
                         enabled = excluded.enabled",
                    rusqlite::params![
                        config.name,
                        config.command,
                        serde_json::to_string(&config.args).unwrap_or_default(),
                        serde_json::to_string(&config.env).unwrap_or_default(),
                        transport_str,
                        port,
                        if config.auto_start { 1 } else { 0 },
                        config.timeout_ms as i64,
                        if config.enabled { 1 } else { 0 },
                    ],
                )?;
            }

            tx.commit()?;
            Ok(())
        })
        .await
        .map_err(|e| McpError::Database(format!("Task join error: {}", e)))??;

        Ok(())
    }

    /// Record a tool call in the database.
    pub async fn record_tool_call(
        &self,
        tool_name: &str,
        arguments: &Value,
        result: Option<&str>,
        is_error: bool,
        duration_ms: u64,
    ) -> Result<(), McpError> {
        let db_path = self.db_path.clone();
        let tool_name = tool_name.to_string();
        let arguments_str = arguments.to_string();
        let result_str = result.map(|s| s.to_string());

        tokio::task::spawn_blocking(move || -> Result<(), McpError> {
            let conn = rusqlite::Connection::open(&db_path)?;
            conn.execute(
                "INSERT INTO mcp_tool_calls
                 (tool_name, arguments, result, is_error, duration_ms)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    tool_name,
                    arguments_str,
                    result_str,
                    if is_error { 1 } else { 0 },
                    duration_ms as i64,
                ],
            )?;
            Ok(())
        })
        .await
        .map_err(|e| McpError::Database(format!("Task join error: {}", e)))??;

        Ok(())
    }

    /// Start all servers configured with auto_start.
    pub async fn start_all(&self) -> Result<(), McpError> {
        let configs = self.load_server_configs().await?;
        for config in configs {
            let server_name = config.name.clone();
            if config.auto_start && config.enabled {
                if let Err(e) = self.start_server(config.clone()).await {
                    warn!("Failed to start MCP server '{}': {}", server_name, e);
                    // Record failed server with Error status so UI can see it
                    let mut servers = self.servers.write().await;
                    let instance = McpServerInstance {
                        config,
                        status: ServerStatus::Error(e.to_string()),
                        tools: Vec::new(),
                        client: None,
                    };
                    servers.insert(server_name, instance);
                }
            } else {
                // Record non-auto-start or disabled servers as Stopped
                let mut servers = self.servers.write().await;
                if !servers.contains_key(&server_name) {
                    let instance = McpServerInstance {
                        config,
                        status: ServerStatus::Stopped,
                        tools: Vec::new(),
                        client: None,
                    };
                    servers.insert(server_name, instance);
                }
            }
        }
        Ok(())
    }

    /// Start a single MCP server.
    pub async fn start_server(
        &self, config: McpServerConfig) -> Result<(), McpError> {
        let mut servers = self.servers.write().await;

        if servers.contains_key(&config.name) {
            return Err(McpError::ServerAlreadyRunning(config.name.clone()));
        }

        info!("Starting MCP server '{}' (command: {})", config.name, config.command);

        let transport = match &config.transport {
            TransportType::Stdio => {
                StdioTransport::new(&config.command, &config.args, &config.env).await?
            }
            TransportType::WebSocket { port: _ } => {
                return Err(McpError::Transport(
                    "WebSocket transport not yet implemented".to_string(),
                ));
            }
        };

        let mut client = McpClient::new(transport);
        client.initialize().await?;

        let tools = client.list_tools().await?;
        let tools_count = tools.len();

        let client_arc = Arc::new(RwLock::new(client));

        let instance = McpServerInstance {
            config: config.clone(),
            status: ServerStatus::Running,
            tools: tools.clone(),
            client: Some(client_arc.clone()),
        };

        servers.insert(config.name.clone(), instance);
        drop(servers);

        // Register tools in the registry
        self.registry
            .register_batch(tools, config.name.clone(), PermissionLevel::AskUser)
            .await;

        info!(
            "MCP server '{}' started with {} tools",
            config.name, tools_count
        );

        Ok(())
    }

    /// Stop a running MCP server.
    pub async fn stop_server(&self, name: &str) -> Result<(), McpError> {
        let mut servers = self.servers.write().await;

        if servers.remove(name).is_none() {
            return Err(McpError::ServerNotRunning(name.to_string()));
        }

        drop(servers);

        // Unregister all tools from this server
        self.registry.unregister_by_server(name).await;

        info!("MCP server '{}' stopped", name);
        Ok(())
    }

    /// Get status of all servers (loads from DB, merges with in-memory status).
    pub async fn list_servers(&self) -> Vec<McpServerInfo> {
        let configs = match self.load_server_configs().await {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };

        let servers = self.servers.read().await;
        let mut result = Vec::new();
        for config in configs {
            let (status_str, error_message) = if let Some(inst) = servers.get(&config.name) {
                match &inst.status {
                    ServerStatus::Starting => ("Starting".to_string(), None),
                    ServerStatus::Running => ("Running".to_string(), None),
                    ServerStatus::Error(msg) => ("Error".to_string(), Some(msg.clone())),
                    ServerStatus::Stopped => ("Stopped".to_string(), None),
                }
            } else {
                ("Stopped".to_string(), None)
            };
            result.push(McpServerInfo {
                name: config.name,
                status: status_str,
                error_message,
            });
        }
        result
    }

    /// Restart a server by loading its config from the database.
    pub async fn restart_server(&self, name: &str) -> Result<(), McpError> {
        let configs = self.load_server_configs().await?;
        let config = configs
            .into_iter()
            .find(|c| c.name == name)
            .ok_or_else(|| McpError::ConfigNotFound(name.to_string()))?;
        self.start_server(config).await
    }

    /// Call a tool by name.
    pub async fn call_tool(
        &self,
        tool_name: &str,
        arguments: Value,
    ) -> Result<ToolResult, McpError> {
        let start = std::time::Instant::now();

        // Check registry first
        let registration = self
            .registry
            .get(tool_name)
            .await
            .ok_or_else(|| McpError::ToolNotFound(tool_name.to_string()))?;

        if !registration.enabled {
            return Err(McpError::ToolDisabled(tool_name.to_string()));
        }

        if registration.permission_level == PermissionLevel::Deny {
            return Err(McpError::PermissionDenied(tool_name.to_string()));
        }

        let server_name = registration.server_name.clone();

        // Get client and timeout from server instance, then release lock
        let (client_arc, timeout_ms) = {
            let servers = self.servers.read().await;
            let instance = servers
                .get(&server_name)
                .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?;
            let client = instance
                .client
                .as_ref()
                .ok_or_else(|| McpError::ServerNotRunning(server_name.clone()))?
                .clone();
            let timeout = instance.config.timeout_ms;
            (client, timeout)
        };

        let timeout = std::time::Duration::from_millis(timeout_ms);

        // Call the tool with timeout
        let result = tokio::time::timeout(timeout, async {
            let client = client_arc.read().await;
            client.call_tool(tool_name, arguments.clone()).await
        })
        .await
        .map_err(|_| McpError::Timeout)?;

        let duration_ms = start.elapsed().as_millis() as u64;

        // Record the tool call
        let is_error = result.is_err();
        let result_str = result.as_ref().ok().map(|r| serde_json::to_string(r).unwrap_or_default());
        let _ = self.record_tool_call(
            tool_name,
            &arguments,
            result_str.as_deref(),
            is_error,
            duration_ms,
        ).await;

        result.map_err(Into::into)
    }

    /// List all available (enabled) tools.
    pub async fn list_available_tools(&self) -> Vec<ToolRegistration> {
        self.registry.list_enabled().await
    }

    /// Enable a tool.
    pub async fn enable_tool(&self, tool_name: &str) -> Result<(), McpError> {
        self.registry.enable(tool_name).await?;
        Ok(())
    }

    /// Disable a tool.
    pub async fn disable_tool(&self, tool_name: &str) -> Result<(), McpError> {
        self.registry.disable(tool_name).await?;
        Ok(())
    }

    /// Set tool permission level.
    pub async fn set_tool_permission(
        &self,
        tool_name: &str,
        level: PermissionLevel,
    ) -> Result<(), McpError> {
        self.registry.set_permission(tool_name, level).await?;
        Ok(())
    }

    /// Check if a tool requires user confirmation.
    pub async fn tool_requires_confirmation(
        &self, tool_name: &str) -> Result<bool, McpError> {
        Ok(self.registry.requires_confirmation(tool_name).await?)
    }

    /// Get the tool registry (for advanced use).
    pub fn registry(&self) -> &Arc<ToolRegistry> {
        &self.registry
    }

    /// Get the servers directory path.
    pub fn servers_dir(&self) -> &PathBuf {
        &self.servers_dir
    }
}
