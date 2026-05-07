<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { aiClient } from '../utils/aiClient';
import { marked } from 'marked';
import { useSettingsStore, supportedLanguages } from '../stores/settings';
import { useProjectStore } from '../stores/projects';
import { useProgress } from '../composables/useProgress';
import { useClipboard } from '../composables/useClipboard';
import { useWindow } from '../composables/useWindow';
import { replaceSelectedText } from '../composables/useTextInjection';
import { recordEvent } from '../composables/useEvents';
import { searchZoteroCache, formatCitation } from '../utils/zoteroBridge';
import { saveNoteToObsidian } from '../utils/obsidianBridge';
import type { ZoteroItem } from '../composables/useDatabase';

const settingsStore = useSettingsStore();
const projectStore = useProjectStore();
const { progress, label: progressLabel, start: startProgress, complete: completeProgress, stop: stopProgress } = useProgress();
const { writeText, writeHtml } = useClipboard();
const { hideCurrent, showSettings: openSettingsWindow, quitApp, resize: resizeWindow } = useWindow();

const clipboardText = ref('');
const isProcessing = ref(false);
const currentAppType = ref<string>('unknown');

// Citation recommendation state
const showCitations = ref(false);
const citationResults = ref<ZoteroItem[]>([]);
const citationLoading = ref(false);
const citationReasons = ref<Map<string, string>>(new Map());
const citationReasonsLoading = ref<Set<string>>(new Set());
const selectedCitations = ref<Set<string>>(new Set());

// Use project-preferred citation style, falling back to GB7714
const preferredCitationStyle = computed(() => projectStore.currentProject()?.citationStyle || 'gb7714');

// Polish / writing companion state
const showPolish = ref(false);
const polishOriginal = ref('');
const polishResult = ref('');
const polishLoading = ref(false);
const polishDiff = ref<Array<{ type: 'same' | 'add' | 'del'; text: string }>>([]);

// Reading companion state
const showReadingNote = ref(false);
const readingNoteResult = ref('');
const readingNoteLoading = ref(false);
const currentWindowTitle = ref('');

interface ClipboardPayload {
  text: string;
  x: number;
  y: number;
}

interface WindowInfoPayload {
  process_name: string;
  window_title: string;
  app_type: string;
}

const baseMenuItems = [
  { icon: '🌍', label: 'Translate', action: 'translate' },
  { icon: '🧹', label: 'Clean to Word', action: 'clean' },
  { icon: '📚', label: 'Format Citation', action: 'citation' },
];

// Citation format correction state
const showCitationFix = ref(false);
const citationFixResult = ref('');
const citationFixLoading = ref(false);
const citationFixError = ref('');

const menuItems = computed(() => {
  const items = [...baseMenuItems];
  // Show writing companion actions when in writing apps
  if (currentAppType.value === 'writing') {
    items.splice(2, 0, { icon: '✨', label: 'Polish', action: 'polish' });
    items.splice(3, 0, { icon: '📖', label: 'Recommend Citation', action: 'recommend_citation' });
    items.splice(4, 0, { icon: '🔧', label: 'Fix Citation Format', action: 'fix_citation' });
  }
  // Show reading companion actions when in PDF readers
  if (currentAppType.value === 'pdf_reader') {
    items.splice(2, 0, { icon: '📄', label: 'Generate Note', action: 'reading_note' });
  }
  // Show save to Obsidian when clipboard has text and vault is configured
  if (clipboardText.value.trim() && settingsStore.config.externalTools.obsidianVaultPath) {
    items.push({ icon: '📝', label: 'Save to Obsidian', action: 'save_to_obsidian' });
  }
  items.push(
    { icon: '⚙️', label: 'Settings', action: 'settings' },
    { icon: '⏻', label: 'Exit', action: 'exit' }
  );
  return items;
});

let blurTimeout: number | null = null;
let unlistenClipboard: (() => void) | null = null;
let unlistenWindowActivity: (() => void) | null = null;
let unlistenAutoAction: (() => void) | null = null;

const handleBlur = () => {
  // Don't auto-cancel when losing focus - let the AI request complete
  // The popup will be hidden but the request continues in background
  // Only auto-close if not processing
  blurTimeout = window.setTimeout(async () => {
    if (!isProcessing.value) {
      await closeWindow();
    }
  }, 2000); // Wait 2 seconds before closing if not processing
};

const handleFocus = () => {
  // Cancel the blur timer if window regains focus
  if (blurTimeout) {
    clearTimeout(blurTimeout);
    blurTimeout = null;
  }
};

onMounted(async () => {
  // Listen for clipboard data from Rust
  unlistenClipboard = await listen<ClipboardPayload>('clipboard-data', (event) => {
    clipboardText.value = event.payload.text;
  });

  // Listen for window activity changes to adapt menu
  unlistenWindowActivity = await listen<WindowInfoPayload>('window:activity-changed', (event) => {
    currentAppType.value = event.payload.app_type;
    currentWindowTitle.value = event.payload.window_title;
  });

  // Listen for auto-action dispatch from reading-companion hotkeys (F1, etc.)
  unlistenAutoAction = await listen<string>('popup:auto-action', (event) => {
    const action = event.payload;
    // Give the popup a tick to mount/show, then fire the action
    window.setTimeout(() => {
      handleAction(action);
    }, 60);
  });

  // Add blur/focus listeners for auto-hide
  window.addEventListener('blur', handleBlur);
  window.addEventListener('focus', handleFocus);
});

