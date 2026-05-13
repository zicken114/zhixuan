mod agent;
mod app_control;
mod clipboard;
mod content_type_detection;
mod event_collector;
mod events;
mod experiment;
mod mcp;
mod models;
mod pdf_detection;
mod plugin;
mod screenshot;
mod sentinel;
mod team;
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
    pub mcp_hub: Arc<mcp::McpHub>,
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
                // ── Reading companion hotkeys (Phase 3.2) ──
                // Only registered while a PDF reader is the active window.
                // Using Ctrl+Shift+1/2/3 to avoid conflicts with F1=Help, F2=Rename, F3=Search
                // that most PDF readers and browsers reserve.
                if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Digit1) {
                    let _ = app_control::show_popup_with_action(
                        app.clone(),
                        "reading_note".to_string(),
                    );
                }
                if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Digit2) {
                    let _ = app.emit("capture:preset", "formula");
                    let _ = screenshot::trigger_capture(app.clone());
                }
                if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::Digit3) {
                    let _ = app.emit("capture:preset", "table");
                    let _ = screenshot::trigger_capture(app.clone());
                }
                // ── Experiment snapshot hotkey (Phase 4.2) ──
                if shortcut.matches(Modifiers::ALT, Code::KeyE) {
                    let _ = app.emit("experiment:show-snapshot-panel", ());
                }
            })
            .build())
        .setup(|app| {
            use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Code, Modifiers};

            // ── Set window icons to Liu Kanshan ───────────────────────────
            let icon_bytes = include_bytes!("../icons/32x32.png");
            if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                for (label, _) in app.webview_windows() {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.set_icon(icon.clone());
                    }
                }
            }

            let alt_q = Shortcut::new(Some(Modifiers::ALT), Code::KeyQ);
            let alt_s = Shortcut::new(Some(Modifiers::ALT), Code::KeyS);
            let alt_e = Shortcut::new(Some(Modifiers::ALT), Code::KeyE);

            if let Err(e) = app.global_shortcut().register(alt_q) {
                eprintln!("Failed to register Alt+Q: {}", e);
            }
            if let Err(e) = app.global_shortcut().register(alt_s) {
                eprintln!("Failed to register Alt+S: {}", e);
            }
            if let Err(e) = app.global_shortcut().register(alt_e) {
                eprintln!("Failed to register Alt+E: {}", e);
            }

            // Note: F1/F2/F3 are NOT registered here. They are dynamically registered
            // when the user enters a PDF reader window (see polling loop below) and
            // unregistered when leaving, to avoid stealing F1=Help / F2 / F3 from
            // other applications.

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

            // ── MCP Hub (Phase 1) ──────────────────────────────────────────
            // Copy built-in MCP server scripts to app_data_dir/mcp_servers/
            let servers_dir = app_data_dir.join("mcp_servers");
            std::fs::create_dir_all(&servers_dir).ok();

            // Try to locate the source mcp_servers directory
            let mcp_src = if cfg!(debug_assertions) {
                // Dev mode: exe is at target/debug/ai-research-assistant.exe
                // Need to go up to project root: target/debug -> target -> project root
                std::env::current_exe()
                    .ok()
                    .and_then(|exe| {
                        // exe.parent() = target/debug/
                        // .parent() = target/
                        // .parent() = src-tauri/ (Cargo.toml dir)
                        let project_root = exe.parent()?.parent()?.parent()?;
                        let candidate = project_root.join("src").join("mcp_servers");
                        if candidate.exists() { Some(candidate) } else { None }
                    })
            } else {
                app.path().resource_dir().ok()
                    .map(|d| d.join("mcp_servers"))
            };

            if let Some(src_dir) = mcp_src {
                if let Ok(entries) = std::fs::read_dir(&src_dir) {
                    for entry in entries.flatten() {
                        let dest = servers_dir.join(entry.file_name());
                        if let Err(e) = std::fs::copy(entry.path(), &dest) {
                            eprintln!("[MCP] Failed to copy server file to {:?}: {}", dest, e);
                        } else {
                            println!("[MCP] Deployed server file: {:?}", dest);
                        }
                    }
                }
            } else {
                eprintln!("[MCP] Could not locate built-in MCP server scripts");
            }

            let mcp_hub = mcp::McpHub::new(&app_data_dir);
            // Start MCP servers asynchronously after setup completes
            let mcp_hub_for_spawn = mcp_hub.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = mcp_hub_for_spawn.start_all().await {
                    eprintln!("Failed to start MCP servers: {}", e);
                }
            });

            let app_state = AppState {
                window_detector: window_detector.clone(),
                current_window: current_window.clone(),
                event_collector: event_collector.clone(),
                text_selector: text_selector.clone(),
                mcp_hub: Arc::new(mcp_hub.clone()),
            };
            app.manage(app_state);
            app.manage(mcp_hub);

            let app_handle = app.handle().clone();
            let ec_for_window = event_collector.clone();
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, Code, Modifiers};

                let mut interval = tokio::time::interval(Duration::from_secs(3));
                let mut last_app_type: Option<AppType> = None;
                let mut pdf_open_time: Option<std::time::Instant> = None;

                let cs1 = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Digit1);
                let cs2 = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Digit2);
                let cs3 = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Digit3);

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
                            // Skip when the detected window is our own app — the user is interacting
                            // with the widget / popup / main window, and we should not overwrite
                            // the meaningful context (PDF, VS Code, Word, etc.).
                            let is_own_app = info.process_name.eq_ignore_ascii_case("ai-research-assistant.exe");

                            if !is_own_app {
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

                                    // ── Register reading-companion hotkeys (Phase 3.2) ──
                                    let gs = app_handle.global_shortcut();
                                    if let Err(e) = gs.register(cs1) {
                                        eprintln!("Failed to register Ctrl+Shift+1: {}", e);
                                    }
                                    if let Err(e) = gs.register(cs2) {
                                        eprintln!("Failed to register Ctrl+Shift+2: {}", e);
                                    }
                                    if let Err(e) = gs.register(cs3) {
                                        eprintln!("Failed to register Ctrl+Shift+3: {}", e);
                                    }

                                    // ── Notify frontend to start reading session (Phase 3.3) ──
                                    let _ = app_handle.emit("reading:session-start", serde_json::json!({
                                        "document_title": info.window_title,
                                        "document_path": info.document_path,
                                        "process_name": info.process_name,
                                    }));
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

                                    // ── Release reading-companion hotkeys ──
                                    let gs = app_handle.global_shortcut();
                                    let _ = gs.unregister(cs1);
                                    let _ = gs.unregister(cs2);
                                    let _ = gs.unregister(cs3);

                                    // ── Notify frontend to end reading session (Phase 3.3) ──
                                    let _ = app_handle.emit("reading:session-end", ());
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
                }
            });

            // Prevent review_wizard window from being destroyed by the native close button;
            // hide it instead so it can be reopened later.
            if let Some(window) = app.get_webview_window("review_wizard") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            // Same treatment for the result window. Without this, the user
            // closing it via the native X destroys its webview, so the next
            // extraction's show_result_window() / emit_to_result events find
            // no listener and the processing box never appears.
            if let Some(window) = app.get_webview_window("result") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            println!("AI Research Assistant started");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Agent (Phase 2)
            agent::agent_run,
            agent::agent_cancel,
            agent::agent_get_state,
            agent::agent_user_response,
            // MCP (Phase 1)
            mcp::mcp_list_tools,
            mcp::mcp_call_tool,
            mcp::mcp_toggle_tool,
            mcp::mcp_set_tool_permission,
            mcp::mcp_list_servers,
            mcp::mcp_start_server,
            mcp::mcp_stop_server,
            mcp::mcp_restart_server,
            mcp::mcp_get_servers_dir,
            // Event collection
            event_collector::record_event,
            event_collector::set_incognito_mode,
            event_collector::flush_events,
            // Window detection
            window_manager::get_active_window_info,
            // Clipboard
            clipboard::get_clipboard_text,
            clipboard::set_clipboard_text,
            clipboard::set_clipboard_image,
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
            window_manager::resize_window,
            window_manager::hide_window,
            window_manager::hide_capture_window,
            window_manager::show_result_window,
            window_manager::wait_for_result_window_ready,
            window_manager::result_window_ready,
            // Events
            events::emit_to_result,
            events::emit_extraction_complete,
            events::emit_extraction_error,
            events::notify_history_changed,
            // App control
            app_control::quit_app,
            app_control::show_popup_with_clipboard,
            app_control::show_popup_with_action,
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
            // Content type detection (Phase 3)
            content_type_detection::detect_page_content_types,
            content_type_detection::has_extractable_content,
            // Sentinel (Phase 4.1)
            sentinel::search_arxiv_command,
            sentinel::search_semantic_scholar_command,
            sentinel::infer_research_directions_command,
            // Experiment snapshots (Phase 4.2)
            experiment::save_experiment_snapshot,
            experiment::get_experiment_snapshots,
            experiment::search_experiment_snapshots,
            experiment::delete_experiment_snapshot,
            experiment::trigger_experiment_screenshot,
            // Plugin marketplace (Phase 5.2)
            plugin::get_plugin_registry,
            plugin::list_plugins,
            plugin::install_plugin,
            plugin::uninstall_plugin,
            plugin::toggle_plugin,
            plugin::get_plugin_settings,
            plugin::set_plugin_setting,
            plugin::get_plugin_menu_items,
            // Team space (Phase 5.3)
            team::create_team,
            team::update_team,
            team::delete_team,
            team::list_teams,
            team::get_team,
            team::add_team_member,
            team::remove_team_member,
            team::list_team_members,
            team::update_member_role,
            team::create_team_activity,
            team::list_team_activities,
            team::create_team_invite,
            team::get_team_invite_by_code,
            team::delete_team_invite,
            team::join_team_by_invite,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
