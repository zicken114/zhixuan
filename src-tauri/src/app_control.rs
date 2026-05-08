use arboard::Clipboard;
use tauri::{Emitter, Manager, PhysicalPosition};

use crate::models::ClipboardPayload;

fn clamp_popup_position(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    anchor_x: i32,
    anchor_y: i32,
) -> Result<PhysicalPosition<i32>, String> {
    const EDGE_PADDING: i32 = 12;
    const CURSOR_OFFSET: i32 = 8;

    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let monitor = app
        .available_monitors()
        .map_err(|e| e.to_string())?
        .into_iter()
        .find(|monitor| {
            let pos = monitor.position();
            let size = monitor.size();
            anchor_x >= pos.x
                && anchor_x < pos.x + size.width as i32
                && anchor_y >= pos.y
                && anchor_y < pos.y + size.height as i32
        })
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or("No monitor available".to_string())?;

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let min_x = monitor_pos.x + EDGE_PADDING;
    let min_y = monitor_pos.y + EDGE_PADDING;
    let max_x = monitor_pos.x + monitor_size.width as i32 - window_size.width as i32 - EDGE_PADDING;
    let max_y = monitor_pos.y + monitor_size.height as i32 - window_size.height as i32 - EDGE_PADDING;

    let preferred_x = anchor_x + CURSOR_OFFSET;
    let preferred_y = anchor_y + CURSOR_OFFSET;

    let clamped_x = preferred_x.clamp(min_x, max_x.max(min_x));
    let clamped_y = preferred_y.clamp(min_y, max_y.max(min_y));

    Ok(PhysicalPosition::new(clamped_x, clamped_y))
}

/// Write or append text content to a file path, creating parent directories as needed.
#[tauri::command]
pub fn write_text_file(path: String, contents: String, append: bool) -> Result<(), String> {
    use std::fs::{self, OpenOptions};
    use std::io::Write;
    use std::path::Path;

    let file_path = Path::new(&path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directories: {}", e))?;
    }

    if append {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(file_path)
            .map_err(|e| format!("Failed to open file for append: {}", e))?;
        file.write_all(contents.as_bytes())
            .map_err(|e| format!("Failed to append to file: {}", e))?;
    } else {
        fs::write(file_path, contents).map_err(|e| format!("Failed to write file: {}", e))?;
    }
    Ok(())
}

/// Check whether a file exists at the given path.
#[tauri::command]
pub fn check_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Proxy HTTP GET request to Zotero local API (bypasses CORS).
/// Returns JSON: { body: string, total_results?: number }.
#[tauri::command]
pub async fn fetch_zotero(url: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let res = client
        .get(&url)
        .header("Zotero-API-Version", "3")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Zotero API returned {}", res.status()));
    }

    let total_results = res
        .headers()
        .get("Total-Results")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<i64>().ok());

    let text = res.text().await.map_err(|e| format!("Failed to read response: {}", e))?;

    let mut result = serde_json::Map::new();
    result.insert("body".to_string(), serde_json::Value::String(text));
    if let Some(tr) = total_results {
        result.insert("total_results".to_string(), serde_json::Value::Number(tr.into()));
    }

    Ok(serde_json::Value::Object(result))
}

/// Quit the application entirely.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Show the popup window at the current mouse position, seeded with clipboard text.
#[tauri::command]
pub fn show_popup_with_clipboard(app: tauri::AppHandle) -> Result<(), String> {
    use mouse_position::mouse_position::Mouse;

    let (x, y) = match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => (x, y),
        Mouse::Error => return Err("Failed to get mouse position".to_string()),
    };

    let text = match Clipboard::new() {
        Ok(mut cb) => cb.get_text().unwrap_or_default(),
        Err(_) => String::new(),
    };

    if let Some(window) = app.get_webview_window("popup") {
        let target_position = clamp_popup_position(&app, &window, x, y)?;
        window
            .set_position(target_position)
            .map_err(|e| e.to_string())?;

        let payload = ClipboardPayload { text, x, y };
        window
            .emit("clipboard-data", payload)
            .map_err(|e| e.to_string())?;

        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Show the main window and signal it to open the settings panel.
#[tauri::command]
pub fn show_window_with_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        window
            .emit("show-settings", serde_json::json!({ "standalone": true }))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show the popup window and dispatch a pre-selected action immediately.
/// Used by reading-companion hotkeys (F1 = reading note, etc.) so the popup
/// can fire a specific menu action without the user having to click.
#[tauri::command]
pub fn show_popup_with_action(app: tauri::AppHandle, action: String) -> Result<(), String> {
    use mouse_position::mouse_position::Mouse;

    let (x, y) = match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => (x, y),
        Mouse::Error => return Err("Failed to get mouse position".to_string()),
    };

    let text = match Clipboard::new() {
        Ok(mut cb) => cb.get_text().unwrap_or_default(),
        Err(_) => String::new(),
    };

    if let Some(window) = app.get_webview_window("popup") {
        let target_position = clamp_popup_position(&app, &window, x, y)?;
        window
            .set_position(target_position)
            .map_err(|e| e.to_string())?;

        let payload = ClipboardPayload { text, x, y };
        window
            .emit("clipboard-data", payload)
            .map_err(|e| e.to_string())?;

        // Tell the popup to auto-dispatch the action right after it mounts/is shown.
        window
            .emit("popup:auto-action", action)
            .map_err(|e| e.to_string())?;

        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}
