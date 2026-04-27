use std::io::Cursor;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use image::{ImageFormat, RgbaImage};
use screenshots::Screen;
use tauri::{Emitter, Manager};

use crate::models::ScreenshotPayload;

/// Global flag to prevent concurrent capture sessions.
static CAPTURE_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Encode raw RGBA pixels into a base64 PNG string.
fn encode_png_base64(width: u32, height: u32, pixels: Vec<u8>) -> Result<String, String> {
    let rgba = RgbaImage::from_raw(width, height, pixels)
        .ok_or("Failed to create image buffer from raw pixels")?;

    let mut png_bytes: Vec<u8> = Vec::new();
    rgba
        .write_to(&mut Cursor::new(&mut png_bytes), ImageFormat::Png)
        .map_err(|e| format!("PNG encoding failed: {}", e))?;

    Ok(BASE64.encode(&png_bytes))
}

/// Capture the primary screen and return it as a base64 PNG payload.
#[tauri::command]
pub fn capture_fullscreen() -> Result<ScreenshotPayload, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to enumerate screens: {:?}", e))?;
    let screen = screens.first().ok_or("No screens detected")?;

    let image = screen.capture().map_err(|e| format!("Screen capture failed: {:?}", e))?;

    let base64_image = encode_png_base64(image.width(), image.height(), image.to_vec())?;

    Ok(ScreenshotPayload {
        image: base64_image,
        width: image.width(),
        height: image.height(),
        x: screen.display_info.x,
        y: screen.display_info.y,
    })
}

/// Capture a specific region and return it as a base64 PNG string.
#[tauri::command]
pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> Result<String, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to enumerate screens: {:?}", e))?;

    let screen = screens
        .iter()
        .find(|s| {
            let info = &s.display_info;
            x >= info.x && y >= info.y && x < info.x + info.width as i32 && y < info.y + info.height as i32
        })
        .ok_or("No screen contains the requested region")?;

    let image = screen
        .capture_area(x, y, width, height)
        .map_err(|e| format!("Region capture failed: {:?}", e))?;

    encode_png_base64(image.width(), image.height(), image.to_vec())
}

/// Trigger a fullscreen capture, hide the result window, reset state, and show the capture overlay.
#[tauri::command]
pub fn trigger_capture(app: tauri::AppHandle) -> Result<(), String> {
    if CAPTURE_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    // ── 1. capture first, before any UI changes ────────────────────────────
    let screens = match Screen::all() {
        Ok(s) => s,
        Err(e) => {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Failed to enumerate screens: {:?}", e));
        }
    };

    let screen = screens.first().ok_or_else(|| {
        CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
        "No screens detected".to_string()
    })?;

    let image = match screen.capture() {
        Ok(img) => img,
        Err(e) => {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Screen capture failed: {:?}", e));
        }
    };

    let base64_image = match encode_png_base64(image.width(), image.height(), image.to_vec()) {
        Ok(b64) => b64,
        Err(e) => {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(e);
        }
    };

    let screenshot = ScreenshotPayload {
        image: base64_image,
        width: image.width(),
        height: image.height(),
        x: screen.display_info.x,
        y: screen.display_info.y,
    };

    // ── 2. hide previous result window and reset state ─────────────────────
    if let Some(result_window) = app.get_webview_window("result") {
        let _ = result_window.hide();
    }
    let _ = app.emit("new-capture-started", ());

    // ── 3. show capture overlay ────────────────────────────────────────────
    if let Some(window) = app.get_webview_window("capture") {
        if let Err(e) = window.show() {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Failed to show capture window: {}", e));
        }
        let _ = window.set_focus();

        if let Err(e) = window.emit("screenshot-ready", screenshot) {
            CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
            return Err(format!("Failed to emit screenshot event: {}", e));
        }
    }

    // ── 4. reset guard after a cooldown ────────────────────────────────────
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(2));
        CAPTURE_IN_PROGRESS.store(false, Ordering::SeqCst);
    });

    Ok(())
}
