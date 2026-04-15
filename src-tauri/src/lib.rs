use tauri::{Manager, PhysicalPosition, Emitter};
use arboard::Clipboard;
use serde::Serialize;
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::ImageFormat;
use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

static CAPTURE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Serialize)]
struct ClipboardPayload {
    text: String,
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize)]
struct ScreenshotPayload {
    image: String,
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

#[derive(Clone, Serialize)]
struct MonitorFrame {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Serialize)]
struct WidgetDockState {
    side: String,
    x: i32,
    y: i32,
}

// Tauri commands
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn set_widget_position(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    let window = app.get_webview_window("widget")
        .ok_or("Widget window not found")?;

    window.set_position(PhysicalPosition::new(x as i32, y as i32))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn set_widget_default_position(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("widget")
        .ok_or("Widget window not found")?;

    let monitor = app.primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor not found")?;

    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let x = monitor_position.x + ((monitor_size.width as f64 * 0.72) as i32) - (window_size.width as i32 / 2);
    let y = monitor_position.y + ((monitor_size.height as f64 * 0.22) as i32) - (window_size.height as i32 / 2);

    window.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_primary_monitor_frame(app: tauri::AppHandle) -> Result<MonitorFrame, String> {
    let monitor = app.primary_monitor()
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

#[tauri::command]
fn snap_widget_to_bounds(app: tauri::AppHandle) -> Result<WidgetDockState, String> {
    let window = app.get_webview_window("widget")
        .ok_or("Widget window not found")?;

    let monitor = app.primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor not found")?;

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_position = window.outer_position().map_err(|e| e.to_string())?;
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let min_x = monitor_position.x;
    let min_y = monitor_position.y;
    let max_x = monitor_position.x + monitor_size.width as i32 - window_size.width as i32;
    let max_y = monitor_position.y + monitor_size.height as i32 - window_size.height as i32;

    let mut target_x = window_position.x.clamp(min_x, max_x);
    let target_y = window_position.y.clamp(min_y, max_y);

    let threshold = 28;
    let distance_to_left = (target_x - min_x).abs();
    let distance_to_right = (max_x - target_x).abs();

    let side = if distance_to_left <= threshold {
        target_x = min_x;
        "left"
    } else if distance_to_right <= threshold {
        target_x = max_x;
        "right"
    } else {
        "none"
    };

    window.set_position(PhysicalPosition::new(target_x, target_y))
        .map_err(|e| e.to_string())?;

    Ok(WidgetDockState {
        side: side.to_string(),
        x: target_x,
        y: target_y,
    })
}

#[tauri::command]
fn center_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let window = app.get_webview_window(&label)
        .ok_or("Window not found")?;

    let monitor = app.primary_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("Primary monitor not found")?;

    let monitor_size = monitor.size();
    let monitor_position = monitor.position();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let x = monitor_position.x + ((monitor_size.width as i32 - window_size.width as i32) / 2);
    let y = monitor_position.y + ((monitor_size.height as i32 - window_size.height as i32) / 2);

    window.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_clipboard_text() -> Result<String, String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Failed to access clipboard: {}", e))?;

    clipboard.get_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))
}

#[tauri::command]
fn set_clipboard_text(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Failed to access clipboard: {}", e))?;

    clipboard.set_text(text)
        .map_err(|e| format!("Failed to write clipboard: {}", e))
}

#[tauri::command]
fn get_mouse_position() -> Result<(i32, i32), String> {
    match mouse_position::mouse_position::Mouse::get_mouse_position() {
        mouse_position::mouse_position::Mouse::Position { x, y } => Ok((x, y)),
        mouse_position::mouse_position::Mouse::Error => Err("Failed to get mouse position".to_string()),
    }
}

#[tauri::command]
fn capture_fullscreen() -> Result<ScreenshotPayload, String> {
    use screenshots::Screen;

    let screens = Screen::all()
        .map_err(|e| format!("Failed to get screens: {:?}", e))?;

    if screens.is_empty() {
        return Err("No screens found".to_string());
    }

    let screen = &screens[0];

    let image = screen.capture()
        .map_err(|e| format!("Failed to capture screen: {:?}", e))?;

    let mut png_bytes: Vec<u8> = Vec::new();
    let rgba_image = image::RgbaImage::from_raw(
        image.width(),
        image.height(),
        image.to_vec()
    ).ok_or("Failed to create image from raw data")?;

    rgba_image.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    let base64_image = BASE64.encode(&png_bytes);

    Ok(ScreenshotPayload {
        image: base64_image,
        width: image.width(),
        height: image.height(),
        x: screen.display_info.x,
        y: screen.display_info.y,
    })
}

