import { invoke } from '@tauri-apps/api/core';

/**
 * Get the file path of the PDF currently open in the active
 * PDF reader, if available.
 *
 * **Current implementation:** always returns `null`.  Full
 * path extraction via process handle enumeration is planned.
 */
export async function getCurrentPdfPath(): Promise<string | null> {
  return await invoke('get_current_pdf_path');
}

/**
 * Estimate the current page number from a PDF reader window title.
 *
 * Supports patterns like:
 * - "Page 5 of 20"
 * - "5 / 20"
 * - "(5 / 20)"
 */
export async function estimatePdfPage(windowTitle: string): Promise<number | null> {
  return await invoke('estimate_pdf_page', { windowTitle });
}
