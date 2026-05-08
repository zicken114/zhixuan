import { invoke } from '@tauri-apps/api/core';

/**
 * Get the currently selected text from the active window.
 *
 * The backend first tries UI Automation (non-destructive), then falls
 * back to a clipboard method (Ctrl+C) that preserves the original
 * clipboard content.
 */
export async function getSelectedText(): Promise<string> {
  return await invoke<string>('get_selected_text');
}

/**
 * Direct clipboard fallback for getting selected text.
 * Use this only if `getSelectedText` is not available.
 */
export async function getSelectedTextViaClipboard(): Promise<string> {
  return await invoke<string>('get_selected_text_via_clipboard');
}