onUnmounted(() => {
  if (unlistenClipboard) {
    unlistenClipboard();
  }
  if (unlistenWindowActivity) {
    unlistenWindowActivity();
  }
  if (unlistenAutoAction) {
    unlistenAutoAction();
  }
  window.removeEventListener('blur', handleBlur);
  window.removeEventListener('focus', handleFocus);
  if (blurTimeout) {
    clearTimeout(blurTimeout);
  }
});

const handleAction = async (action: string) => {
  if (action === 'settings') {
    await openSettingsWindow();
    await hideCurrent();
    return;
  }

  if (action === 'exit') {
    await quitApp();
    return;
  }

  if (isProcessing.value) return;

  if (!clipboardText.value.trim()) {
    await openSettingsWindow();
    await hideCurrent();
    return;
  }

  isProcessing.value = true;
  startProgress();

  const startTime = performance.now();
  let eventType = '';

  try {
    switch (action) {
      case 'translate':
        eventType = 'clipboard_translate';
        await handleTranslate();
        break;
      case 'clean':
        eventType = 'clipboard_purify';
        await handleCleanToWord();
        break;
      case 'citation':
        eventType = 'clipboard_format';
        await handleFormatCitation();
        break;
      case 'polish':
        eventType = 'clipboard_polish';
        await handlePolish();
        return; // Don't hide window - results shown inline
      case 'recommend_citation':
        eventType = 'citation_recommend';
        await handleRecommendCitation();
        return; // Don't hide window - results shown inline
      case 'fix_citation':
        eventType = 'citation_format_fix';
        await handleFixCitation();
        return; // Don't hide window - results shown inline
      case 'reading_note':
        eventType = 'reading_note_generate';
        await handleReadingNote();
        return; // Don't hide window - results shown inline
      case 'save_to_obsidian':
        eventType = 'clipboard_save_to_obsidian';
        await handleSaveToObsidian();
        break;
    }

    if (eventType) {
      recordEvent({
        event_type: eventType,
        duration_ms: Math.round(performance.now() - startTime),
        metadata: { content_length: clipboardText.value.length }
      });
    }
  } catch (error: any) {
    if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
      return;
    }
    console.error('[Popup] Action failed with error:', error);
    stopProgress();
    progress.value = 0;
    progressLabel.value = `错误: ${error?.message || '操作失败'}`;
    await new Promise(resolve => setTimeout(resolve, 2000));
    await hideCurrent();
    return;
  } finally {
    stopProgress();
    isProcessing.value = false;
  }
  await hideCurrent();
};

const handleTranslate = async () => {
  const { sourceLang, targetLang } = settingsStore.config.translateConfig;
  const sourceLabel = supportedLanguages.find(l => l.code === sourceLang)?.label || sourceLang;
  const targetLabel = supportedLanguages.find(l => l.code === targetLang)?.label || targetLang;

  const systemPrompt = sourceLang === 'auto'
    ? `You are a professional translator. Translate the given text to ${targetLabel}. Only output the translation, no explanations.`
    : `You are a professional translator. Translate the given text from ${sourceLabel} to ${targetLabel}. Only output the translation, no explanations.`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: clipboardText.value }
  ];

  const { text } = await aiClient.chatOnce(messages, false, 'translation');

  await writeText(text);
  await completeProgress();
};

const handleCleanToWord = async () => {
  const hasMarkdown = /[#*`\[\]]/g.test(clipboardText.value);

  if (hasMarkdown) {
    const html = await marked(clipboardText.value);
    await writeHtml(html, clipboardText.value);
    await completeProgress();
  } else {
    const messages = [
      {
        role: 'system' as const,
        content: 'Clean up the given text by removing extra whitespace, fixing formatting issues, and making it suitable for pasting into Word. Return the cleaned text only.'
      },
      { role: 'user' as const, content: clipboardText.value }
    ];

    const { text } = await aiClient.chatOnce(messages, false, 'text_cleanup');
    await writeText(text);
    await completeProgress();
  }
};

const handleFormatCitation = async () => {
  const messages = [
    {
      role: 'system' as const,
      content: 'Convert the given citation or reference into proper BibTeX format. Only output the BibTeX entry, no explanations.'
    },
    { role: 'user' as const, content: clipboardText.value }
  ];

  const { text } = await aiClient.chatOnce(messages, false, 'citation_format');
  await writeText(text);
  await completeProgress();
};

const handlePolish = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = 'Please select some text first';
    return;
  }

  polishLoading.value = true;
  showPolish.value = true;
  polishOriginal.value = clipboardText.value;
  polishResult.value = '';
  polishDiff.value = [];
  startProgress();
  // Expand popup to accommodate the diff panel
  resizeWindow('popup', 520, 420).catch(() => {});

  const startTime = performance.now();

  try {
    const messages = [
      {
        role: 'system' as const,
        content: 'You are an academic writing assistant. Polish the given text to improve clarity, conciseness, and academic tone. Preserve the original meaning. Only output the polished text, no explanations or markdown formatting.'
      },
      { role: 'user' as const, content: clipboardText.value }
    ];

    const { text } = await aiClient.chatOnce(messages, false, 'polish');
    polishResult.value = text.trim();
    polishDiff.value = computeDiff(polishOriginal.value, polishResult.value);
    completeProgress();

    recordEvent({
      event_type: 'writing_polish',
      duration_ms: Math.round(performance.now() - startTime),
      metadata: { content_length: clipboardText.value.length, result_length: text.length }
    });
  } catch (e: any) {
    console.error('[Polish] Failed:', e);
    progressLabel.value = 'Polish failed: ' + (e?.message || 'Unknown error');
  } finally {
    polishLoading.value = false;
    stopProgress();
  }
};

