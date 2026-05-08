use serde_json;
use tauri::Emitter;

/// Emit a streaming content chunk to the result window.
#[tauri::command]
pub async fn emit_to_result(app: tauri::AppHandle, content: String) -> Result<(), String> {
    let _ = app.emit("result-stream", content);
    Ok(())
}

/// Emit the extraction completion event with full metadata.
#[tauri::command]
pub async fn emit_extraction_complete(
    app: tauri::AppHandle,
    icon: String,
    label: String,
    content: String,
) -> Result<(), String> {
    let _ = app.emit(
        "extraction-complete",
        serde_json::json!({"icon": icon, "label": label, "content": content}),
    );
    Ok(())
}

/// Emit an extraction error to the result window.
#[tauri::command]
pub async fn emit_extraction_error(app: tauri::AppHandle, error: String) -> Result<(), String> {
    let _ = app.emit("extraction-error", error);
    Ok(())
}

/// Broadcast popup-history updates to all windows.
#[tauri::command]
pub async fn notify_history_changed(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("history-changed", ());
    Ok(())
}
