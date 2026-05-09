use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

/// Configuration for cloud LLM API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloudLlmConfig {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    #[serde(default = "default_temperature")]
    pub temperature: f32,
    #[serde(default)]
    pub max_tokens: Option<u32>,
}

fn default_temperature() -> f32 {
    0.7
}

impl Default for CloudLlmConfig {
    fn default() -> Self {
        Self {
            provider: String::new(),
            base_url: String::new(),
            api_key: String::new(),
            model: String::new(),
            temperature: 0.7,
            max_tokens: None,
        }
    }
}

/// A message for the LLM chat API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmMessage {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<LlmToolCall>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: LlmFunctionCall,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmFunctionCall {
    pub name: String,
    pub arguments: String,
}

/// Tool definition for function calling.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmToolDefinition {
    #[serde(rename = "type")]
    pub tool_type: String,
    pub function: LlmFunctionDefinition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmFunctionDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// LLM API response (non-streaming).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmResponse {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<LlmToolCall>>,
    pub usage: Option<LlmUsage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

/// Cloud LLM client supporting streaming and non-streaming requests.
pub struct CloudLlmClient {
    http_client: reqwest::Client,
}

/// Error types for Cloud LLM client.
#[derive(Debug, thiserror::Error)]
pub enum CloudLlmError {
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("API error: {status} - {message}")]
    Api { status: u16, message: String },
    #[error("Invalid response format: {0}")]
    InvalidResponse(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Request timeout")]
    Timeout,
    #[error("Stream interrupted")]
    StreamInterrupted,
}

impl CloudLlmClient {
    pub fn new() -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(120))
            .build()
            .unwrap_or_default();
        Self { http_client }
    }

    /// Send a chat completion request (non-streaming).
    pub async fn chat(
        &self,
        config: &CloudLlmConfig,
        messages: Vec<LlmMessage>,
        tools: Option<Vec<LlmToolDefinition>>,
    ) -> Result<LlmResponse, CloudLlmError> {
        let url = Self::resolve_url(&config.base_url);

        let mut body = serde_json::json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "stream": false,
        });

        if let Some(max_tokens) = config.max_tokens {
            body["max_tokens"] = serde_json::json!(max_tokens);
        }

        if let Some(tools) = &tools {
            body["tools"] = serde_json::to_value(tools)?;
        }

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(CloudLlmError::Api {
                status: status.as_u16(),
                message,
            });
        }

        let data: Value = response.json().await?;
        Self::parse_response(&data)
    }

    /// Send a chat completion request (streaming).
    /// The `on_token` callback is invoked for each content chunk.
    pub async fn chat_stream(
        &self,
        config: &CloudLlmConfig,
        messages: Vec<LlmMessage>,
        tools: Option<Vec<LlmToolDefinition>>,
        mut on_token: impl FnMut(&str),
    ) -> Result<LlmResponse, CloudLlmError> {
        let url = Self::resolve_url(&config.base_url);

        let mut body = serde_json::json!({
            "model": config.model,
            "messages": messages,
            "temperature": config.temperature,
            "stream": true,
        });

        if let Some(max_tokens) = config.max_tokens {
            body["max_tokens"] = serde_json::json!(max_tokens);
        }

        if let Some(tools) = &tools {
            body["tools"] = serde_json::to_value(tools)?;
        }

        let response = self
            .http_client
            .post(&url)
            .header("Content-Type", "application/json")
            .header("Authorization", format!("Bearer {}", config.api_key))
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            return Err(CloudLlmError::Api {
                status: status.as_u16(),
                message,
            });
        }

        let mut stream = response.bytes_stream();
        let mut full_text = String::new();
        let mut buffer = String::new();
        let mut tool_calls: Option<Vec<LlmToolCall>> = None;

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(CloudLlmError::Http)?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            while let Some(pos) = buffer.find('\n') {
                let line = buffer.drain(..=pos).collect::<String>();
                let line = line.trim();

                if line.is_empty() || !line.starts_with("data: ") {
                    continue;
                }

                let data = &line[6..];
                if data == "[DONE]" {
                    break;
                }

                let parsed: Value = match serde_json::from_str(data) {
                    Ok(v) => v,
                    Err(_) => continue,
                };

                // Extract content delta
                if let Some(token) = parsed
                    .get("choices")
                    .and_then(|c| c.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|choice| choice.get("delta"))
                    .and_then(|delta| delta.get("content"))
                    .and_then(|c| c.as_str())
                {
                    full_text.push_str(token);
                    on_token(token);
                }

                // Extract tool calls (if any)
                if let Some(delta) = parsed
                    .get("choices")
                    .and_then(|c| c.as_array())
                    .and_then(|arr| arr.first())
                    .and_then(|choice| choice.get("delta"))
                {
                    if let Some(tc) = delta.get("tool_calls") {
                        // Streaming tool calls are more complex; for now, collect them
                        // In a full implementation, we'd accumulate partial tool calls
                        if let Ok(calls) = serde_json::from_value::<Vec<LlmToolCall>>(tc.clone()) {
                            tool_calls = Some(calls);
                        }
                    }
                }
            }
        }

        Ok(LlmResponse {
            content: full_text,
            tool_calls,
            usage: None, // Streaming doesn't reliably return usage
        })
    }

    /// Simple non-streaming chat without tools.
    pub async fn chat_simple(
        &self,
        config: &CloudLlmConfig,
        prompt: &str,
    ) -> Result<String, CloudLlmError> {
        let messages = vec![LlmMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
            tool_calls: None,
        }];
        let response = self.chat(config, messages, None).await?;
        Ok(response.content)
    }

    fn resolve_url(base_url: &str) -> String {
        let trimmed = base_url.trim().trim_end_matches('/');
        if trimmed.ends_with("/chat/completions") {
            trimmed.to_string()
        } else {
            format!("{}/chat/completions", trimmed)
        }
    }

    fn parse_response(data: &Value) -> Result<LlmResponse, CloudLlmError> {
        let choice = data
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|arr| arr.first())
            .ok_or_else(|| CloudLlmError::InvalidResponse("Missing choices".to_string()))?;

        let message = choice
            .get("message")
            .ok_or_else(|| CloudLlmError::InvalidResponse("Missing message".to_string()))?;

        let content = message
            .get("content")
            .and_then(|c| c.as_str())
            .unwrap_or_default()
            .to_string();

        let tool_calls = message
            .get("tool_calls")
            .and_then(|tc| tc.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| serde_json::from_value::<LlmToolCall>(v.clone()).ok())
                    .collect()
            });

        let usage = data.get("usage").and_then(|u| {
            serde_json::from_value::<LlmUsage>(u.clone()).ok()
        });

        Ok(LlmResponse {
            content,
            tool_calls,
            usage,
        })
    }
}

// Required for bytes_stream
use futures_util::StreamExt;
