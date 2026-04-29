import { invoke } from '@tauri-apps/api/core';

/**
 * Replace the selected text in the active window.
 *
 * Internally this places `text` onto the clipboard and simulates
 * Ctrl+V, so it works in Word, browsers (Overleaf), VS Code, etc.
 */
export async function replaceSelectedText(text: string): Promise<void> {
  await invoke('replace_selected_text', { text });
}

/**
 * Simulate keyboard input character-by-character.
 *
 * This is a fallback for rare applications that don't honour
 * clipboard paste.  On Windows it uses SendInput; on other
 * platforms it is currently a no-op.
 */
export async function simulateTextInput(text: string): Promise<void> {
  await invoke('simulate_text_input', { text });
}
