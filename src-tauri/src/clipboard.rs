use arboard::Clipboard;

/// Read plain text from the system clipboard.
#[tauri::command]
pub fn get_clipboard_text() -> Result<String, String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Failed to access clipboard: {}", e))?;

    clipboard.get_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))
}

/// Write plain text to the system clipboard.
#[tauri::command]
pub fn set_clipboard_text(text: String) -> Result<(), String> {
    let mut clipboard = Clipboard::new()
        .map_err(|e| format!("Failed to access clipboard: {}", e))?;

    clipboard.set_text(text)
        .map_err(|e| format!("Failed to write clipboard: {}", e))
}

/// Write HTML content to the clipboard using Windows CF_HTML format.
/// This allows pasting rich text into Word and other applications.
/// On non-Windows platforms, returns an error.
#[tauri::command]
pub fn set_clipboard_html(html: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use std::ptr;
        use windows_sys::Win32::Foundation::HANDLE;
        use windows_sys::Win32::System::DataExchange::RegisterClipboardFormatW;
        use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

        unsafe {
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
