use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{debug, info, warn};

use super::cloud_llm::{
    CloudLlmClient, CloudLlmConfig, CloudLlmError, LlmFunctionDefinition, LlmMessage,
    LlmToolCall, LlmToolDefinition,
};
use super::memory::{ConversationMemory, MemoryStore, ToolCallRecord};
use crate::mcp::{McpError, McpHub, ToolContent, ToolResult};

/// Configuration for the Agent Runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentConfig {
    pub max_steps: u32,
    pub temperature: f32,
    pub context_window: usize,
    pub summary_threshold: usize,
}

impl Default for AgentConfig {
    fn default() -> Self {
        Self {
            max_steps: 10,
            temperature: 0.7,
            context_window: 16000,
            summary_threshold: 12000,
        }
    }
}

/// Status of an Agent conversation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AgentStatus {
    Idle,
    Thinking,
    CallingTool { tool_name: String },
    ProcessingResult,
    Complete,
    #[serde(rename = "error")]
    Error(String),
}

/// State of a running Agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentState {
    pub conversation_id: String,
    pub step_count: u32,
    pub status: AgentStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_task: Option<String>,
    pub tools_used: Vec<String>,
}

/// A single message in the Agent conversation (public interface).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCall>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<DateTime<Utc>>,
}

/// A tool call made by the Agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: Value,
}

/// Result of a complete Agent run.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentRunResult {
    pub final_answer: String,
    pub steps: Vec<ReActStep>,
    pub tools_used: Vec<String>,
    #[serde(default)]
    pub requires_user_input: bool,
}

impl Default for AgentRunResult {
    fn default() -> Self {
        Self {
            final_answer: String::new(),
            steps: Vec::new(),
            tools_used: Vec::new(),
            requires_user_input: false,
        }
    }
}

/// A single ReAct step.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReActStep {
    pub step_number: u32,
    pub thought: String,
    pub action: AgentAction,
    pub observation: String,
}

/// Possible actions the Agent can take.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentAction {
    #[serde(rename = "think")]
    Think { content: String },
    #[serde(rename = "tool_call")]
    ToolCall { tool_name: String, arguments: Value },
    #[serde(rename = "respond")]
    Respond { content: String },
    #[serde(rename = "ask_user")]
    AskUser { question: String },
}

