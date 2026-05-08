import { invoke } from '@tauri-apps/api/core';

export type ContentType = 'formula' | 'table' | 'theorem' | 'plain_text';

export interface ContentDetectionResult {
  content_types: ContentType[];
  confidence: number;
  details: string;
}

/**
 * Detect content types (formula, table, theorem) in a page of text.
 * Uses heuristic rules on the Rust backend.
 */
export async function detectPageContentTypes(pageText: string): Promise<ContentDetectionResult> {
  return invoke<ContentDetectionResult>('detect_page_content_types', { pageText });
}

/**
 * Quick check: does this page contain any extractable content
 * (formula, table, or theorem)?
 */
export async function hasExtractableContent(pageText: string): Promise<boolean> {
  return invoke<boolean>('has_extractable_content', { pageText });
}

/**
 * Get a human-readable label for a content type.
 */
export function getContentTypeLabel(type: ContentType): string {
  switch (type) {
    case 'formula':
      return 'Formula';
    case 'table':
      return 'Table';
    case 'theorem':
      return 'Theorem/Definition';
    case 'plain_text':
      return 'Plain Text';
    default:
      return 'Unknown';
  }
}

/**
 * Get an emoji icon for a content type.
 */
export function getContentTypeIcon(type: ContentType): string {
  switch (type) {
    case 'formula':
      return '∑';
    case 'table':
      return '⊞';
    case 'theorem':
      return '⊢';
    case 'plain_text':
      return '📄';
    default:
      return '❓';
  }
}