/** Simple word-level diff for displaying polish results. */
const computeDiff = (original: string, polished: string): Array<{ type: 'same' | 'add' | 'del'; text: string }> => {
  const origWords = original.split(/(\s+)/);
  const polishedWords = polished.split(/(\s+)/);
  const diff: Array<{ type: 'same' | 'add' | 'del'; text: string }> = [];

  let i = 0, j = 0;
  while (i < origWords.length || j < polishedWords.length) {
    if (i >= origWords.length) {
      diff.push({ type: 'add', text: polishedWords[j] });
      j++;
    } else if (j >= polishedWords.length) {
      diff.push({ type: 'del', text: origWords[i] });
      i++;
    } else if (origWords[i] === polishedWords[j]) {
      diff.push({ type: 'same', text: origWords[i] });
      i++;
      j++;
    } else {
      // Simple heuristic: if next original word matches current polished, this is an addition
      if (j + 1 < polishedWords.length && origWords[i] === polishedWords[j + 1]) {
        diff.push({ type: 'add', text: polishedWords[j] });
        j++;
      } else if (i + 1 < origWords.length && origWords[i + 1] === polishedWords[j]) {
        diff.push({ type: 'del', text: origWords[i] });
        i++;
      } else {
        // Treat as replacement: delete old, add new
        diff.push({ type: 'del', text: origWords[i] });
        diff.push({ type: 'add', text: polishedWords[j] });
        i++;
        j++;
      }
    }
  }

  // Merge consecutive same-type segments for cleaner display
  const merged: Array<{ type: 'same' | 'add' | 'del'; text: string }> = [];
  for (const segment of diff) {
    const last = merged[merged.length - 1];
    if (last && last.type === segment.type) {
      last.text += segment.text;
    } else {
      merged.push({ ...segment });
    }
  }

  return merged;
};

const closePolish = async () => {
  showPolish.value = false;
  polishOriginal.value = '';
  polishResult.value = '';
  polishDiff.value = [];
  // Restore popup to default size
  await resizeWindow('popup', 200, 280).catch(() => {});
};

const acceptPolish = async () => {
  if (!polishResult.value) return;
  try {
    await replaceSelectedText(polishResult.value);
  } catch (e) {
    console.warn('[Polish] Failed to inject text:', e);
    // Fallback: copy to clipboard
    await writeText(polishResult.value);
  }
  await closePolish();
  await hideCurrent();
};

const handleReadingNote = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = 'Please select some text from the PDF first';
    return;
  }

  readingNoteLoading.value = true;
  showReadingNote.value = true;
  readingNoteResult.value = '';
  startProgress();
  // Expand popup to accommodate the reading note panel
  resizeWindow('popup', 520, 420).catch(() => {});

  try {
    const docName = currentWindowTitle.value || 'Unknown Document';
    const messages = [
      {
        role: 'system' as const,
        content: 'You are a research reading assistant. Given a text excerpt from an academic paper, generate a structured reading note in Markdown format. Include: (1) Key Points, (2) Critical Analysis, (3) Connections to broader field, (4) Questions raised. Be concise but insightful. Output in the same language as the input text.'
      },
      {
        role: 'user' as const,
        content: `Document: ${docName}\n\nExcerpt:\n${clipboardText.value}`
      }
    ];

    const { text } = await aiClient.chatOnce(messages, false, 'literature_review');
    readingNoteResult.value = text.trim();
    completeProgress();
  } catch (e: any) {
    console.error('[Reading Note] Failed:', e);
    progressLabel.value = 'Note generation failed: ' + (e?.message || 'Unknown error');
  } finally {
    readingNoteLoading.value = false;
    stopProgress();
  }
};

const closeReadingNote = async () => {
  showReadingNote.value = false;
  readingNoteResult.value = '';
  // Restore popup to default size
  await resizeWindow('popup', 200, 280).catch(() => {});
};

