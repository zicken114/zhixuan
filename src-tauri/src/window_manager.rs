use tauri::{Emitter, Listener, Manager, PhysicalPosition, State};

use crate::models::{MonitorFrame, WidgetDockState, WindowInfo};
use crate::AppState;

/// Return the currently detected active window information.
#[tauri::command]
pub fn get_active_window_info(state: State<'_, AppState>) -> Option<WindowInfo> {
    state.current_window.read().unwrap().clone()
}

/// Move the widget window to an exact position.
#[tauri::command]
pub fn set_widget_position(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("Widget window not found")?;

    window
        .set_position(PhysicalPosition::new(x as i32, y as i32))
        .map_err(|e| e.to_string())
}

/// Center the widget at a default position (72% width, 22% height on primary monitor).
#[tauri::command]
pub fn set_widget_default_position(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("widget")
        .ok_or("Widget window not found")?;

    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor not found")?;

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let x = monitor_pos.x + ((monitor_size.width as f64 * 0.72) as i32) - (window_size.width as i32 / 2);
    let y = monitor_pos.y + ((monitor_size.height as f64 * 0.22) as i32) - (window_size.height as i32 / 2);

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Return the geometry of the primary monitor.
#[tauri::command]
pub fn get_primary_monitor_frame(app: tauri::AppHandle) -> Result<MonitorFrame, String> {
    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor not found")?;

    let position = monitor.position();
    let size = monitor.size();

    Ok(MonitorFrame {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    })
}

/// Snap the widget to the nearest screen edge if it is within the threshold.
/// Returns the dock side and the snapped position.
#[tauri::command]
pub fn snap_widget_to_bounds(app: tauri::AppHandle) -> Result<WidgetDockState, String> {
    const EDGE_THRESHOLD: i32 = 28;

    let window = app
        .get_webview_window("widget")
        .ok_or("Widget window not found")?;

    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor not found")?;

    let monitor_pos = monitor.position();
    let monitor_size = monitor.size();
    let window_pos = window.outer_position().map_err(|e| e.to_string())?;
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let min_x = monitor_pos.x;
    let min_y = monitor_pos.y;
    let max_x = monitor_pos.x + monitor_size.width as i32 - window_size.width as i32;
    let max_y = monitor_pos.y + monitor_size.height as i32 - window_size.height as i32;

    let mut target_x = window_pos.x.clamp(min_x, max_x);
    let target_y = window_pos.y.clamp(min_y, max_y);

    let distance_to_left = (target_x - min_x).abs();
    let distance_to_right = (max_x - target_x).abs();

    let side = if distance_to_left <= EDGE_THRESHOLD {
        target_x = min_x;
        "left"
    } else if distance_to_right <= EDGE_THRESHOLD {
        target_x = max_x;
        "right"
    } else {
        "none"
    };

    window
        .set_position(PhysicalPosition::new(target_x, target_y))
        .map_err(|e| e.to_string())?;

    Ok(WidgetDockState {
        side: side.to_string(),
        x: target_x,
        y: target_y,
    })
}

/// Center any window on the primary monitor.
#[tauri::command]
pub fn center_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let window = app.get_webview_window(&label).ok_or("Window not found")?;

    let monitor = app
        .primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor not found")?;

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let x = monitor_pos.x + ((monitor_size.width as i32 - window_size.width as i32) / 2);
    let y = monitor_pos.y + ((monitor_size.height as i32 - window_size.height as i32) / 2);

    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Show a window by label.
#[tauri::command]
pub fn show_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide a window by label.
#[tauri::command]
pub fn hide_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide the capture window specifically.
#[tauri::command]
pub fn hide_capture_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Show the result window and bring it to focus.
#[tauri::command]
pub async fn show_result_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("result") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Wait for the result window to emit its "ready" signal (with a 3-second timeout).
#[tauri::command]
pub async fn wait_for_result_window_ready(app: tauri::AppHandle) -> Result<(), String> {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let ready = Arc::new(AtomicBool::new(false));
    let ready_clone = ready.clone();

    app.once("result-window-ready", move |_| {
        ready_clone.store(true, Ordering::SeqCst);
    });

    let start = std::time::Instant::now();
    while start.elapsed() < std::time::Duration::from_secs(3) {
        if ready.load(Ordering::SeqCst) {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    Ok(())
}

/// Emit the signal that the result window is ready (called from the frontend).
#[tauri::command]
pub async fn result_window_ready(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("result-window-ready", ());
    Ok(())
}
