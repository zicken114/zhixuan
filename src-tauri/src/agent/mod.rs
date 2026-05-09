pub mod cloud_llm;
pub mod memory;
pub mod runtime;

pub use cloud_llm::{CloudLlmClient, CloudLlmConfig};
pub use memory::{ConversationMemory, MemoryMessage, MemoryStore, SqliteMemoryStore, ToolCallRecord};
pub use runtime::{AgentAction, AgentConfig, AgentError, AgentRunResult, AgentRuntime, AgentState, AgentStatus, ReActStep, ToolCall};

use std::sync::Arc;
use tauri::{Emitter, Manager, State};

use crate::mcp::McpHub;

/// Start an Agent task with the given query.
/// Returns a conversation_id immediately; results are emitted via events.
#[tauri::command]
pub async fn agent_run(
    app: tauri::AppHandle,
    mcp_hub: State<'_, McpHub>,
    query: String,
    llm_config: CloudLlmConfig,
    conversation_id: Option<String>,
) -> Result<String, String> {
    let conversation_id = conversation_id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let cid = conversation_id.clone();

    let app_data_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());

    let memory_store = Arc::new(
        SqliteMemoryStore::new(app_data_dir.join("ai_research_assistant.db"))
            .map_err(|e| e.to_string())?,
    );

    let cloud_client = Arc::new(CloudLlmClient::new());

    let agent_config = AgentConfig {
        max_steps: 10,
        temperature: 0.7,
        context_window: 16000,
        summary_threshold: 12000,
    };

    let mcp_hub_arc = Arc::new(mcp_hub.inner().clone());
    let runtime = Arc::new(
        AgentRuntime::new(
            agent_config,
            mcp_hub_arc,
            cloud_client,
            memory_store,
        )
        .map_err(|e| e.to_string())?,
    );

    let app_clone = app.clone();
    let cid_clone = cid.clone();

    tauri::async_runtime::spawn(async move {
        let result = runtime.run(cid_clone.clone(), query, llm_config).await;
        match result {
            Ok(run_result) => {
                let _ = app_clone.emit(
                    "agent:complete",
                    serde_json::json!({
                        "conversation_id": cid_clone,
                        "result": run_result,
                    }),
                );
            }
            Err(e) => {
                let _ = app_clone.emit(
                    "agent:error",
                    serde_json::json!({
                        "conversation_id": cid_clone,
                        "error": e.to_string(),
                    }),
                );
            }
        }
    });

    Ok(cid)
}

/// Cancel a running Agent task.
#[tauri::command]
pub async fn agent_cancel(
    _conversation_id: String,
) -> Result<(), String> {
    // TODO: Implement cancellation via CancellationToken
    Ok(())
}

/// Get the current state of an Agent conversation.
#[tauri::command]
pub async fn agent_get_state(
    _conversation_id: String,
) -> Result<AgentState, String> {
    // TODO: Implement state retrieval from memory store
    Ok(AgentState {
        conversation_id: _conversation_id,
        step_count: 0,
        status: AgentStatus::Idle,
        current_task: None,
        tools_used: vec![],
    })
}

/// Send a user response back to an Agent that asked for input.
#[tauri::command]
pub async fn agent_user_response(
    _conversation_id: String,
    _response: String,
) -> Result<(), String> {
    // TODO: Implement resuming Agent with user response
    Ok(())
}