const saveReadingNote = async () => {
  if (!readingNoteResult.value) return;

  const vaultPath = settingsStore.config.externalTools.obsidianVaultPath;
  const folder = settingsStore.config.externalTools.obsidianDefaultFolder;

  if (!vaultPath) {
    progressLabel.value = 'Please configure Obsidian Vault path in Settings';
    await new Promise(resolve => setTimeout(resolve, 1500));
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const docName = currentWindowTitle.value || 'Unknown Document';
  const safeName = docName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

  const result = await saveNoteToObsidian(
    vaultPath,
    folder,
    {
      title: `Reading Note: ${safeName}`,
      date: dateStr,
      tags: ['reading-note', 'ai-research', 'pdf'],
      source: docName,
      content: readingNoteResult.value
    },
    'full'
  );

  if (result.success) {
    progressLabel.value = 'Saved to Obsidian!';
  } else {
    progressLabel.value = result.error || 'Save failed';
  }
  await completeProgress();
  await closeReadingNote();
  await hideCurrent();
};

const handleRecommendCitation = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = 'Please select some text first';
    return;
  }

  citationLoading.value = true;
  showCitations.value = true;
  selectedCitations.value = new Set();
  citationReasons.value = new Map();
  startProgress();

  const startTime = performance.now();

  try {
    // Extract keywords from selected text (simple heuristic: take first 10 words)
    const keywords = clipboardText.value.split(/\s+/).slice(0, 10).join(' ');
    const results = await searchZoteroCache(keywords, 10);
    citationResults.value = results;
    completeProgress();

    recordEvent({
      event_type: 'citation_recommend',
      duration_ms: Math.round(performance.now() - startTime),
      metadata: { keywords, results_count: results.length }
    });

    // Fire-and-forget: generate AI reasons for each candidate
    generateReasonsForResults(clipboardText.value);
  } catch (e: any) {
    console.error('[Citation Recommend] Failed:', e);
    progressLabel.value = 'Failed to search Zotero: ' + (e?.message || 'Unknown error');
  } finally {
    citationLoading.value = false;
    stopProgress();
  }
};

