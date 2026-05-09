use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// A single message stored in conversation memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryMessage {
    pub role: String, // "system" | "user" | "assistant" | "tool"
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallRecord {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
}

/// Conversation memory: messages + metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMemory {
    pub messages: Vec<MemoryMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub total_tokens: usize,
}

impl ConversationMemory {
    pub fn new() -> Self {
        Self {
            messages: Vec::new(),
            summary: None,
            total_tokens: 0,
        }
    }

    pub fn add_message(&mut self, role: &str, content: String) {
        self.messages.push(MemoryMessage {
            role: role.to_string(),
            content,
            tool_calls: None,
            timestamp: Some(Utc::now()),
        });
        self.update_token_count();
    }

    pub fn add_assistant_with_tools(
        &mut self,
        content: String,
        tool_calls: Vec<ToolCallRecord>,
    ) {
        self.messages.push(MemoryMessage {
            role: "assistant".to_string(),
            content,
            tool_calls: Some(tool_calls),
            timestamp: Some(Utc::now()),
        });
        self.update_token_count();
    }

    pub fn add_tool_result(&mut self, tool_name: &str, result: String) {
        self.messages.push(MemoryMessage {
            role: "tool".to_string(),
            content: format!("[{}] {}", tool_name, result),
            tool_calls: None,
            timestamp: Some(Utc::now()),
        });
        self.update_token_count();
    }

    fn update_token_count(&mut self) {
        // Rough estimate: ~4 chars per token
        self.total_tokens = self
            .messages
            .iter()
            .map(|m| m.content.len() / 4)
            .sum();
    }

    pub fn estimate_tokens(&self) -> usize {
        self.total_tokens
    }

    pub fn summarize(&mut self, summary: String) {
        self.summary = Some(summary);
        // Keep only the last few messages after summarization
        let to_keep = self.messages.len().min(4);
        let kept: Vec<MemoryMessage> = self.messages.split_off(self.messages.len() - to_keep);
        self.messages = kept;
        self.update_token_count();
    }
}

impl Default for ConversationMemory {
    fn default() -> Self {
        Self::new()
    }
}

/// Trait for conversation memory storage backends.
#[async_trait::async_trait]
pub trait MemoryStore: Send + Sync {
    async fn load(&self,
        conversation_id: &str,
    ) -> Result<ConversationMemory, MemoryError>;
    async fn save(
        &self,
        conversation_id: &str,
        memory: &ConversationMemory,
    ) -> Result<(), MemoryError>;
    async fn append_message(
        &self,
        conversation_id: &str,
        message: &MemoryMessage,
    ) -> Result<(), MemoryError>;
}

/// SQLite-backed memory store.
pub struct SqliteMemoryStore {
    db_path: PathBuf,
}

impl SqliteMemoryStore {
    pub fn new(db_path: PathBuf) -> Result<Self, MemoryError> {
        let store = Self { db_path };
        store.ensure_table()?;
        Ok(store)
    }

    fn ensure_table(&self) -> Result<(), MemoryError> {
        let conn = rusqlite::Connection::open(&self.db_path)?;
        conn.execute(
            "CREATE TABLE IF NOT EXISTS agent_memories (
                conversation_id TEXT PRIMARY KEY,
                messages        TEXT NOT NULL DEFAULT '[]',
                summary         TEXT,
                total_tokens    INTEGER NOT NULL DEFAULT 0,
                created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
            )",
            [],
        )?;
        Ok(())
    }

    fn conn(&self) -> Result<rusqlite::Connection, MemoryError> {
        Ok(rusqlite::Connection::open(&self.db_path)?)
    }
}

#[async_trait::async_trait]
impl MemoryStore for SqliteMemoryStore {
    async fn load(
        &self,
        conversation_id: &str,
    ) -> Result<ConversationMemory, MemoryError> {
        let db_path = self.db_path.clone();
        let cid = conversation_id.to_string();

        tokio::task::spawn_blocking(move || {
            let conn = rusqlite::Connection::open(&db_path)?;
            let mut stmt = conn.prepare(
                "SELECT messages, summary, total_tokens FROM agent_memories WHERE conversation_id = ?1"
            )?;

            let result = stmt.query_row([&cid], |row| {
                let messages_json: String = row.get(0)?;
                let summary: Option<String> = row.get(1)?;
                let total_tokens: i64 = row.get(2)?;

                let messages: Vec<MemoryMessage> =
                    serde_json::from_str(&messages_json).unwrap_or_default();

                Ok(ConversationMemory {
                    messages,
                    summary,
                    total_tokens: total_tokens as usize,
                })
            });

            match result {
                Ok(memory) => Ok(memory),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(ConversationMemory::new()),
                Err(e) => Err(e.into()),
            }
        })
        .await
        .map_err(|e| MemoryError::Database(format!("Task join error: {}", e)))?
    }

    async fn save(
        &self,
        conversation_id: &str,
        memory: &ConversationMemory,
    ) -> Result<(), MemoryError> {
        let db_path = self.db_path.clone();
        let cid = conversation_id.to_string();
        let memory_json = serde_json::to_string(&memory.messages).unwrap_or_default();
        let summary = memory.summary.clone();
        let total_tokens = memory.total_tokens as i64;

        tokio::task::spawn_blocking(move || {
            let conn = rusqlite::Connection::open(&db_path)?;
            conn.execute(
                "INSERT INTO agent_memories (conversation_id, messages, summary, total_tokens)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(conversation_id) DO UPDATE SET
                     messages = excluded.messages,
                     summary = excluded.summary,
                     total_tokens = excluded.total_tokens,
                     updated_at = CURRENT_TIMESTAMP",
                rusqlite::params![cid, memory_json, summary, total_tokens],
            )?;
            Ok(())
        })
        .await
        .map_err(|e| MemoryError::Database(format!("Task join error: {}", e)))?
    }

    async fn append_message(
        &self,
        conversation_id: &str,
        message: &MemoryMessage,
    ) -> Result<(), MemoryError> {
        let mut memory = self.load(conversation_id).await?;
        memory.messages.push(message.clone());
        memory.update_token_count();
        self.save(conversation_id, &memory).await
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MemoryError {
    #[error("Database error: {0}")]
    Database(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
}

impl From<rusqlite::Error> for MemoryError {
    fn from(e: rusqlite::Error) -> Self {
        MemoryError::Database(e.to_string())
    }
}
