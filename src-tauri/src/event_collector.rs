use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};

use crate::models::AppEvent;
use crate::AppState;

const RING_BUFFER_CAPACITY: usize = 100;
const FLUSH_INTERVAL_SECS: u64 = 30;

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

/// Event collector with in-memory ring buffer and periodic SQLite flush.
pub struct EventCollector {
    buffer: Arc<Mutex<VecDeque<AppEvent>>>,
    db_path: PathBuf,
    incognito: Arc<Mutex<bool>>,
}

impl EventCollector {
    pub fn new(db_path: PathBuf) -> Self {
        let collector = Self {
            buffer: Arc::new(Mutex::new(VecDeque::with_capacity(RING_BUFFER_CAPACITY))),
            db_path,
            incognito: Arc::new(Mutex::new(false)),
        };

        // Ensure table exists on creation
        if let Err(e) = collector.ensure_table() {
            eprintln!("[EventCollector] Failed to create table: {}", e);
        }

        collector
    }

    /// Enable or disable incognito mode. When enabled, no events are recorded.
    pub fn set_incognito(&self, enabled: bool) {
        *self.incognito.lock().unwrap() = enabled;
    }

    /// Record a single event into the ring buffer. Triggers flush if buffer is full.
    pub fn record(
        &self,
        event_type: &str,
        project_id: Option<String>,
        duration_ms: Option<i64>,
        resource_id: Option<String>,
        metadata: Option<String>,
    ) {
        if *self.incognito.lock().unwrap() {
            return;
        }

        let event = AppEvent {
            id: None,
            event_type: event_type.to_string(),
            timestamp: now_ms(),
            project_id,
            duration_ms,
            resource_id,
            metadata,
        };

        // Atomically insert the event and drain the buffer if it reaches capacity.
        // The lock is held for the entire check+drain to prevent race conditions
        // with concurrent record() or flush() calls.
        let events_to_flush: Vec<AppEvent> = {
            let mut buffer = self.buffer.lock().unwrap();
            if buffer.len() >= RING_BUFFER_CAPACITY {
                // Drop oldest event to make room (ring buffer behavior)
                buffer.pop_front();
            }
            buffer.push_back(event);

            // If buffer is at capacity after insertion, drain immediately
            if buffer.len() >= RING_BUFFER_CAPACITY {
                buffer.drain(..).collect()
            } else {
                vec![]
            }
        };

        if !events_to_flush.is_empty() {
            if let Err(e) = self.flush_events(events_to_flush) {
                eprintln!("[EventCollector] Immediate flush failed: {}", e);
            }
        }
    }

    /// Flush a pre-extracted vector of events to SQLite.
    /// This helper does not touch the buffer lock — callers must extract events themselves.
    fn flush_events(&self, events: Vec<AppEvent>) -> Result<usize, rusqlite::Error> {
        if events.is_empty() {
            return Ok(0);
        }

        let mut conn = Connection::open(&self.db_path)?;
        let tx = conn.transaction()?;

        for event in &events {
            tx.execute(
                "INSERT INTO activity_events
                 (event_type, timestamp, project_id, duration_ms, resource_id, metadata)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    event.event_type,
                    event.timestamp,
                    event.project_id,
                    event.duration_ms,
                    event.resource_id,
                    event.metadata
                ],
            )?;
        }

        tx.commit()?;
        Ok(events.len())
    }

    /// Flush all buffered events to SQLite.
    pub fn flush(&self) -> Result<usize, rusqlite::Error> {
        let events: Vec<AppEvent> = {
            let mut buffer = self.buffer.lock().unwrap();
            if buffer.is_empty() {
                return Ok(0);
            }
            buffer.drain(..).collect()
        };

        self.flush_events(events)
    }

    /// Create the activity_events table and indexes if they don't exist.
    fn ensure_table(&self
    ) -> Result<(), rusqlite::Error> {
        let conn = Connection::open(&self.db_path)?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS activity_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                project_id TEXT,
                duration_ms INTEGER,
                resource_id TEXT,
                metadata TEXT
            )",
            [],
        )?;

        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_type ON activity_events(event_type)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_project ON activity_events(project_id)",
            [],
        )?;
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_time ON activity_events(timestamp)",
            [],
        )?;

        Ok(())
    }

    /// Start the background flush task.
    pub fn start_flush_task(self: Arc<Self>) {
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(FLUSH_INTERVAL_SECS));
            loop {
                interval.tick().await;
                if let Err(e) = self.flush() {
                    eprintln!("[EventCollector] Periodic flush failed: {}", e);
                }
            }
        });
    }
}

/* ───────────────────────────────────────────────
   Tauri commands
   ─────────────────────────────────────────────── */

/// Record an activity event from the frontend.
#[tauri::command]
pub fn record_event(
    state: tauri::State<'_, AppState>,
    event_type: String,
    project_id: Option<String>,
    duration_ms: Option<i64>,
    resource_id: Option<String>,
    metadata: Option<String>,
) {
    state.event_collector.record(
        &event_type,
        project_id,
        duration_ms,
        resource_id,
        metadata,
    );
}

/// Enable or disable incognito mode for event collection.
#[tauri::command]
pub fn set_incognito_mode(state: tauri::State<'_, AppState>, enabled: bool) {
    state.event_collector.set_incognito(enabled);
}

/// Manually flush buffered events to the database.
#[tauri::command]
pub fn flush_events(state: tauri::State<'_, AppState>) -> Result<usize, String> {
    state.event_collector.flush().map_err(|e| e.to_string())
}