const handleSaveToObsidian = async () => {
  const vaultPath = settingsStore.config.externalTools.obsidianVaultPath;
  const folder = settingsStore.config.externalTools.obsidianDefaultFolder;

  if (!vaultPath) {
    progressLabel.value = 'Please configure Obsidian Vault path in Settings';
    await new Promise(resolve => setTimeout(resolve, 1500));
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const title = clipboardText.value.slice(0, 40).trim() || 'Quick Note';

  const result = await saveNoteToObsidian(
    vaultPath,
    folder,
    {
      title: `Quick Note: ${title}`,
      date: dateStr,
      tags: ['quick-note', 'ai-research'],
      source: 'Clipboard via Popup',
      content: clipboardText.value
    },
    'full'
  );

  if (result.success) {
    progressLabel.value = 'Saved to Obsidian!';
  } else {
    progressLabel.value = result.error || 'Save failed';
  }
  await completeProgress();
};

const copyCitationFormat = async (item: ZoteroItem, style?: 'apa' | 'ieee' | 'gb7714') => {
  const resolvedStyle = style || preferredCitationStyle.value;
  const citation = formatCitation(item, resolvedStyle);
  await writeText(citation);
  recordEvent({
    event_type: 'citation_insert',
    resource_id: item.key ?? item.title,
    metadata: { style: resolvedStyle, mode: 'copy' }
  });
};

const closeCitations = () => {
  showCitations.value = false;
  citationResults.value = [];
  citationReasons.value = new Map();
  citationReasonsLoading.value = new Set();
  selectedCitations.value = new Set();
};

/** Generate an AI-powered recommendation reason for a single citation. */
const generateReasonForItem = async (item: ZoteroItem, userText: string) => {
  if (!item.key || citationReasons.value.has(item.key)) return;
  citationReasonsLoading.value.add(item.key);

  try {
    const title = item.title || 'Untitled';
    const abstract = item.abstract || '';
    const creators = item.creators || 'Unknown';
    const year = item.date ? item.date.split('-')[0] : 'n.d.';

    const messages = [
      {
        role: 'system' as const,
        content: 'You are a research assistant. Given a paper and a user\'s writing context, generate a single concise sentence (max 20 words) explaining why this paper is relevant to cite. Respond in the same language as the user\'s writing context. Only return the reason sentence, no extra text.'
      },
      {
        role: 'user' as const,
        content: `User's writing: "${userText.slice(0, 200)}"

Paper: "${title}" by ${creators} (${year})
Abstract: ${abstract.slice(0, 400)}`
      }
    ];

    const { text } = await aiClient.chatOnce(messages, false, 'chat');
    const reason = text.trim().replace(/^[\"']|[\"']$/g, '');
    if (reason) {
      citationReasons.value.set(item.key, reason);
    }
  } catch (e) {
    console.warn('[CitationReason] Failed to generate reason for', item.key, e);
  } finally {
    citationReasonsLoading.value.delete(item.key);
  }
};

/** Generate reasons for all citation results in parallel. */
const generateReasonsForResults = (userText: string) => {
  for (const item of citationResults.value) {
    if (item.key) {
      void generateReasonForItem(item, userText);
    }
  }
};

/** Toggle selection of a citation. */
const toggleCitationSelection = (key: string) => {
  const next = new Set(selectedCitations.value);
  if (next.has(key)) {
    next.delete(key);
  } else {
    next.add(key);
  }
  selectedCitations.value = next;
};

/** Insert selected citations as a formatted citation marker. */
const insertSelectedCitations = async () => {
  const selected = citationResults.value.filter((item) => item.key && selectedCitations.value.has(item.key));
  if (selected.length === 0) return;

  const style = preferredCitationStyle.value;
  let citationText = '';
  if (selected.length === 1) {
    citationText = formatCitation(selected[0], style);
  } else if (style === 'ieee') {
    // Multi-citation IEEE-style marker like [1,2,3]
    const indices = selected.map((_, i) => i + 1).join(',');
    citationText = `[${indices}]`;
  } else {
    // For APA/GB7714, concatenate individual citations
    citationText = selected.map((item, i) => formatCitation(item, style, i + 1)).join('; ');
  }

  await writeText(citationText);

  recordEvent({
    event_type: 'citation_insert',
    metadata: {
      count: selected.length,
      style,
      mode: 'multi_copy',
      items: selected.map((s) => s.key ?? s.title)
    }
  });

  await closeCitations();
  await hideCurrent();
};

// ── Citation format correction ───────────────────────────────

interface ParsedCitation {
  rawAuthors: string;
  year: string;
  fullText: string;
}

/** Parse an informal citation string like "[张三等，2023]" or "(Wang et al., 2021)". */
const parseInformalCitation = (text: string): ParsedCitation | null => {
  // Pattern 1: [Author, Year] or [Author等，Year] (Chinese style)
  const chinesePattern = /[\[【]([^\]】]+?)[等et al\.]*[,，\s]+(\d{4})[\]】]/;
  // Pattern 2: (Author, Year) or (Author et al., Year)
  const parensPattern = /\(([^)]+?)[,，\s]+(\d{4})\)/;
  // Pattern 3: Author (Year)
  const inlinePattern = /([^(]+?)\s*\((\d{4})\)/;

  for (const pattern of [chinesePattern, parensPattern, inlinePattern]) {
    const match = text.match(pattern);
    if (match) {
      return {
        rawAuthors: match[1].trim(),
        year: match[2],
        fullText: match[0]
      };
    }
  }
  return null;
};

/** Find matching Zotero items by author+year. */
const findCitationMatches = async (parsed: ParsedCitation): Promise<ZoteroItem[]> => {
  // Search by year first (narrower)
  const yearResults = await searchZoteroCache(parsed.year, 50);

  // Then filter by author name similarity
  const authorQuery = parsed.rawAuthors.toLowerCase()
    .replace(/等|et al\./g, '')
    .replace(/[,，\s]+/g, ' ')
    .trim();

  return yearResults.filter(item => {
    if (!item.creators) return false;
    const creatorsLower = item.creators.toLowerCase();
    // Check if any part of the author query matches
    const parts = authorQuery.split(/\s+/);
    return parts.some(part => part.length >= 2 && creatorsLower.includes(part));
  });
};

const handleFixCitation = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = 'Please select a citation first';
    return;
  }

  citationFixLoading.value = true;
  showCitationFix.value = true;
  citationFixResult.value = '';
  citationFixError.value = '';
  startProgress();

  const startTime = performance.now();

  try {
    const parsed = parseInformalCitation(clipboardText.value);
    if (!parsed) {
      citationFixError.value = 'Could not parse citation format. Supported: [Author, 2023], (Author, 2023), or Author (2023)';
      citationFixLoading.value = false;
      stopProgress();
      return;
    }

    const matches = await findCitationMatches(parsed);
    if (matches.length === 0) {
      citationFixError.value = `No matching paper found in Zotero for "${parsed.rawAuthors}, ${parsed.year}". Please import it first.`;
      citationFixLoading.value = false;
      stopProgress();
      return;
    }

    // Use the best match
    const bestMatch = matches[0];
    const formatted = formatCitation(bestMatch, 'apa');

    citationFixResult.value = formatted;
    completeProgress();

    recordEvent({
      event_type: 'writing_format_fix',
      duration_ms: Math.round(performance.now() - startTime),
      metadata: { original: clipboardText.value, fixed: formatted }
    });
  } catch (e: any) {
    console.error('[CitationFix] Failed:', e);
    citationFixError.value = 'Failed to fix citation: ' + (e?.message || 'Unknown error');
  } finally {
    citationFixLoading.value = false;
    stopProgress();
  }
};

const closeCitationFix = async () => {
  showCitationFix.value = false;
  citationFixResult.value = '';
  citationFixError.value = '';
};

