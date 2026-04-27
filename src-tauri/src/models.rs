use serde::{Deserialize, Serialize};

/// Classification of detected applications.
#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AppType {
    Writing,
    CodeEditor,
    PdfReader,
    Zotero,
    Browser,
    Unknown,
}

/// Information about the currently active window.
#[derive(Clone, Serialize, Debug)]
pub struct WindowInfo {
    pub process_name: String,
    pub window_title: String,
    pub app_type: AppType,
    pub document_path: Option<String>,
}

/// Payload for clipboard content with mouse position.
#[derive(Clone, Serialize)]
pub struct ClipboardPayload {
    pub text: String,
    pub x: i32,
    pub y: i32,
}

/// Screenshot image data encoded as base64 PNG.
#[derive(Clone, Serialize)]
pub struct ScreenshotPayload {
    pub image: String,
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}

/// Geometry of a monitor / display.
#[derive(Clone, Serialize)]
pub struct MonitorFrame {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Docking state returned after snapping the widget to screen edges.
#[derive(Clone, Serialize)]
pub struct WidgetDockState {
    pub side: String,
    pub x: i32,
    pub y: i32,
}

/// A single activity event to be recorded in the database.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AppEvent {
    pub id: Option<i64>,
    pub event_type: String,
    pub timestamp: i64,
    pub project_id: Option<String>,
    pub duration_ms: Option<i64>,
    pub resource_id: Option<String>,
    pub metadata: Option<String>,
}
