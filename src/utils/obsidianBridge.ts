/**
 * Obsidian Bridge — File-system integration with Obsidian vaults.
 *
 * Obsidian is a local Markdown-based note system. We interact with it by:
 * - Writing .md files directly into the vault folder
 * - Generating YAML frontmatter and wikilinks
 * - Opening notes via the obsidian:// URI protocol
 */

import { invoke } from '@tauri-apps/api/core';
import { readDir, readTextFile } from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';

export type ObsidianTemplate = 'summary' | 'full' | 'qa';

export interface ObsidianNoteData {
  title: string;
  date: string;
  tags: string[];
  source: string;
  project?: string;
  content: string;
  summary?: string;
  keyPoints?: string[];
  hypotheses?: string[];
}

export interface ObsidianSaveResult {
  success: boolean;
  filePath: string;
  fileName: string;
  error?: string;
}

/** Common English stop words to exclude from auto-tags. */
const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'she', 'use', 'her', 'than', 'them', 'well', 'were', 'with', 'have', 'this', 'will', 'your', 'from', 'they', 'know', 'want', 'been', 'good', 'much', 'some', 'time', 'very', 'when', 'come', 'here', 'just', 'like', 'long', 'make', 'many', 'over', 'such', 'take', 'that', 'what', 'year', 'also', 'back', 'could', 'first', 'into', 'more', 'only', 'other', 'then', 'these', 'think', 'where', 'being', 'every', 'great', 'might', 'shall', 'still', 'those', 'while', 'should', 'through', 'between', 'before', 'after', 'above', 'below', 'under', 'again', 'further', 'then', 'once',
]);

/**
 * Extract candidate tags from text using simple heuristics.
 * Returns up to `maxTags` candidates.
 */
export function extractAutoTags(text: string, maxTags: number = 5): string[] {
  const scores = new Map<string, number>();

  // 1. Multi-word capitalized phrases (likely technical terms)
  const phraseMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/g) || [];
  for (const phrase of phraseMatches) {
    const key = phrase.toLowerCase().replace(/\s+/g, '-');
    scores.set(key, (scores.get(key) || 0) + 3);
  }

  // 2. CamelCase / PascalCase identifiers
  const camelMatches = text.match(/\b[A-Z][a-z]+[A-Z][a-zA-Z]+\b/g) || [];
  for (const word of camelMatches) {
    const key = word.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    scores.set(key, (scores.get(key) || 0) + 2);
  }

  // 3. Regular words (length 4-15, exclude stop words)
  const wordMatches = text.match(/\b[a-zA-Z]{4,15}\b/g) || [];
  for (const word of wordMatches) {
    const lower = word.toLowerCase();
    if (STOP_WORDS.has(lower)) continue;
    scores.set(lower, (scores.get(lower) || 0) + 1);
  }

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxTags)
    .map(([tag]) => tag);
}

/**
 * Check if a vault path looks valid (contains at least one .md file or .obsidian folder).
 */
export async function isValidVault(vaultPath: string): Promise<boolean> {
  try {
    const entries = await readDir(vaultPath);
    return entries.some(
      (e) => e.name === '.obsidian' || e.name.endsWith('.md')
    );
  } catch {
    return false;
  }
}

/**
 * Pick an Obsidian vault folder via dialog.
 */
export async function pickVaultFolder(): Promise<string | null> {
  const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
  const selected = await openDialog({ directory: true, multiple: false });
  if (Array.isArray(selected)) return selected[0] || null;
  return selected;
}

/**
 * Scan the vault for existing note titles (filenames without .md).
 */
export async function scanVaultNotes(vaultPath: string): Promise<string[]> {
  const titles: string[] = [];

  async function scan(dirPath: string) {
    try {
      const entries = await readDir(dirPath);
      for (const entry of entries) {
        const entryPath = `${dirPath}/${entry.name}`;
        if (entry.isDirectory && entry.name !== '.obsidian') {
          await scan(entryPath);
        } else if (entry.name.endsWith('.md')) {
          titles.push(entry.name.replace(/\.md$/, ''));
        }
      }
    } catch {
      // ignore inaccessible dirs
    }
  }

  await scan(vaultPath);
  return titles;
}

/**
 * Find existing note titles that appear in the given text.
 */
export function findWikilinks(text: string, existingNotes: string[]): string[] {
  const links: string[] = [];
  for (const note of existingNotes) {
    // Simple exact-match detection (case-insensitive)
    const regex = new RegExp(
      `(?<!\\[)\\b${note.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`,
      'i'
    );
    if (regex.test(text)) {
      links.push(note);
    }
  }
  return [...new Set(links)];
}

/**
 * Build YAML frontmatter block.
 */
