import { invoke } from '@tauri-apps/api/core';

/**
 * Encapsulates all clipboard interactions with the Rust backend.
 * Provides a clean API for text and rich-HTML clipboard operations.
 */
export function useClipboard() {
  /**
   * Read plain text from the system clipboard.
   */
  const readText = async (): Promise<string> => {
    try {
      return await invoke<string>('get_clipboard_text');
    } catch (e) {
      console.error('[useClipboard] Failed to read text:', e);
      return '';
    }
  };

  /**
   * Write plain text to the system clipboard.
   */
  const writeText = async (text: string): Promise<void> => {
    try {
      await invoke('set_clipboard_text', { text });
    } catch (e) {
      console.error('[useClipboard] Failed to write text:', e);
    }
  };

  /**
   * Write HTML content to the clipboard (Windows CF_HTML format).
   * Falls back to plain text if the platform does not support HTML clipboard.
   */
  const writeHtml = async (html: string, fallbackText?: string): Promise<void> => {
    try {
      await invoke('set_clipboard_html', { html });
    } catch (e) {
      console.warn('[useClipboard] HTML clipboard failed, falling back to plain text:', e);
      await writeText(fallbackText ?? html);
    }
  };

  /**
   * Write content intelligently:
   * - If markdown is detected and the platform supports it, write as HTML.
   * - Otherwise write as plain text.
   */
  const writeSmart = async (content: string, isMarkdown = false): Promise<void> => {
    if (isMarkdown) {
      // Import marked lazily to avoid circular deps
      const { marked } = await import('marked');
      const html = await marked(content);
      await writeHtml(html, content);
    } else {
      await writeText(content);
    }
  };

  return {
    readText,
    writeText,
    writeHtml,
    writeSmart,
  };
}
