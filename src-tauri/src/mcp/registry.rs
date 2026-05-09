use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::client::ToolInfo;

/// Permission level for tool execution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum PermissionLevel {
    #[serde(rename = "always_allow")]
    AlwaysAllow,
    #[serde(rename = "ask_user")]
    AskUser,
    #[serde(rename = "deny")]
    Deny,
}

impl Default for PermissionLevel {
    fn default() -> Self {
        PermissionLevel::AskUser
    }
}

impl std::fmt::Display for PermissionLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PermissionLevel::AlwaysAllow => write!(f, "always_allow"),
            PermissionLevel::AskUser => write!(f, "ask_user"),
            PermissionLevel::Deny => write!(f, "deny"),
        }
    }
}

impl std::str::FromStr for PermissionLevel {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "always_allow" => Ok(PermissionLevel::AlwaysAllow),
            "ask_user" => Ok(PermissionLevel::AskUser),
            "deny" => Ok(PermissionLevel::Deny),
            _ => Err(format!("Unknown permission level: {}", s)),
        }
    }
}

/// Registration record for a single tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolRegistration {
    pub info: ToolInfo,
    pub server_name: String,
    pub enabled: bool,
    pub permission_level: PermissionLevel,
}

/// Tool registry: manages all registered tools across all MCP servers.
#[derive(Debug)]
pub struct ToolRegistry {
    tools: Arc<RwLock<HashMap<String, ToolRegistration>>>,
}

impl ToolRegistry {
    /// Create a new empty tool registry.
    pub fn new() -> Self {
        Self {
            tools: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Register a tool (or update if already exists).
    pub async fn register(&self,
        tool: ToolInfo,
        server_name: String,
        permission_level: PermissionLevel,
    ) {
        let name = tool.name.clone();
        let server_name_for_log = server_name.clone();
        let mut tools = self.tools.write().await;
        tools.insert(
            name.clone(),
            ToolRegistration {
                info: tool,
                server_name,
                enabled: true,
                permission_level,
            },
        );
        tracing::debug!("Registered tool '{}' from server '{}'", name, server_name_for_log);
    }

    /// Register multiple tools from a server.
    pub async fn register_batch(
        &self,
        tools: Vec<ToolInfo>,
        server_name: String,
        default_permission: PermissionLevel,
    ) {
        for tool in tools {
            self.register(tool, server_name.clone(), default_permission.clone()).await;
        }
    }

    /// Unregister all tools from a given server.
    pub async fn unregister_by_server(&self,
        server_name: &str,
    ) {
        let mut tools = self.tools.write().await;
        let to_remove: Vec<String> = tools
            .iter()
            .filter(|(_, reg)| reg.server_name == server_name)
            .map(|(name, _)| name.clone())
            .collect();
        for name in to_remove {
            tools.remove(&name);
            tracing::debug!("Unregistered tool '{}' (server '{}' stopped)", name, server_name);
        }
    }

    /// Get a single tool registration.
    pub async fn get(&self, name: &str) -> Option<ToolRegistration> {
        let tools = self.tools.read().await;
        tools.get(name).cloned()
    }

    /// List all registered tools.
    pub async fn list_all(&self) -> Vec<ToolRegistration> {
        let tools = self.tools.read().await;
        tools.values().cloned().collect()
    }

    /// List only enabled tools.
    pub async fn list_enabled(&self) -> Vec<ToolRegistration> {
        let tools = self.tools.read().await;
        tools.values().filter(|r| r.enabled).cloned().collect()
    }

    /// Enable a tool.
    pub async fn enable(&self, name: &str) -> Result<(), RegistryError> {
        let mut tools = self.tools.write().await;
        if let Some(reg) = tools.get_mut(name) {
            reg.enabled = true;
            Ok(())
        } else {
            Err(RegistryError::ToolNotFound(name.to_string()))
        }
    }

    /// Disable a tool.
    pub async fn disable(&self, name: &str) -> Result<(), RegistryError> {
        let mut tools = self.tools.write().await;
        if let Some(reg) = tools.get_mut(name) {
            reg.enabled = false;
            Ok(())
        } else {
            Err(RegistryError::ToolNotFound(name.to_string()))
        }
    }

    /// Set permission level for a tool.
    pub async fn set_permission(
        &self,
        name: &str,
        level: PermissionLevel,
    ) -> Result<(), RegistryError> {
        let mut tools = self.tools.write().await;
        if let Some(reg) = tools.get_mut(name) {
            reg.permission_level = level;
            Ok(())
        } else {
            Err(RegistryError::ToolNotFound(name.to_string()))
        }
    }

    /// Check if a tool can be executed (exists, enabled, not denied).
    pub async fn can_execute(&self,
        name: &str,
    ) -> Result<bool, RegistryError> {
        let tools = self.tools.read().await;
        if let Some(reg) = tools.get(name) {
            if !reg.enabled {
                return Ok(false);
            }
            if reg.permission_level == PermissionLevel::Deny {
                return Ok(false);
            }
            Ok(true)
        } else {
            Err(RegistryError::ToolNotFound(name.to_string()))
        }
    }

    /// Check if user confirmation is required for a tool.
    pub async fn requires_confirmation(&self,
        name: &str,
    ) -> Result<bool, RegistryError> {
        let tools = self.tools.read().await;
        if let Some(reg) = tools.get(name) {
            Ok(reg.permission_level == PermissionLevel::AskUser)
        } else {
            Err(RegistryError::ToolNotFound(name.to_string()))
        }
    }
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

/// Registry error types.
#[derive(Debug, thiserror::Error)]
pub enum RegistryError {
    #[error("Tool not found: {0}")]
    ToolNotFound(String),
    #[error("Tool already registered: {0}")]
    AlreadyRegistered(String),
}
