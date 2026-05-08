use std::thread;
use std::time::Duration;
use arboard::Clipboard;

/* ───────────────────────────────────────────────
   Text injection: write processed text back to
   the active application's cursor position.
   ─────────────────────────────────────────────── */

/// Replace the currently selected text by putting `text` onto the
/// clipboard and simulating Ctrl+V.  This works in most applications
/// including Word, Overleaf (browser), Typora, VS Code, etc.
#[tauri::command]
pub fn replace_selected_text(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Clipboard access failed: {}", e))?;

    // Place the processed text onto the clipboard.
    clipboard.set_text(&text)
        .map_err(|e| format!("Failed to write clipboard: {}", e))?;

    // Small delay so the OS actually updates the clipboard buffer.
    thread::sleep(Duration::from_millis(100));

    // Simulate Ctrl+V to paste.
    simulate_ctrl_v();

    Ok(())
}

/// Simulate keyboard input character-by-character.
/// This is a fallback for apps that don't honour clipboard paste
/// (rare) or when we want to avoid touching the clipboard at all.
#[tauri::command]
pub fn simulate_text_input(text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        for ch in text.chars() {
            simulate_char(ch);
            thread::sleep(Duration::from_millis(5));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = text;
        // Non-Windows: no-op for now.
    }

    Ok(())
}

/* ───────────────────────────────────────────────
   Windows keyboard simulation helpers
   ─────────────────────────────────────────────── */

#[cfg(target_os = "windows")]
fn simulate_ctrl_v() {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VK_CONTROL, VK_V,
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

        // Press V
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: VK_V as u16,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
            ..std::mem::zeroed()
        };

        // Release V
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki = KEYBDINPUT {
            wVk: VK_V as u16,
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
fn simulate_ctrl_v() {
    // No-op on non-Windows.
}

#[cfg(target_os = "windows")]
fn simulate_char(ch: char) {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_SHIFT,
    };

    unsafe {
        // For ASCII characters we can use the virtual-key code directly.
        // This is a simplified implementation; full Unicode support would
        // require SendInput with scan codes (KEYEVENTF_UNICODE).
        if ch.is_ascii() {
            let vk = ch.to_ascii_uppercase() as u16;
            let needs_shift = ch.is_ascii_uppercase()
                || (!ch.is_ascii_alphabetic() && ch.is_ascii_punctuation());

            let mut inputs: Vec<INPUT> = Vec::new();

            if needs_shift {
                let mut shift_down: INPUT = std::mem::zeroed();
                shift_down.r#type = INPUT_KEYBOARD;
                shift_down.Anonymous.ki = KEYBDINPUT {
                    wVk: VK_SHIFT as u16,
                    dwFlags: 0,
                    time: 0,
                    dwExtraInfo: 0,
                    ..std::mem::zeroed()
                };
                inputs.push(shift_down);
            }

            let mut key_down: INPUT = std::mem::zeroed();
            key_down.r#type = INPUT_KEYBOARD;
            key_down.Anonymous.ki = KEYBDINPUT {
                wVk: vk,
                dwFlags: 0,
                time: 0,
                dwExtraInfo: 0,
                ..std::mem::zeroed()
            };
            inputs.push(key_down);

            let mut key_up: INPUT = std::mem::zeroed();
            key_up.r#type = INPUT_KEYBOARD;
            key_up.Anonymous.ki = KEYBDINPUT {
                wVk: vk,
                dwFlags: KEYEVENTF_KEYUP,
                time: 0,
                dwExtraInfo: 0,
                ..std::mem::zeroed()
            };
            inputs.push(key_up);

            if needs_shift {
                let mut shift_up: INPUT = std::mem::zeroed();
                shift_up.r#type = INPUT_KEYBOARD;
                shift_up.Anonymous.ki = KEYBDINPUT {
                    wVk: VK_SHIFT as u16,
                    dwFlags: KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                    ..std::mem::zeroed()
                };
                inputs.push(shift_up);
            }

            SendInput(
                inputs.len() as u32,
                inputs.as_mut_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            );
        }
        // Non-ASCII characters are silently skipped in this MVP.
    }
}
