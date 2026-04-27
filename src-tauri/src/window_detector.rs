use std::sync::Arc;

use crate::models::{AppType, WindowInfo};

/// Cross-platform trait for detecting the currently active window.
pub trait WindowDetector: Send + Sync {
    fn detect_active_window(&self) -> Option<WindowInfo>;
}

/// Create a platform-specific window detector.
pub fn create_window_detector() -> Arc<dyn WindowDetector> {
    #[cfg(target_os = "windows")]
    return Arc::new(WindowsWindowDetector::new());

    #[cfg(not(target_os = "windows"))]
    return Arc::new(DummyWindowDetector::new());
}

/* ───────────────────────────────────────────────
   Windows implementation (Win32 API)
   ─────────────────────────────────────────────── */

#[cfg(target_os = "windows")]
pub struct WindowsWindowDetector;

#[cfg(target_os = "windows")]
impl WindowsWindowDetector {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
impl WindowDetector for WindowsWindowDetector {
    fn detect_active_window(&self) -> Option<WindowInfo> {
        use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
        use windows_sys::Win32::System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
        };

        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == 0 {
                return None;
            }

            // Read window title
            let mut title_buf = [0u16; 512];
            let title_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
            let window_title = if title_len > 0 {
                String::from_utf16_lossy(&title_buf[..title_len as usize])
                    .trim()
                    .to_string()
            } else {
                String::new()
            };

            // Get process ID
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                return None;
            }

            // Open process and query executable path
            let process_handle: HANDLE =
                OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
            if process_handle == 0 {
                return None;
            }

            let mut path_buf = [0u16; MAX_PATH as usize];
            let mut path_len: u32 = MAX_PATH;
            let success = QueryFullProcessImageNameW(
                process_handle,
                0,
                path_buf.as_mut_ptr(),
                &mut path_len,
            );
            CloseHandle(process_handle);

            if success == 0 {
                return None;
            }

            let full_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
            let process_name = std::path::Path::new(&full_path)
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
                .to_lowercase();

            let app_type = classify_app(&process_name, &window_title);

            Some(WindowInfo {
                process_name,
                window_title,
                app_type,
                document_path: None, // Can be enhanced in later phases
            })
        }
    }
}

/* ───────────────────────────────────────────────
   Dummy fallback (non-Windows)
   ─────────────────────────────────────────────── */

#[cfg(not(target_os = "windows"))]
pub struct DummyWindowDetector;

#[cfg(not(target_os = "windows"))]
impl DummyWindowDetector {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(not(target_os = "windows"))]
impl WindowDetector for DummyWindowDetector {
    fn detect_active_window(&self) -> Option<WindowInfo> {
        None
    }
}

/* ───────────────────────────────────────────────
   App classification
   ─────────────────────────────────────────────── */

fn classify_app(process_name: &str, window_title: &str) -> AppType {
    let name = process_name.to_lowercase();
    let title = window_title.to_lowercase();

    match name.as_str() {
        "winword.exe" | "soffice.bin" | "soffice.exe" | "typora.exe" => AppType::Writing,
        "code.exe" | "code - insiders.exe" | "cursor.exe" | "windsurf.exe" => {
            AppType::CodeEditor
        }
        "sumatrapdf.exe"
        | "acrord32.exe"
        | "acrobat.exe"
        | "foxitreader.exe"
        | "pdfxedit.exe"
        | "okular.exe" => AppType::PdfReader,
        "zotero.exe" => AppType::Zotero,
        "chrome.exe" | "msedge.exe" | "firefox.exe" | "brave.exe" | "opera.exe"
        | "vivaldi.exe" | "arc.exe" => {
            if title.contains("overleaf") {
                AppType::Writing
            } else {
                AppType::Browser
            }
        }
        _ => AppType::Unknown,
    }
}