/// Agent Runtime errors.
#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("Max steps ({0}) reached, {1} steps executed")]
    MaxStepsReached(u32, usize),
    #[error("LLM error: {0}")]
    Llm(#[from] CloudLlmError),
    #[error("MCP error: {0}")]
    Mcp(#[from] McpError),
    #[error("Memory error: {0}")]
    Memory(String),
    #[error("Invalid LLM response format: {0}")]
    InvalidResponse(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

/// The Agent Runtime: manages ReAct decision loop.
pub struct AgentRuntime {
    pub config: AgentConfig,
    pub mcp_hub: Arc<McpHub>,
    pub cloud_client: Arc<CloudLlmClient>,
    pub memory_store: Arc<dyn MemoryStore>,
    pub state: Arc<RwLock<AgentState>>,
}

impl AgentRuntime {
    /// Create a new Agent Runtime.
    pub fn new(
        config: AgentConfig,
        mcp_hub: Arc<McpHub>,
        cloud_client: Arc<CloudLlmClient>,
        memory_store: Arc<dyn MemoryStore>,
    ) -> Result<Self, AgentError> {
        let state = Arc::new(RwLock::new(AgentState {
            conversation_id: String::new(),
            step_count: 0,
            status: AgentStatus::Idle,
            current_task: None,
            tools_used: Vec::new(),
        }));

        Ok(Self {
            config,
            mcp_hub,
            cloud_client,
            memory_store,
            state,
        })
    }

    /// Run the ReAct decision loop for a user query.
    pub async fn run(
        &self,
        conversation_id: String,
        user_query: String,
        llm_config: CloudLlmConfig,
    ) -> Result<AgentRunResult, AgentError> {

        // Initialize state
        {
            let mut state = self.state.write().await;
            state.conversation_id = conversation_id.clone();
            state.status = AgentStatus::Thinking;
            state.step_count = 0;
            state.tools_used.clear();
        }

        // Load or create memory
        let mut memory = self
            .memory_store
            .load(&conversation_id)
            .await
            .map_err(|e| AgentError::Memory(e.to_string()))?;

        // Add system prompt
        let system_prompt = self.build_system_prompt().await;
        memory.messages.clear(); // Start fresh for this run
        memory.add_message("system", system_prompt);
        memory.add_message("user", user_query.clone());

        let mut steps: Vec<ReActStep> = Vec::new();
        for step_idx in 0..self.config.max_steps {
            // Manage context window
            self.manage_context_window(&mut memory).await?;

            // Build LLM messages
            let llm_messages = self.build_llm_messages(&memory);

            // Get available tools
            let available_tools = self.mcp_hub.list_available_tools().await;
            let tool_definitions = if available_tools.is_empty() {
                None
            } else {
                Some(
                    available_tools
                        .iter()
                        .map(|t| LlmToolDefinition {
                            tool_type: "function".to_string(),
                            function: LlmFunctionDefinition {
                                name: t.info.name.clone(),
                                description: t.info.description.clone(),
                                parameters: t.info.parameters.clone(),
                            },
                        })
                        .collect(),
                )
            };

            // Update state
            {
                let mut state = self.state.write().await;
                state.status = AgentStatus::Thinking;
                state.step_count = step_idx + 1;
            }

            // Call LLM
            debug!("Agent step {}: calling LLM", step_idx + 1);
            let llm_response = self
                .cloud_client
                .chat(&llm_config, llm_messages, tool_definitions)
                .await?;

            // Parse response
            let (thought, action) = self.parse_llm_response(&llm_response);

            debug!("Agent step {}: thought = '{}'", step_idx + 1, thought);

            // Execute action
            let observation = match action {
                AgentAction::Think { ref content } => content.clone(),
                AgentAction::ToolCall {
                    ref tool_name,
                    ref arguments,
                } => {
                    let mut state = self.state.write().await;
                    state.status = AgentStatus::CallingTool {
                        tool_name: tool_name.clone(),
                    };
                    state.tools_used.push(tool_name.clone());
                    drop(state);

                    info!("Agent calling tool '{}'", tool_name);
                    let result = self.mcp_hub.call_tool(tool_name, arguments.clone()).await;

                    let observation = match result {
                        Ok(tool_result) => {
                            info!("Tool '{}' returned {} content items", tool_name, tool_result.content.len());
                            self.format_tool_result(&tool_result)
                        }
                        Err(e) => {
                            warn!("Tool '{}' failed: {}", tool_name, e);
                            format!("工具调用失败: {}", e)
                        }
                    };

                    // Add tool call and result to memory
                    memory.add_assistant_with_tools(
                        thought.clone(),
                        vec![ToolCallRecord {
                            id: format!("call_{}", step_idx),
                            name: tool_name.clone(),
                            arguments: arguments.clone(),
                        }],
                    );
                    memory.add_tool_result(tool_name, observation.clone());

                    observation
                }
                AgentAction::Respond { ref content } => {
                    let mut state = self.state.write().await;
                    state.status = AgentStatus::Complete;

                    // Save final memory
                    let _ = self.memory_store.save(&conversation_id, &memory).await;

                    return Ok(AgentRunResult {
                        final_answer: content.clone(),
                        steps,
                        tools_used: state.tools_used.clone(),
                        requires_user_input: false,
                    });
                }
                AgentAction::AskUser { ref question } => {
                    let mut state = self.state.write().await;
                    state.status = AgentStatus::Idle;

                    // Save memory
                    let _ = self.memory_store.save(&conversation_id, &memory).await;

                    return Ok(AgentRunResult {
                        final_answer: question.clone(),
                        steps,
                        tools_used: state.tools_used.clone(),
                        requires_user_input: true,
                    });
                }
            };

            steps.push(ReActStep {
                step_number: step_idx + 1,
                thought: thought.clone(),
                action: action.clone(),
                observation: observation.clone(),
            });
        }

        Err(AgentError::MaxStepsReached(self.config.max_steps, steps.len()))
    }

    /// Build the system prompt with available tools.
    async fn build_system_prompt(&self) -> String {
        let base_prompt = r#"你是一个科研助手 Agent。你可以使用以下工具来帮助用户完成科研任务：

{tools}

你的工作流程遵循 ReAct (Reasoning + Acting) 模式：
1. 思考（Thought）: 分析用户的需求，思考如何解决
2. 行动（Action）: 选择合适的工具并调用
3. 观察（Observation）: 查看工具返回的结果
4. 根据观察结果，决定是继续调用工具还是直接回答用户

重要规则：
- 如果用户的问题可以直接回答，直接回答即可，不需要调用工具
- 如果需要外部信息（搜索、文件读取等），使用相应的工具
- 每次只能调用一个工具
- 工具调用失败时，尝试其他方法或直接告诉用户
- 保持回答简洁、专业、准确
"#;

        let tools = self.mcp_hub.list_available_tools().await;
        let tool_desc = if tools.is_empty() {
            "(暂无可用工具)".to_string()
        } else {
            tools
                .iter()
                .map(|t| format!("- {}: {}", t.info.name, t.info.description))
                .collect::<Vec<_>>()
                .join("\n")
        };

        base_prompt.replace("{tools}", &tool_desc)
    }

    /// Convert conversation memory to LLM messages.
    fn build_llm_messages(&self, memory: &ConversationMemory) -> Vec<LlmMessage> {
        memory
            .messages
            .iter()
            .map(|m| LlmMessage {
                role: m.role.clone(),
                content: m.content.clone(),
                tool_calls: m.tool_calls.as_ref().map(|tcs| {
                    tcs.iter()
                        .map(|tc| LlmToolCall {
                            id: tc.id.clone(),
                            call_type: "function".to_string(),
                            function: super::cloud_llm::LlmFunctionCall {
                                name: tc.name.clone(),
                                arguments: tc.arguments.to_string(),
                            },
                        })
                        .collect()
                }),
            })
            .collect()
    }

    /// Parse LLM response into thought + action.
    fn parse_llm_response(&self, response: &super::cloud_llm::LlmResponse) -> (String, AgentAction) {
        // If the LLM made tool calls, convert them to AgentAction::ToolCall
        if let Some(tool_calls) = &response.tool_calls {
            if let Some(first) = tool_calls.first() {
                let args = serde_json::from_str(&first.function.arguments).unwrap_or(Value::Null);
                return (
                    response.content.clone(),
                    AgentAction::ToolCall {
                        tool_name: first.function.name.clone(),
                        arguments: args,
                    },
                );
            }
        }

        // Otherwise, interpret the content as a direct response
        let content = response.content.trim();

        // Check for explicit action markers in the content
        if content.starts_with("<ask_user>") && content.ends_with("</ask_user>") {
            let question = content
                .trim_start_matches("<ask_user>")
                .trim_end_matches("</ask_user>")
                .trim()
                .to_string();
            return (
                "需要向用户确认更多信息".to_string(),
                AgentAction::AskUser { question },
            );
        }

        // Default: treat as direct response
        (
            "分析完成，准备回答".to_string(),
            AgentAction::Respond {
                content: response.content.clone(),
            },
        )
    }

    /// Format a tool result for the LLM observation.
    fn format_tool_result(&self, result: &ToolResult) -> String {
        result
            .content
            .iter()
            .map(|c| match c {
                ToolContent::Text { text } => text.clone(),
                ToolContent::Image { data, mime_type } => {
                    format!("[Image: {} ({} bytes)]", mime_type, data.len())
                }
                ToolContent::Resource { resource } => {
                    format!("[Resource: {}]", resource.to_string())
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Manage context window: summarize if exceeding threshold.
    async fn manage_context_window(
        &self,
        memory: &mut ConversationMemory,
    ) -> Result<(), AgentError> {
        if memory.estimate_tokens() > self.config.summary_threshold {
            // Simple summarization: keep system prompt + last few messages
            let summary = "之前的对话已被摘要...".to_string();
            memory.summarize(summary);
        }
        Ok(())
    }

    /// Cancel a running Agent task (placeholder).
    pub async fn cancel(&self, _conversation_id: &str) -> Result<(), AgentError> {
        // TODO: Implement proper cancellation with CancellationToken
        Ok(())
    }
}
