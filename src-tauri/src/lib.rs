mod app_control;
mod clipboard;
mod event_collector;
mod events;
mod models;
mod pdf_detection;
mod screenshot;
mod text_injection;
mod text_selection;
mod window_detector;
mod window_manager;

use std::sync::{Arc, RwLock};
use std::time::Duration;

use tauri::{Emitter, Manager};

use crate::event_collector::EventCollector;
use crate::models::{AppType, WindowInfo};
use crate::text_selection::TextSelector;
use crate::window_detector::WindowDetector;

/// Shared application state holding services and cached detection results.
pub struct AppState {
    pub window_detector: Arc<dyn WindowDetector>,
    pub current_window: Arc<RwLock<Option<WindowInfo>>>,
    pub event_collector: Arc<EventCollector>,
    pub text_selector: Arc<dyn TextSelector>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new()
            .with_handler(|app, shortcut, _event| {
                use tauri_plugin_global_shortcut::{Code, Modifiers};

                if shortcut.matches(Modifiers::ALT, Code::KeyQ) {
                    let _ = app_control::show_popup_with_clipboard(app.clone());
                }
                if shortcut.matches(Modifiers::ALT, Code::KeyS) {
                    let _ = screenshot::trigger_capture(app.clone());
                }
            })
            .build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Code, Modifiers};

            let alt_q = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);
            let alt_s = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);

            if let Err(e) = app.global_shortcut().register(alt_q) {
                eprintln!("Failed to register Alt+Q: {}", e);
            }
            if let Err(e) = app.global_shortcut().register(alt_s) {
                eprintln!("Failed to register Alt+S: {}", e);
            }

            // ── Event collector (Phase 0.2) ────────────────────────────────
            let app_data_dir = app.path().app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir());
            let db_path = app_data_dir.join("ai_research_assistant.db");

            let event_collector = Arc::new(EventCollector::new(db_path));
            event_collector.clone().start_flush_task();

            // Record app startup
            event_collector.record(
                "app_open",
                None,
                None,
                None,
                None,
            );

            // ── Text selection service (Phase 3 infrastructure) ────────────
            let text_selector = text_selection::create_text_selector();

            // ── Window activity detector (Phase 0.1) ───────────────────────
            let window_detector = window_detector::create_window_detector();
            let current_window = Arc::new(RwLock::new(None));

            let app_state = AppState {
                window_detector: window_detector.clone(),
                current_window: current_window.clone(),
                event_collector: event_collector.clone(),
                text_selector: text_selector.clone(),
            };
            app.manage(app_state);

            let app_handle = app.handle().clone();
            let ec_for_window = event_collector.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(3));
                let mut last_app_type: Option<AppType> = None;
                let mut pdf_open_time: Option<std::time::Instant> = None;

                loop {
                    interval.tick().await;

                    if let Some(info) = window_detector.detect_active_window() {
                        let changed = {
                            let current = current_window.read().unwrap();
                            current.as_ref().map_or(true, |c| {
                                c.process_name != info.process_name
                                    || c.window_title != info.window_title
                            })
                        };

                        if changed {
                            // Track PDF transitions
                            let entering_pdf = last_app_type != Some(AppType::PdfReader)
                                && info.app_type == AppType::PdfReader;
                            let leaving_pdf = last_app_type == Some(AppType::PdfReader)
                                && info.app_type != AppType::PdfReader;

                            if entering_pdf {
                                pdf_open_time = Some(std::time::Instant::now());
                                ec_for_window.record(
                                    "pdf_open",
                                    None,
                                    None,
                                    Some(info.window_title.clone()),
                                    Some(format!("{{\"process\":\"{}\"}}", info.process_name)),
                                );
                            }

                            if leaving_pdf {
                                let duration = pdf_open_time.map(|t| t.elapsed().as_millis() as i64);
                                ec_for_window.record(
                                    "pdf_close",
                                    None,
                                    duration,
                                    None,
                                    None,
                                );
                                pdf_open_time = None;
                            }

                            last_app_type = Some(info.app_type.clone());

                            *current_window.write().unwrap() = Some(info.clone());
                            let _ = app_handle.emit("window:activity-changed", &info);
                            println!(
                                "[WindowDetector] {} -> {} ({:?})",
                                info.process_name, info.window_title, info.app_type
                            );
                        }
                    }
                }
            });

            println!("AI Research Assistant started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Event collection
            event_collector::record_event,
            event_collector::set_incognito_mode,
            event_collector::flush_events,
            // Window detection
            window_manager::get_active_window_info,
            // Clipboard
            clipboard::get_clipboard_text,
            clipboard::set_clipboard_text,
            clipboard::set_clipboard_html,
            // Screenshot
            screenshot::capture_fullscreen,
            screenshot::capture_region,
            screenshot::trigger_capture,
            // Window management
            window_manager::set_widget_position,
            window_manager::set_widget_default_position,
            window_manager::get_primary_monitor_frame,
            window_manager::snap_widget_to_bounds,
            window_manager::center_window,
            window_manager::show_window,
            window_manager::hide_window,
            window_manager::hide_capture_window,
            window_manager::show_result_window,
            window_manager::wait_for_result_window_ready,
            window_manager::result_window_ready,
            // Events
            events::emit_to_result,
            events::emit_extraction_complete,
            events::emit_extraction_error,
            // App control
            app_control::quit_app,
            app_control::show_popup_with_clipboard,
            app_control::show_window_with_settings,
            app_control::write_text_file,
            app_control::check_file_exists,
            app_control::fetch_zotero,
            // Text selection (Phase 3)
            text_selection::get_selected_text,
            text_selection::get_selected_text_via_clipboard,
            // Text injection (Phase 3)
            text_injection::replace_selected_text,
            text_injection::simulate_text_input,
            // PDF detection (Phase 3)
            pdf_detection::get_current_pdf_path,
            pdf_detection::estimate_pdf_page,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
