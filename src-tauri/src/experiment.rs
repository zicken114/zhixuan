use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

/* ───────────────────────────────────────────────
   Data structures
   ─────────────────────────────────────────────── */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExperimentSnapshot {
    pub id: Option<i64>,
    pub project_id: Option<String>,
    pub timestamp: i64,
    pub title: String,
    pub snapshot_type: String, // 'screenshot', 'terminal', 'code', 'voice'
    pub parameters: Option<String>, // JSON
    pub notes: Option<String>,
    pub screenshot_path: Option<String>,
    pub audio_path: Option<String>,
    pub tags: Option<String>, // JSON array
    pub created_at: Option<i64>,
}

/* ───────────────────────────────────────────────
   In-memory store (until DB integration from frontend)
   NOTE: Frontend uses useDatabase.ts for persistence.
   These commands are lightweight wrappers for cross-window
   communication and system-level capture triggers.
   ─────────────────────────────────────────────── */

static SNAPSHOTS: Mutex<Vec<ExperimentSnapshot>> = Mutex::new(Vec::new());

#[tauri::command]
pub fn save_experiment_snapshot(data: ExperimentSnapshot) -> Result<i64, String> {
    let mut snapshots = SNAPSHOTS.lock().map_err(|e| e.to_string())?;
    let id = snapshots.len() as i64 + 1;
    let mut snapshot = data.clone();
    snapshot.id = Some(id);
    if snapshot.created_at.is_none() {
        snapshot.created_at = Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64,
        );
    }
    snapshots.push(snapshot);
    Ok(id)
}

#[tauri::command]
pub fn get_experiment_snapshots(
    project_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ExperimentSnapshot>, String> {
    let snapshots = SNAPSHOTS.lock().map_err(|e| e.to_string())?;
    let mut results: Vec<ExperimentSnapshot> = snapshots
        .iter()
        .filter(|s| {
            if let Some(ref pid) = project_id {
                s.project_id.as_ref() == Some(pid)
            } else {
                true
            }
        })
        .cloned()
        .collect();
    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let limit = limit.unwrap_or(100) as usize;
    Ok(results.into_iter().take(limit).collect())
}

#[tauri::command]
pub fn search_experiment_snapshots(
    query: String,
    project_id: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<ExperimentSnapshot>, String> {
    let snapshots = SNAPSHOTS.lock().map_err(|e| e.to_string())?;
    let query_lower = query.to_lowercase();
    let mut results: Vec<ExperimentSnapshot> = snapshots
        .iter()
        .filter(|s| {
            let matches_project = if let Some(ref pid) = project_id {
                s.project_id.as_ref() == Some(pid)
            } else {
                true
            };
            let matches_query = s.title.to_lowercase().contains(&query_lower)
                || s.notes.as_ref().map_or(false, |n| n.to_lowercase().contains(&query_lower))
                || s.tags.as_ref().map_or(false, |t| t.to_lowercase().contains(&query_lower));
            matches_project && matches_query
        })
        .cloned()
        .collect();
    results.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    let limit = limit.unwrap_or(50) as usize;
    Ok(results.into_iter().take(limit).collect())
}

#[tauri::command]
pub fn delete_experiment_snapshot(id: i64) -> Result<(), String> {
    let mut snapshots = SNAPSHOTS.lock().map_err(|e| e.to_string())?;
    snapshots.retain(|s| s.id != Some(id));
    Ok(())
}

/// Trigger a screenshot capture for experiment recording.
/// Emits `experiment:capture-ready` with the screenshot path when done.
#[tauri::command]
pub async fn trigger_experiment_screenshot(app: AppHandle) -> Result<(), String> {
    // Emit event that frontend capture window should handle
    let _ = app.emit("experiment:capture-triggered", ());
    // Also trigger the existing screenshot flow
    let _ = crate::screenshot::trigger_capture(app);
    Ok(())
}