function buildFrontmatter(data: ObsidianNoteData): string {
  const lines = [
    '---',
    `title: "${data.title.replace(/"/g, '\\"')}"`,
    `date: ${data.date}`,
    `tags: [${data.tags.map((t) => `"${t}"`).join(', ')}]`,
    `source: "${data.source}"`
  ];
  if (data.project) {
    lines.push(`project: "${data.project}"`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Build note body from template.
 */
function buildBody(data: ObsidianNoteData, template: ObsidianTemplate, wikilinks: string[]): string {
  const linkSection = wikilinks.length
    ? '\n## Related Notes\n\n' + wikilinks.map((l) => `- [[${l}]]`).join('\n') + '\n'
    : '';

  switch (template) {
    case 'summary':
      return [
        data.summary ? `## Summary\n\n${data.summary}\n` : '',
        data.keyPoints?.length ? `## Key Points\n\n${data.keyPoints.map((p) => `- ${p}`).join('\n')}\n` : '',
        data.hypotheses?.length ? `## Hypotheses to Verify\n\n${data.hypotheses.map((h) => `- ${h}`).join('\n')}\n` : '',
        '## Full Record\n\n<details>\n<summary>Click to expand full conversation</summary>\n\n',
        data.content,
        '\n</details>',
        linkSection
      ].filter(Boolean).join('\n');

    case 'qa':
      return [
        '## Q\&A Record\n\n',
        data.content,
        linkSection
      ].join('\n');

    case 'full':
    default:
      return [
        data.summary ? `## Summary\n\n${data.summary}\n` : '',
        '## Full Record\n\n',
        data.content,
        linkSection
      ].filter(Boolean).join('\n');
  }
}

/**
 * Build an incremental append block for an existing note.
 */
function buildAppendBlock(data: ObsidianNoteData, template: ObsidianTemplate, wikilinks: string[]): string {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const body = buildBody(data, template, wikilinks);

  return [
    '',
    '---',
    `*Appended at ${now}*`,
    '',
    body
  ].join('\n');
}

/**
 * Save a note to the Obsidian vault.
 * If the note already exists, content is appended incrementally instead of overwritten.
 */
export async function saveNoteToObsidian(
  vaultPath: string,
  folder: string,
  data: ObsidianNoteData,
  template: ObsidianTemplate = 'summary',
  existingNotes?: string[]
): Promise<ObsidianSaveResult> {
  try {
    const folderPath = `${vaultPath}/${folder}`;

    // Detect wikilinks
    const wikilinks = existingNotes
      ? findWikilinks(data.content + ' ' + (data.summary || ''), existingNotes)
      : [];

    // Auto-extract tags from content if only default tags provided
    let tags = data.tags;
    if (!tags || tags.length === 0 || (tags.length === 2 && tags.includes('ai-research') && tags.includes('auto-generated'))) {
      const autoTags = extractAutoTags(data.content + ' ' + (data.summary || ''), 5);
      tags = ['ai-research', ...autoTags];
    }

    const noteData: ObsidianNoteData = { ...data, tags };

    // Sanitize filename
    const safeTitle = data.title
      .replace(/[<>:"/\\|?*]/g, '_')
      .trim()
      .slice(0, 80);
    const fileName = `${data.date} ${safeTitle}.md`;
    const filePath = `${folderPath}/${fileName}`;

    // Check if note already exists
    const exists = await invoke<boolean>('check_file_exists', { path: filePath });

    if (exists) {
      // Incremental append: add a new block with timestamp separator
      const appendBlock = buildAppendBlock(noteData, template, wikilinks);
      await invoke('write_text_file', { path: filePath, contents: appendBlock, append: true });
    } else {
      // First save: write full markdown with frontmatter
      const frontmatter = buildFrontmatter(noteData);
      const body = buildBody(noteData, template, wikilinks);
      const markdown = `${frontmatter}\n\n${body}`;
      await invoke('write_text_file', { path: filePath, contents: markdown, append: false });
    }

    return { success: true, filePath, fileName };
  } catch (e: any) {
    console.error('[ObsidianBridge] Save failed:', e);
    return { success: false, filePath: '', fileName: '', error: e?.message || 'Save failed' };
  }
}

/**
 * Open a note in Obsidian via the URI protocol.
 */
export async function openNoteInObsidian(vaultPath: string, filePath: string): Promise<void> {
  // Extract vault name from vaultPath (last segment)
  const vaultName = vaultPath.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'vault';

  // Compute relative path inside vault
  const relativePath = filePath
    .replace(vaultPath.replace(/\\/g, '/'), '')
    .replace(/^\//, '')
    .replace(/\.md$/, '');

  const encodedVault = encodeURIComponent(vaultName);
  const encodedFile = encodeURIComponent(relativePath);
  const uri = `obsidian://open?vault=${encodedVault}&file=${encodedFile}`;

  try {
    await openUrl(uri);
  } catch (e) {
    console.warn('[ObsidianBridge] Failed to open URI:', e);
    // Fallback: try obsidian:// protocol directly via window.open for webview
    window.open(uri, '_blank');
  }
}

/**
 * Read a custom template file from the vault's template folder.
 */
export async function readCustomTemplate(
  vaultPath: string,
  templateName: string
): Promise<string | null> {
  const possiblePaths = [
    `${vaultPath}/Templates/${templateName}.md`,
    `${vaultPath}/templates/${templateName}.md`,
    `${vaultPath}/模板/${templateName}.md`
  ];

  for (const p of possiblePaths) {
    try {
      const text = await readTextFile(p);
      return text;
    } catch {
      // try next
    }
  }
  return null;
}
