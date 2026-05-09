use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::transport::{StdioTransport, TransportError};

/// MCP protocol version
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Information about an available tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolInfo {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// Result of a tool invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolResult {
    pub content: Vec<ToolContent>,
    #[serde(default)]
    pub is_error: bool,
}

/// A single content item within a tool result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ToolContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "image")]
    Image { data: String, mime_type: String },
    #[serde(rename = "resource")]
    Resource { resource: Value },
}

/// MCP Client errors
#[derive(Debug, thiserror::Error)]
pub enum McpClientError {
    #[error("Transport error: {0}")]
    Transport(#[from] TransportError),
    #[error("Protocol error: {0}")]
    Protocol(String),
    #[error("Server not initialized")]
    NotInitialized,
    #[error("Tool not found: {0}")]
    ToolNotFound(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// MCP Client implementation using stdio transport.
pub struct McpClient {
    transport: StdioTransport,
    initialized: bool,
}

impl std::fmt::Debug for McpClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpClient")
            .field("initialized", &self.initialized)
            .finish_non_exhaustive()
    }
}

impl McpClient {
    /// Create a new MCP client with the given transport.
    pub fn new(transport: StdioTransport) -> Self {
        Self {
            transport,
            initialized: false,
        }
    }

    /// Initialize the MCP session with the server.
    pub async fn initialize(&mut self) -> Result<(), McpClientError> {
        let params = serde_json::json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": {}
            },
            "clientInfo": {
                "name": "ai-research-assistant",
                "version": env!("CARGO_PKG_VERSION")
            }
        });

        let result = self.transport.request("initialize", Some(params)).await?;

        // Send initialized notification
        let _ = self
            .transport
            .request(
                "notifications/initialized",
                Some(serde_json::json!({})),
            )
            .await;

        // Check server capabilities
        if let Some(server_info) = result.get("serverInfo") {
            debug!("MCP server info: {:?}", server_info);
        }

        self.initialized = true;
        Ok(())
    }

    /// List all available tools from the server.
    pub async fn list_tools(&self) -> Result<Vec<ToolInfo>, McpClientError> {
        if !self.initialized {
            return Err(McpClientError::NotInitialized);
        }

        let result = self
            .transport
            .request("tools/list", Some(serde_json::json!({})))
            .await?;

        let tools = result
            .get("tools")
            .and_then(|t| t.as_array())
            .ok_or_else(|| McpClientError::Protocol("Missing 'tools' array in response".to_string()))?;

        let mut tool_infos = Vec::new();
        for tool in tools {
            let name = tool
                .get("name")
                .and_then(|n| n.as_str())
                .unwrap_or_default()
                .to_string();
            let description = tool
                .get("description")
                .and_then(|d| d.as_str())
                .unwrap_or_default()
                .to_string();
            let parameters = tool
                .get("inputSchema")
                .or_else(|| tool.get("parameters"))
                .cloned()
                .unwrap_or(Value::Object(serde_json::Map::new()));

            tool_infos.push(ToolInfo {
                name,
                description,
                parameters,
            });
        }

        Ok(tool_infos)
    }

    /// Call a tool with the given arguments.
    pub async fn call_tool(
        &self,
        name: &str,
        arguments: Value,
    ) -> Result<ToolResult, McpClientError> {
        if !self.initialized {
            return Err(McpClientError::NotInitialized);
        }

        let params = serde_json::json!({
            "name": name,
            "arguments": arguments,
        });

        let result = self.transport.request("tools/call", Some(params)).await?;

        let content = result
            .get("content")
            .and_then(|c| c.as_array())
            .ok_or_else(|| {
                McpClientError::Protocol("Missing 'content' array in tool result".to_string())
            })?;

        let mut tool_contents = Vec::new();
        for item in content {
            if let Ok(tc) = serde_json::from_value::<ToolContent>(item.clone()) {
                tool_contents.push(tc);
            }
        }

        let is_error = result
            .get("isError")
            .and_then(|e| e.as_bool())
            .unwrap_or(false);

        Ok(ToolResult {
            content: tool_contents,
            is_error,
        })
    }
}

use tracing::debug;