const acceptCitationFix = async () => {
  if (!citationFixResult.value) return;
  try {
    await replaceSelectedText(citationFixResult.value);
  } catch (e) {
    console.warn('[CitationFix] Failed to inject text:', e);
    await writeText(citationFixResult.value);
  }

  recordEvent({
    event_type: 'citation_insert',
    metadata: { mode: 'format_fix', result: citationFixResult.value }
  });

  await closeCitationFix();
  await hideCurrent();
};

const closeWindow = async () => {
  await hideCurrent();
};

const cancelProgress = async () => {
  stopProgress();
  await aiClient.cancel();
  isProcessing.value = false;
  await closeWindow();
};
</script>

<template>
  <div class="popup-window">
    <!-- Polish / writing companion panel -->
    <div v-if="showPolish" class="polish-panel">
      <div class="polish-header">
        <span class="polish-title">✨ Polish Result</span>
        <button class="polish-close" @click="closePolish">✕</button>
      </div>
      <div v-if="polishLoading" class="polish-loading">Polishing your text...</div>
      <div v-else class="polish-content">
        <div class="polish-diff">
          <span
            v-for="(segment, idx) in polishDiff"
            :key="idx"
            :class="{ 'diff-add': segment.type === 'add', 'diff-del': segment.type === 'del', 'diff-same': segment.type === 'same' }"
          >{{ segment.text }}</span>
        </div>
        <div class="polish-actions">
          <button class="polish-btn accept" @click="acceptPolish">Accept & Replace</button>
          <button class="polish-btn reject" @click="closePolish">Reject</button>
        </div>
      </div>
    </div>

    <!-- Reading companion panel -->
    <div v-if="showReadingNote" class="reading-note-panel">
      <div class="reading-note-header">
        <span class="reading-note-title">📄 Reading Note</span>
        <button class="reading-note-close" @click="closeReadingNote">✕</button>
      </div>
      <div v-if="readingNoteLoading" class="reading-note-loading">Generating reading note...</div>
      <div v-else class="reading-note-content">
        <div class="reading-note-body">
          <pre>{{ readingNoteResult }}</pre>
        </div>
        <div class="reading-note-actions">
          <button class="reading-note-btn save" @click="saveReadingNote">Save to Obsidian</button>
          <button class="reading-note-btn copy" @click="writeText(readingNoteResult); closeReadingNote(); hideCurrent();">Copy & Close</button>
          <button class="reading-note-btn reject" @click="closeReadingNote">Close</button>
        </div>
      </div>
    </div>

    <!-- Citation recommendation panel -->
    <div v-if="showCitations" class="citation-panel">
      <div class="citation-header">
        <span class="citation-title">📖 Recommended Citations</span>
        <button class="citation-close" @click="closeCitations">✕</button>
      </div>
      <div v-if="citationLoading" class="citation-loading">Searching your Zotero library...</div>
      <div v-else-if="citationResults.length === 0" class="citation-empty">
        No matching papers found in your Zotero library.
      </div>
      <div v-else class="citation-list">
        <div
          v-for="(item, idx) in citationResults"
          :key="item.key"
          class="citation-card"
          :class="{ selected: item.key && selectedCitations.has(item.key) }"
        >
          <label class="citation-select">
            <input
              type="checkbox"
              :checked="item.key ? selectedCitations.has(item.key) : false"
              @change="item.key && toggleCitationSelection(item.key)"
            />
            <span class="citation-index">{{ idx + 1 }}</span>
          </label>
          <div class="citation-card-body">
            <div class="citation-card-title">{{ item.title || 'Untitled' }}</div>
            <div class="citation-card-meta">
              <span v-if="item.creators">{{ item.creators }}</span>
              <span v-if="item.date">({{ item.date.split('-')[0] }})</span>
            </div>
            <div v-if="item.key && citationReasonsLoading.has(item.key)" class="citation-reason loading">
              Generating reason...
            </div>
            <div v-else-if="item.key && citationReasons.has(item.key)" class="citation-reason">
              {{ citationReasons.get(item.key) }}
            </div>
            <div class="citation-formats">
              <button
                class="format-btn"
                :class="{ preferred: preferredCitationStyle === 'gb7714' }"
                @click="copyCitationFormat(item, 'gb7714')"
              >
                GB7714
              </button>
              <button
                class="format-btn"
                :class="{ preferred: preferredCitationStyle === 'apa' }"
                @click="copyCitationFormat(item, 'apa')"
              >
                APA
              </button>
              <button
                class="format-btn"
                :class="{ preferred: preferredCitationStyle === 'ieee' }"
                @click="copyCitationFormat(item, 'ieee')"
              >
                IEEE
              </button>
            </div>
          </div>
        </div>
      </div>
      <!-- Multi-select insert bar -->
      <div v-if="selectedCitations.size > 0" class="citation-insert-bar">
        <span class="insert-count">{{ selectedCitations.size }} selected</span>
        <button class="insert-btn" @click="insertSelectedCitations">
          Insert Citation
        </button>
      </div>
    </div>

    <!-- Citation format fix panel -->
    <div v-if="showCitationFix" class="citation-fix-panel">
      <div class="citation-fix-header">
        <span class="citation-fix-title">🔧 Fix Citation Format</span>
        <button class="citation-fix-close" @click="closeCitationFix">✕</button>
      </div>
      <div v-if="citationFixLoading" class="citation-fix-loading">Analyzing citation...</div>
      <div v-else-if="citationFixError" class="citation-fix-error">
        <div class="error-icon">⚠️</div>
        <div class="error-text">{{ citationFixError }}</div>
        <button class="citation-fix-btn reject" @click="closeCitationFix">Close</button>
      </div>
      <div v-else-if="citationFixResult" class="citation-fix-content">
        <div class="citation-fix-label">Corrected citation (APA):</div>
        <div class="citation-fix-result">{{ citationFixResult }}</div>
        <div class="citation-fix-actions">
          <button class="citation-fix-btn accept" @click="acceptCitationFix">Replace in Document</button>
          <button class="citation-fix-btn copy" @click="writeText(citationFixResult); closeCitationFix(); hideCurrent();">Copy & Close</button>
          <button class="citation-fix-btn reject" @click="closeCitationFix">Close</button>
        </div>
      </div>
    </div>

    <!-- Main menu -->
    <div v-else
      v-for="item in menuItems"
      :key="item.action"
      class="menu-item"
      :class="{ 'processing': isProcessing }"
      @click="handleAction(item.action)"
    >
      <span class="icon">{{ item.icon }}</span>
      <span class="label">{{ item.label }}</span>
    </div>

    <div v-if="isProcessing" class="processing-overlay">
      <div class="progress-container">
        <div class="progress-label">{{ progressLabel }}</div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" :style="{ width: progress + '%' }"></div>
        </div>
        <div class="progress-percent">{{ Math.round(progress) }}%</div>
        <button class="cancel-btn" @click="cancelProgress">终止任务</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.popup-window {
  width: 100%;
  height: 100%;
  background: rgba(13, 13, 20, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 12px;
  padding: 0.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
}

/* Subtle glow effect at top */
.popup-window::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 204, 0.5), transparent);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: rgba(240, 240, 245, 0.8);
  position: relative;
  overflow: hidden;
}

