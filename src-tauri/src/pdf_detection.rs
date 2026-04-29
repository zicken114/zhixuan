use regex::Regex;

/* ───────────────────────────────────────────────
   PDF detection: extract page numbers from window
   titles and (in future) PDF file paths from process
   handles.
   ─────────────────────────────────────────────── */

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
/// **Current implementation:** placeholder — returns `None`.
/// Full implementation requires enumerating process file handles via
/// `NtQuerySystemInformation` which is complex and will be added in a
/// follow-up iteration.
#[tauri::command]
pub fn get_current_pdf_path() -> Result<Option<String>, String> {
    Ok(None)
}
