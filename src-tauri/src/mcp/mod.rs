pub mod client;
pub mod hub;
pub mod registry;
pub mod transport;

pub use client::{ToolContent, ToolInfo, ToolResult};
pub use hub::{McpError, McpHub, McpServerConfig, McpServerInfo, ServerStatus, TransportType};
pub use registry::{PermissionLevel, ToolRegistration};

use serde_json::Value;
use tauri::State;

/// List all available MCP tools.
#[tauri::command]
pub async fn mcp_list_tools(
    hub: State<'_, McpHub>,
) -> Result<Vec<ToolRegistration>, String> {
    Ok(hub.list_available_tools().await)
}

/// Call an MCP tool by name with arguments.
#[tauri::command]
pub async fn mcp_call_tool(
    hub: State<'_, McpHub>,
    tool_name: String,
    arguments: Value,
) -> Result<ToolResult, String> {
    hub.call_tool(&tool_name, arguments)
        .await
        .map_err(|e| e.to_string())
}

/// Enable or disable a tool.
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

/// Set permission level for a tool.
#[tauri::command]
pub async fn mcp_set_tool_permission(
    hub: State<'_, McpHub>,
    tool_name: String,
    permission: String,
) -> Result<(), String> {
    let level = permission
        .parse::<PermissionLevel>()
        .map_err(|e| e.to_string())?;
    hub.set_tool_permission(&tool_name, level)
        .await
        .map_err(|e| e.to_string())
}

/// List all MCP servers and their statuses.
#[tauri::command]
pub async fn mcp_list_servers(hub: State<'_, McpHub>) -> Result<Vec<McpServerInfo>, String> {
    Ok(hub.list_servers().await)
}

/// Start an MCP server by config.
#[tauri::command]
pub async fn mcp_start_server(
    hub: State<'_, McpHub>,
    config: McpServerConfig,
) -> Result<(), String> {
    hub.start_server(config).await.map_err(|e| e.to_string())
}

/// Stop an MCP server by name.
#[tauri::command]
pub async fn mcp_stop_server(
    hub: State<'_, McpHub>,
    server_name: String,
) -> Result<(), String> {
    hub.stop_server(&server_name).await.map_err(|e| e.to_string())
}

/// Restart an MCP server by name (loads config from database).
#[tauri::command]
pub async fn mcp_restart_server(
    hub: State<'_, McpHub>,
    server_name: String,
) -> Result<(), String> {
    hub.restart_server(&server_name).await.map_err(|e| e.to_string())
}

/// Get the directory where MCP servers are stored.
#[tauri::command]
pub async fn mcp_get_servers_dir(hub: State<'_, McpHub>) -> Result<String, String> {
    Ok(hub.servers_dir().to_string_lossy().to_string())
}