.menu-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #00e5cc;
  transform: scaleY(0);
  transition: transform 0.2s ease;
  border-radius: 0 2px 2px 0;
}

.menu-item:hover:not(.processing) {
  background: rgba(0, 229, 204, 0.08);
  color: #f0f0f5;
}

.menu-item:hover:not(.processing)::before {
  transform: scaleY(1);
}

.menu-item.processing {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon {
  font-size: 1.25rem;
  width: 28px;
  text-align: center;
}

.label {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(7, 7, 13, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  backdrop-filter: blur(8px);
}

.progress-container {
  width: 80%;
  max-width: 260px;
  text-align: center;
}

.progress-label {
  color: rgba(240, 240, 245, 0.7);
  font-size: 13px;
  margin-bottom: 14px;
  letter-spacing: 0.02em;
  min-height: 20px;
}

.progress-bar-track {
  width: 100%;
  height: 6px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
  overflow: hidden;
  margin-bottom: 10px;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #00e5cc 0%, #00b8a3 100%);
  border-radius: 3px;
  transition: width 0.1s ease;
  box-shadow: 0 0 10px rgba(0, 229, 204, 0.4);
}

.progress-percent {
  color: #00e5cc;
  font-size: 12px;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
  margin-bottom: 14px;
}

.cancel-btn {
  margin-top: 12px;
  padding: 7px 18px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.cancel-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
}

/* Citation recommendation panel */
.citation-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  overflow: hidden;
}

.citation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 0.5rem;
}

.citation-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.85);
}

.citation-close {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
}

.citation-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.citation-loading,
.citation-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.82rem;
}

.citation-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.citation-card {
  padding: 0.6rem 0.75rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  transition: all 0.15s ease;
}

.citation-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.1);
}

.citation-card-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.85);
  line-height: 1.4;
  margin-bottom: 0.25rem;
}

.citation-card-meta {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.4);
  margin-bottom: 0.4rem;
}

.citation-card.selected {
  border-color: rgba(0, 229, 204, 0.3);
  background: rgba(0, 229, 204, 0.05);
}

.citation-select {
  display: flex;
  align-items: flex-start;
  gap: 0.4rem;
  cursor: pointer;
  flex-shrink: 0;
  padding-top: 0.15rem;
}

.citation-select input[type="checkbox"] {
  accent-color: #00e5cc;
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.citation-index {
  font-size: 0.65rem;
  color: rgba(240, 240, 245, 0.3);
  font-family: 'JetBrains Mono', monospace;
  min-width: 14px;
  text-align: center;
}

.citation-card-body {
  flex: 1;
  min-width: 0;
}

.citation-reason {
  font-size: 0.72rem;
  color: rgba(0, 229, 204, 0.7);
  margin-bottom: 0.4rem;
  line-height: 1.4;
  font-style: italic;
}

.citation-reason.loading {
  color: rgba(240, 240, 245, 0.3);
  font-style: normal;
}

.citation-insert-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 229, 204, 0.05);
  margin-top: auto;
}