#[tauri::command]
fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    use screenshots::Screen;

    let screens = Screen::all()
        .map_err(|e| format!("Failed to get screens: {:?}", e))?;

    if screens.is_empty() {
        return Err("No screens found".to_string());
    }

    let screen = screens.iter()
        .find(|s| {
            let info = &s.display_info;
            x >= info.x && y >= info.y &&
            x < info.x + info.width as i32 &&
            y < info.y + info.height as i32
        })
        .ok_or("No screen found at the given position")?;

    let image = screen.capture_area(x, y, width, height)
        .map_err(|e| format!("Failed to capture region: {:?}", e))?;

    let mut png_bytes: Vec<u8> = Vec::new();
    let rgba_image = image::RgbaImage::from_raw(
        image.width(),
        image.height(),
        image.to_vec()
    ).ok_or("Failed to create image from raw data")?;

    rgba_image.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| format!("Failed to encode PNG: {}", e))?;

    Ok(BASE64.encode(&png_bytes))
}

#[tauri::command]
fn set_clipboard_html(html: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;

        unsafe {
            use windows_sys::Win32::Foundation::HANDLE;
            use windows_sys::Win32::System::DataExchange::RegisterClipboardFormatW;
            use windows_sys::Win32::System::Memory::{
                GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE
            };

            #[link(name = "user32")]
            extern "system" {
                fn OpenClipboard(hwnd: HANDLE) -> i32;
                fn CloseClipboard() -> i32;
                fn EmptyClipboard() -> i32;
                fn SetClipboardData(format: u32, mem: HANDLE) -> HANDLE;
            }

            if OpenClipboard(0) == 0 {
                return Err("Failed to open clipboard".to_string());
            }

            if EmptyClipboard() == 0 {
                CloseClipboard();
                return Err("Failed to empty clipboard".to_string());
            }

            let format_name: Vec<u16> = OsStr::new("HTML Format")
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();
            let cf_html = RegisterClipboardFormatW(format_name.as_ptr());

            if cf_html == 0 {
                CloseClipboard();
                return Err("Failed to register HTML format".to_string());
            }

            let header = "Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n";
            let html_prefix = "<!DOCTYPE html><html><body><!--StartFragment-->";
            let html_suffix = "<!--EndFragment--></body></html>";

            let full_html = format!("{}{}{}", html_prefix, html, html_suffix);
            let start_html = header.len();
            let end_html = start_html + full_html.len();
            let start_fragment = start_html + html_prefix.len();
            let end_fragment = start_fragment + html.len();

            let cf_html_string = format!(
                "Version:0.9\r\nStartHTML:{:010}\r\nEndHTML:{:010}\r\nStartFragment:{:010}\r\nEndFragment:{:010}\r\n{}",
                start_html, end_html, start_fragment, end_fragment, full_html
            );

            let bytes = cf_html_string.as_bytes();
            let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
            if h_mem.is_null() {
                CloseClipboard();
                return Err("Failed to allocate memory".to_string());
            }

            let p_mem = GlobalLock(h_mem);
            if p_mem.is_null() {
                CloseClipboard();
                return Err("Failed to lock memory".to_string());
            }

            ptr::copy_nonoverlapping(bytes.as_ptr(), p_mem as *mut u8, bytes.len());
            GlobalUnlock(h_mem);

            if SetClipboardData(cf_html, h_mem as isize) == 0 {
                CloseClipboard();
                return Err("Failed to set clipboard data".to_string());
            }

            CloseClipboard();
            Ok(())
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("HTML clipboard is only supported on Windows".to_string())
    }
}

