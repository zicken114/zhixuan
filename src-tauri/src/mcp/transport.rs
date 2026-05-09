use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Child;
use tokio::sync::{mpsc, oneshot, Mutex};
use tracing::{debug, error, trace, warn};

/// JSON-RPC 2.0 request
#[derive(Debug, Clone, Serialize)]
struct JsonRpcRequest {
    jsonrpc: String,
    id: u64,
    method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    params: Option<Value>,
}

/// JSON-RPC 2.0 response
#[derive(Debug, Clone, Deserialize)]
struct JsonRpcResponse {
    jsonrpc: String,
    #[serde(default)]
    id: Option<u64>,
    #[serde(default)]
    result: Option<Value>,
    #[serde(default)]
    error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Deserialize)]
struct JsonRpcError {
    code: i32,
    message: String,
    #[serde(default)]
    data: Option<Value>,
}

/// Transport error types
#[derive(Debug, thiserror::Error)]
pub enum TransportError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Process spawn failed: {0}")]
    Spawn(String),
    #[error("JSON-RPC error {code}: {message}")]
    JsonRpc { code: i32, message: String },
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Response channel closed")]
    ChannelClosed,
    #[error("Request timed out")]
    Timeout,
}

/// A pending request awaiting response.
type PendingRequest = (u64, String, oneshot::Sender<Result<Value, TransportError>>);

/// Stdio transport for MCP communication via child process stdin/stdout.
pub struct StdioTransport {
    request_tx: mpsc::UnboundedSender<PendingRequest>,
    _child: Child,
    next_id: std::sync::atomic::AtomicU64,
}

impl StdioTransport {
    /// Spawn a new MCP server process and create a stdio transport.
    pub async fn new(
        command: &str,
        args: &[String],
        env: &std::collections::HashMap<String, String>,
    ) -> Result<Self, TransportError> {
        let mut cmd = tokio::process::Command::new(command);
        cmd.args(args)
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let mut child = cmd.spawn().map_err(|e| {
            TransportError::Spawn(format!("Failed to spawn '{}': {}", command, e))
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| TransportError::Spawn("Failed to open stdin".to_string()))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| TransportError::Spawn("Failed to open stdout".to_string()))?;

        let (request_tx, mut request_rx): (
            mpsc::UnboundedSender<PendingRequest>,
            mpsc::UnboundedReceiver<PendingRequest>,
        ) = mpsc::unbounded_channel();

        // Shared pending requests map: id -> response sender
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, TransportError>>>>> =
            Arc::new(Mutex::new(HashMap::new()));

        // ── Writer task: receives requests, writes JSON to stdin ──
        let pending_writer = pending.clone();
        let mut stdin_writer = stdin;
        tokio::spawn(async move {
            while let Some((id, payload, response_tx)) = request_rx.recv().await {
                // Store the response channel
                pending_writer.lock().await.insert(id, response_tx);

                // Write the JSON-RPC request to stdin
                trace!("MCP send [id={}]: {}", id, payload);
                if let Err(e) = stdin_writer.write_all(payload.as_bytes()).await {
                    error!("MCP write error for id={}: {}", id, e);
                    // Remove pending and notify error
                    if let Some(tx) = pending_writer.lock().await.remove(&id) {
                        let _ = tx.send(Err(TransportError::Io(e)));
                    }
                    break;
                }
                if let Err(e) = stdin_writer.write_all(b"\n").await {
                    error!("MCP write newline error for id={}: {}", id, e);
                    if let Some(tx) = pending_writer.lock().await.remove(&id) {
                        let _ = tx.send(Err(TransportError::Io(e)));
                    }
                    break;
                }
                if let Err(e) = stdin_writer.flush().await {
                    error!("MCP flush error for id={}: {}", id, e);
                    if let Some(tx) = pending_writer.lock().await.remove(&id) {
                        let _ = tx.send(Err(TransportError::Io(e)));
                    }
                    break;
                }
            }
            debug!("MCP transport writer task exited");
        });

        // ── Reader task: reads JSON responses from stdout ──
        let pending_reader = pending.clone();
        let mut reader = BufReader::new(stdout).lines();
        tokio::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                trace!("MCP recv: {}", line);

                if let Ok(response) = serde_json::from_str::<JsonRpcResponse>(&line) {
                    if let Some(id) = response.id {
                        if let Some(tx) = pending_reader.lock().await.remove(&id) {
                            let result = if let Some(err) = response.error {
                                Err(TransportError::JsonRpc {
                                    code: err.code,
                                    message: err.message,
                                })
                            } else {
                                Ok(response.result.unwrap_or(Value::Null))
                            };
                            let _ = tx.send(result);
                        } else {
                            warn!("MCP received response for unknown id={}", id);
                        }
                    }
                }
            }
            debug!("MCP stdout closed, reader task exiting");

            // Notify all remaining pending requests
            let mut map = pending_reader.lock().await;
            for (id, tx) in map.drain() {
                warn!("MCP notifying pending request {} of transport closure", id);
                let _ = tx.send(Err(TransportError::Spawn(
                    "Transport closed".to_string(),
                )));
            }
        });

        // ── Stderr reader: log stderr output ──
        if let Some(stderr) = child.stderr.take() {
            let mut stderr_reader = BufReader::new(stderr).lines();
            tokio::spawn(async move {
                while let Ok(Some(line)) = stderr_reader.next_line().await {
                    debug!("MCP server stderr: {}", line);
                }
            });
        }

        Ok(Self {
            request_tx,
            _child: child,
            next_id: std::sync::atomic::AtomicU64::new(1),
        })
    }

    /// Send a JSON-RPC request and await the response.
    pub async fn request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<Value, TransportError> {
        let id = self
            .next_id
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);

        let req = JsonRpcRequest {
            jsonrpc: "2.0".to_string(),
            id,
            method: method.to_string(),
            params,
        };

        let payload = serde_json::to_string(&req)?;

        let (tx, rx) = oneshot::channel();
        self.request_tx
            .send((id, payload, tx))
            .map_err(|_| TransportError::ChannelClosed)?;

        let result = tokio::time::timeout(std::time::Duration::from_secs(30), rx)
            .await
            .map_err(|_| TransportError::Timeout)?
            .map_err(|_| TransportError::ChannelClosed)?;

        result
    }
}