.insert-count {
  font-size: 0.75rem;
  color: rgba(240, 240, 245, 0.5);
}

.insert-btn {
  padding: 0.4rem 0.9rem;
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  border: none;
  border-radius: 6px;
  color: #06211f;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.insert-btn:hover {
  opacity: 0.9;
}

.citation-formats {
  display: flex;
  gap: 0.35rem;
}

.format-btn {
  padding: 0.25rem 0.5rem;
  background: rgba(0, 229, 204, 0.1);
  border: 1px solid rgba(0, 229, 204, 0.2);
  border-radius: 5px;
  color: #00e5cc;
  font-size: 0.65rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.format-btn:hover {
  background: rgba(0, 229, 204, 0.2);
}

.format-btn.preferred {
  background: rgba(0, 229, 204, 0.25);
  border-color: rgba(0, 229, 204, 0.5);
  box-shadow: 0 0 8px rgba(0, 229, 204, 0.15);
}

/* Polish / writing companion panel */
.polish-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  overflow: hidden;
}

.polish-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 0.5rem;
}

.polish-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.85);
}

.polish-close {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
}

.polish-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.polish-loading {
  text-align: center;
  padding: 2rem 1rem;
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.82rem;
}

.polish-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.polish-diff {
  flex: 1;
  overflow-y: auto;
  font-size: 0.8rem;
  line-height: 1.6;
  color: rgba(240, 240, 245, 0.85);
  background: rgba(0, 0, 0, 0.2);
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-add {
  background: rgba(34, 197, 94, 0.25);
  color: #4ade80;
  border-radius: 2px;
  padding: 0 1px;
}

.diff-del {
  background: rgba(239, 68, 68, 0.25);
  color: #f87171;
  text-decoration: line-through;
  border-radius: 2px;
  padding: 0 1px;
}

.diff-same {
  color: rgba(240, 240, 245, 0.85);
}

.polish-actions {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: auto;
}

.polish-btn {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: none;
}

.polish-btn.accept {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  color: #06211f;
}

.polish-btn.accept:hover {
  opacity: 0.9;
}

.polish-btn.reject {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(240, 240, 245, 0.6);
}

.polish-btn.reject:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

/* Reading companion panel */
.reading-note-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  overflow: hidden;
}

.reading-note-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 0.5rem;
}

.reading-note-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.85);
}

.reading-note-close {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
}

.reading-note-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.reading-note-loading {
  text-align: center;
  padding: 2rem 1rem;
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.82rem;
}

.reading-note-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.reading-note-body {
  flex: 1;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.2);
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.reading-note-body pre {
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.78rem;
  line-height: 1.6;
  color: rgba(240, 240, 245, 0.85);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.reading-note-actions {
  display: flex;
  gap: 0.5rem;
  padding-top: 0.6rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: auto;
}

.reading-note-btn {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: none;
}

.reading-note-btn.save {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  color: #06211f;
}

.reading-note-btn.save:hover {
  opacity: 0.9;
}

.reading-note-btn.copy {
  background: rgba(61, 116, 231, 0.15);
  border: 1px solid rgba(61, 116, 231, 0.3);
  color: #3d74e7;
}

.reading-note-btn.copy:hover {
  background: rgba(61, 116, 231, 0.25);
}

.reading-note-btn.reject {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(240, 240, 245, 0.6);
}

.reading-note-btn.reject:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}

/* Citation format fix panel */
.citation-fix-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0.75rem;
  overflow: hidden;
}

.citation-fix-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 0.6rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 0.5rem;
}

.citation-fix-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.85);
}

.citation-fix-close {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
}

.citation-fix-close:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.citation-fix-loading,
.citation-fix-error {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  text-align: center;
  padding: 1rem;
}

.citation-fix-loading {
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.82rem;
}

.citation-fix-error .error-icon {
  font-size: 1.5rem;
}

.citation-fix-error .error-text {
  color: rgba(240, 240, 245, 0.6);
  font-size: 0.78rem;
  line-height: 1.5;
}

.citation-fix-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.citation-fix-label {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.4);
  margin-bottom: 0.4rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.citation-fix-result {
  background: rgba(0, 0, 0, 0.2);
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 0.8rem;
  line-height: 1.6;
  color: rgba(240, 240, 245, 0.85);
  word-break: break-word;
  margin-bottom: 0.75rem;
}

.citation-fix-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: auto;
}

.citation-fix-btn {
  flex: 1;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  border: none;
}

.citation-fix-btn.accept {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  color: #06211f;
}

.citation-fix-btn.accept:hover {
  opacity: 0.9;
}

.citation-fix-btn.copy {
  background: rgba(61, 116, 231, 0.15);
  border: 1px solid rgba(61, 116, 231, 0.3);
  color: #3d74e7;
}

.citation-fix-btn.copy:hover {
  background: rgba(61, 116, 231, 0.25);
}

.citation-fix-btn.reject {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(240, 240, 245, 0.6);
}

.citation-fix-btn.reject:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border-color: rgba(239, 68, 68, 0.3);
}
</style>