#[tauri::command]
fn hide_capture_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn hide_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn show_popup_with_clipboard(app: tauri::AppHandle) -> Result<(), String> {
    let (x, y) = match mouse_position::mouse_position::Mouse::get_mouse_position() {
        mouse_position::mouse_position::Mouse::Position { x, y } => (x, y),
        mouse_position::mouse_position::Mouse::Error => return Err("Failed to get mouse position".to_string()),
    };

    let text = match Clipboard::new() {
        Ok(mut cb) => cb.get_text().unwrap_or_default(),
        Err(_) => String::new(),
    };

    if let Some(window) = app.get_webview_window("popup") {
        window.set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;

        let payload = ClipboardPayload { text, x, y };
        window.emit("clipboard-data", payload)
            .map_err(|e| e.to_string())?;

        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn show_window_with_settings(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        // Emit event to tell frontend to show settings
        window.emit("show-settings", ())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn trigger_capture(app: tauri::AppHandle) -> Result<(), String> {
    use screenshots::Screen;

    // Prevent multiple captures
    if CAPTURE_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        println!("Capture already in progress, skipping");
        return Ok(());
    }

    println!("trigger_capture called");

    // First capture the screenshot BEFORE showing the window
    let screens = match Screen::all() {
        Ok(s) => s,
        Err(e) => {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Failed to get screens: {:?}", e));
        }
    };

    if screens.is_empty() {
        CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
        return Err("No screens found".to_string());
    }

    let screen = &screens[0];
    let image = match screen.capture() {
        Ok(img) => img,
        Err(e) => {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Failed to capture screen: {:?}", e));
        }
    };

    let mut png_bytes: Vec<u8> = Vec::new();
    let rgba_image = image::RgbaImage::from_raw(
        image.width(),
        image.height(),
        image.to_vec()
    ).ok_or_else(|| {
        CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
        "Failed to create image buffer".to_string()
    })?;

    if let Err(e) = rgba_image.write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png) {
        CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
        return Err(format!("Failed to encode PNG: {}", e));
    };

    let base64_image = BASE64.encode(&png_bytes);
    println!("Screenshot captured: {} bytes, {}x{}", png_bytes.len(), image.width(), image.height());

    let screenshot = ScreenshotPayload {
        image: base64_image,
        width: image.width(),
        height: image.height(),
        x: screen.display_info.x,
        y: screen.display_info.y,
    };

    // Now show the window
    if let Some(window) = app.get_webview_window("capture") {
        println!("Showing capture window");
        if let Err(e) = window.show() {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Failed to show window: {}", e));
        }
        let _ = window.set_focus();

        // Send screenshot to window
        println!("Emitting screenshot-ready");
        if let Err(e) = window.emit("screenshot-ready", screenshot) {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Failed to emit screenshot: {}", e));
        }
        println!("Emit complete");
    }

    // Reset the flag after a delay
    let app_handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
        println!("Capture flag reset");
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, _event| {
                println!("Shortcut triggered: {:?}", shortcut);
                // Alt+Q
                if shortcut.matches(tauri_plugin_global_shortcut::Modifiers::ALT, tauri_plugin_global_shortcut::Code::KeyQ) {
                    let _ = show_popup_with_clipboard(app.clone());
                }
                // Alt+S
                if shortcut.matches(tauri_plugin_global_shortcut::Modifiers::ALT, tauri_plugin_global_shortcut::Code::KeyS) {
                    let _ = trigger_capture(app.clone());
                }
            })
            .build())
        .setup(|app| {
            // Register global shortcuts
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Code, Modifiers};

            let alt_q = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);
            let alt_s = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);

            if let Err(e) = app.global_shortcut().register(alt_q) {
                eprintln!("Failed to register Alt+Q: {}", e);
            }
            if let Err(e) = app.global_shortcut().register(alt_s) {
                eprintln!("Failed to register Alt+S: {}", e);
            }

            println!("AI Research Assistant started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_widget_position,
            set_widget_default_position,
            get_primary_monitor_frame,
            snap_widget_to_bounds,
            center_window,
            get_clipboard_text,
            set_clipboard_text,
            get_mouse_position,
            set_clipboard_html,
            capture_fullscreen,
            capture_region,
            hide_capture_window,
            hide_window,
            show_window,
            show_popup_with_clipboard,
            show_window_with_settings,
            quit_app,
            trigger_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
