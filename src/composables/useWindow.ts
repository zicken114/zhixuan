import { invoke } from '@tauri-apps/api/core';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

/**
 * Encapsulates window management operations via Tauri invoke.
 * Provides type-safe helpers for showing/hiding/moving windows.
 */
export function useWindow() {
  const currentWindow = getCurrentWebviewWindow();

  /** Show a window by its label. */
  const show = (label: string) => invoke('show_window', { label });

  /** Resize a window by its label. */
  const resize = (label: string, width: number, height: number) => invoke('resize_window', { label, width, height });

  /** Hide a window by its label. */
  const hide = (label: string) => invoke('hide_window', { label });

  /** Hide the capture overlay window. */
  const hideCapture = () => invoke('hide_capture_window');

  /** Center a window on the primary monitor. */
  const center = (label: string) => invoke('center_window', { label });

  /** Show the result window and focus it. */
  const showResult = () => invoke('show_result_window');

  /** Wait for the result window to signal it is ready (3s timeout). */
  const waitForResultReady = () => invoke('wait_for_result_window_ready');

  /** Signal from the result window that it has mounted and listeners are ready. */
  const signalResultReady = () => invoke('result_window_ready');

  /** Hide the current window. */
  const hideCurrent = () => currentWindow.hide();

  /** Start dragging the current window (for custom title bars). */
  const startDragging = () => currentWindow.startDragging();

  /** Quit the entire application. */
  const quitApp = () => invoke('quit_app');

  /** Show the popup menu at the current mouse position. */
  const showPopup = () => invoke('show_popup_with_clipboard');

  /** Show the sentinel brief window. */
  const showSentinelBrief = () => show('sentinel_brief');

  /** Show the main window and open settings inside it. */
  const showSettings = async () => {
    await invoke('show_window_with_settings');
  };

  /** Set the widget to its default position on screen. */
  const setWidgetDefaultPosition = () => invoke('set_widget_default_position');

  /** Snap the widget to the nearest screen edge. */
  const snapWidget = () => invoke('snap_widget_to_bounds');

  return {
    show,
    resize,
    hide,
    hideCapture,
    center,
    showResult,
    waitForResultReady,
    signalResultReady,
    hideCurrent,
    startDragging,
    quitApp,
    showPopup,
    showSentinelBrief,
    showSettings,
    setWidgetDefaultPosition,
    snapWidget,
  };
}
