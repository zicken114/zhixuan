use regex::Regex;

/* ───────────────────────────────────────────────
   PDF detection: extract page numbers from window
   titles and PDF file paths from process handles.
   ─────────────────────────────────────────────── */

#[cfg(target_os = "windows")]
mod windows_pdf {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE, UNICODE_STRING};
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    use ntapi::ntpsapi::{NtQueryInformationProcess, ProcessCommandLineInformation};

    /// Get the command-line of a process via NtQueryInformationProcess.
    /// Works on Windows 8.1+.
    pub unsafe fn get_process_command_line(pid: u32) -> Option<String> {
        let h: HANDLE = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, 0, pid);
        if h == 0 {
            return None;
        }

        // First query to get the required size
        let h_ptr: *mut ntapi::winapi::ctypes::c_void = h as _;

        let mut return_len: u32 = 0;
        let mut status = NtQueryInformationProcess(
            h_ptr,
            ProcessCommandLineInformation,
            std::ptr::null_mut(),
            0,
            &mut return_len,
        );

        // STATUS_INFO_LENGTH_MISMATCH (0xC0000004 = -1073741820i32) is expected on first call
        const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC0000004u32 as i32;
        if status != STATUS_INFO_LENGTH_MISMATCH {
            CloseHandle(h);
            return None;
        }

        let mut buf = vec![0u8; return_len as usize];
        status = NtQueryInformationProcess(
            h_ptr,
            ProcessCommandLineInformation,
            buf.as_mut_ptr() as _,
            buf.len() as u32,
            &mut return_len,
        );
        CloseHandle(h);

        if status < 0 {
            return None;
        }

        // The buffer contains a UNICODE_STRING
        if buf.len() < std::mem::size_of::<UNICODE_STRING>() {
            return None;
        }

        let us = &*(buf.as_ptr() as *const UNICODE_STRING);
        if us.Buffer.is_null() || us.Length == 0 {
            return None;
        }

        let slice = std::slice::from_raw_parts(us.Buffer, us.Length as usize / 2);
        let os = OsString::from_wide(slice);
        os.into_string().ok()
    }

    /// Extract the PDF file path from a PDF reader's command line.
    pub fn extract_pdf_path_from_cmdline(cmdline: &str) -> Option<String> {
        // PDF readers typically launch with the PDF file as an argument.
        // E.g. "C:\Program Files\SumatraPDF\SumatraPDF.exe" "D:\papers\abc.pdf"
        // We look for the first argument that ends with .pdf
        // Remove the executable path (first quoted or unquoted token)
        let trimmed = cmdline.trim();
        let without_exe = if trimmed.starts_with('"') {
            // Find closing quote
            if let Some(end) = trimmed[1..].find('"') {
                trimmed[end + 2..].trim_start()
            } else {
                trimmed
            }
        } else if let Some(space_idx) = trimmed.find(' ') {
            trimmed[space_idx..].trim_start()
        } else {
            ""
        };

        // Parse remaining arguments looking for .pdf
        let args = split_args(without_exe);
        for arg in args {
            let clean = arg.trim().trim_matches('"');
            if clean.to_lowercase().ends_with(".pdf") {
                // Validate it exists
                if std::path::Path::new(clean).exists() {
                    return Some(clean.to_string());
                }
            }
        }

        None
    }

    fn split_args(s: &str) -> Vec<&str> {
        let mut args = Vec::new();
        let mut in_quotes = false;
        let mut start = 0;
        let chars: Vec<char> = s.chars().collect();

        for (i, c) in chars.iter().enumerate() {
            match c {
                '"' => in_quotes = !in_quotes,
                ' ' if !in_quotes => {
                    if i > start {
                        args.push(&s[start..i]);
                    }
                    start = i + 1;
                }
                _ => {}
            }
        }

        if start < s.len() {
            args.push(&s[start..]);
        }

        args
    }

    pub fn get_foreground_process_id() -> Option<u32> {
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd == 0 {
                return None;
            }
            let mut pid: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut pid);
            if pid == 0 {
                None
            } else {
                Some(pid)
            }
        }
    }
}

/// Extract a page number from common PDF reader window title patterns.
///
/// Supported patterns:
/// - "Page 5 of 20"
/// - "5 / 20"
/// - "5 of 20"
/// - "(5 / 20)"
pub fn extract_page_from_title(title: &str) -> Option<u32> {
    let patterns = [
        r"[Pp]age\s+(\d+)\s+of\s+\d+",
        r"\((\d+)\s*/\s*\d+\)",
        r"(\d+)\s*/\s*\d+",
        r"(\d+)\s+of\s+\d+",
    ];

    for pattern in &patterns {
        if let Ok(re) = Regex::new(pattern) {
            if let Some(caps) = re.captures(title) {
                if let Some(matched) = caps.get(1) {
                    if let Ok(page) = matched.as_str().parse::<u32>() {
                        return Some(page);
                    }
                }
            }
        }
    }

    None
}

/// Tauri command: estimate the current PDF page from the window title.
#[tauri::command]
pub fn estimate_pdf_page(window_title: String) -> Result<Option<u32>, String> {
    Ok(extract_page_from_title(&window_title))
}

/// Tauri command: get the file path of the PDF currently open in the
/// active PDF reader.
///
/// On Windows, uses `NtQueryInformationProcess` with `ProcessCommandLineInformation`
/// to read the PDF reader's command line and extract the PDF file argument.
/// On other platforms, returns `None`.
#[tauri::command]
pub fn get_current_pdf_path() -> Result<Option<String>, String> {
    #[cfg(target_os = "windows")]
    {
        let pid = windows_pdf::get_foreground_process_id()
            .ok_or_else(|| "Failed to get foreground process ID".to_string())?;

        let cmdline = unsafe { windows_pdf::get_process_command_line(pid) }
            .ok_or_else(|| "Failed to read process command line".to_string())?;

        Ok(windows_pdf::extract_pdf_path_from_cmdline(&cmdline))
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(None)
    }
}
