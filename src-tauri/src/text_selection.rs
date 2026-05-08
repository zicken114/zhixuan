use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// Trait for cross-platform text selection.
pub trait TextSelector: Send + Sync {
    /// Try to get the selected text from the active window.
    /// Returns None if no text is selected or the method is unavailable.
    fn get_selected_text(&self) -> Option<String>;
}

/// Create a platform-specific text selector.
pub fn create_text_selector() -> Arc<dyn TextSelector> {
    #[cfg(target_os = "windows")]
    return Arc::new(WindowsTextSelector::new());

    #[cfg(not(target_os = "windows"))]
    return Arc::new(DummyTextSelector::new());
}

/* ───────────────────────────────────────────────
   Windows implementation (UI Automation)
   ─────────────────────────────────────────────── */

#[cfg(target_os = "windows")]
pub struct WindowsTextSelector;

#[cfg(target_os = "windows")]
impl WindowsTextSelector {
    pub fn new() -> Self {
        Self
    }

    /// Try to get selected text via UI Automation.
    ///
    /// **TODO:** The uiautomation crate API in v0.12 doesn't expose the
    /// expected patterns directly.  A deeper integration is planned; for
    /// now this returns `None` so the clipboard fallback is always used.
    fn get_via_uiautomation(&self) -> Option<String> {
        None
    }
}

#[cfg(target_os = "windows")]
impl TextSelector for WindowsTextSelector {
    fn get_selected_text(&self) -> Option<String> {
        self.get_via_uiautomation()
    }
}

/* ───────────────────────────────────────────────
   Dummy fallback (non-Windows)
   ─────────────────────────────────────────────── */

#[cfg(not(target_os = "windows"))]
pub struct DummyTextSelector;

#[cfg(not(target_os = "windows"))]
impl DummyTextSelector {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(not(target_os = "windows"))]
impl TextSelector for DummyTextSelector {
    fn get_selected_text(&self) -> Option<String> {
        None
    }
}

/* ───────────────────────────────────────────────
   Clipboard fallback (Tauri command)
   ─────────────────────────────────────────────── */

use arboard::Clipboard;

/// Backup the current clipboard, simulate Ctrl+C, read the new content,
/// then restore the original clipboard.  This is a robust fallback when
/// UI Automation cannot access the target application.
#[tauri::command]
pub fn get_selected_text_via_clipboard() -> Result<String, String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Clipboard access failed: {}", e))?;

    // Remember what was on the clipboard before we stomp on it.
    let backup = clipboard.get_text().unwrap_or_default();

    // Simulate Ctrl+C via SendInput (Windows) or a best-effort fallback.
    simulate_ctrl_c();

    // Give the target application a moment to copy its selection.
    thread::sleep(Duration::from_millis(250));

    // Read what the target application just copied.
    let selected = clipboard.get_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))?;

    // Restore the user's original clipboard content.
    let _ = clipboard.set_text(backup);

    Ok(selected)
}

/// Primary Tauri command: tries UI Automation first, then falls back to
/// the clipboard method.
#[tauri::command]
pub fn get_selected_text(state: tauri::State<'_, crate::AppState>) -> Result<String, String> {
    // 1. Try UI Automation (non-destructive, preserves clipboard).
    if let Some(text) = state.text_selector.get_selected_text() {
        if !text.is_empty() {
            return Ok(text);
        }
    }

    // 2. Fallback: clipboard method.
    get_selected_text_via_clipboard()
}

/* ───────────────────────────────────────────────
   Platform-specific Ctrl+C simulation
   ─────────────────────────────────────────────── */

#[cfg(target_os = "windows")]
fn simulate_ctrl_c() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VK_CONTROL, VK_C,
    };

    unsafe {
        let mut inputs: [INPUT; 4] = std::mem::zeroed();

        // Press Ctrl
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL as u16,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
            ..std::mem::zeroed()
        };

        // Press C
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: VK_C as u16,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
            ..std::mem::zeroed()
        };

        // Release C
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki = KEYBDINPUT {
            wVk: VK_C as u16,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
            ..std::mem::zeroed()
        };

        // Release Ctrl
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL as u16,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
            ..std::mem::zeroed()
        };

        SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );
    }
}

#[cfg(not(target_os = "windows"))]
fn simulate_ctrl_c() {
    // Non-Windows: no-op.  The caller will receive an empty string.
}
