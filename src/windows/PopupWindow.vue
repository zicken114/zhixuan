<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch, nextTick } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient } from '../utils/aiClient';
import { marked } from 'marked';
import { useSettingsStore, supportedLanguages, type TaskType } from '../stores/settings';
import { useProjectStore } from '../stores/projects';
import { usePopupHistoryStore, type PopupActionType } from '../stores/popupHistory';
import { useProgress } from '../composables/useProgress';
import { useClipboard } from '../composables/useClipboard';
import { useWindow } from '../composables/useWindow';
import { useI18n } from '../composables/useI18n';
import { replaceSelectedText } from '../composables/useTextInjection';
import { recordEvent } from '../composables/useEvents';
import { formatCitation } from '../utils/citationFormatter';
import { saveNoteToObsidian } from '../utils/obsidianBridge';

const settingsStore = useSettingsStore();
const projectStore = useProjectStore();
const popupHistoryStore = usePopupHistoryStore();
const { progress, label: progressLabel, start: startProgress, complete: completeProgress, stop: stopProgress } = useProgress();
const { writeText, writeHtml } = useClipboard();
const { hideCurrent, show: showWindow, showSettings: openSettingsWindow, quitApp, resize: resizeWindow } = useWindow();
const { t } = useI18n();

const clipboardText = ref('');
const isProcessing = ref(false);
const currentAppType = ref<string>('unknown');
const processingActionLabel = ref('');
const processingInput = ref('');
const processingOutput = ref('');
const menuContentRef = ref<HTMLElement | null>(null);

// Citation recommendation state
const showCitations = ref(false);
const citationResults = ref<any[]>([]);
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
  { icon: '💬', label: 'Chat', action: 'chat' },
  { icon: '🕵️', label: '"杠精"视角审视', action: 'translate' },
  { icon: '📖', label: '盐选脑洞扩写', action: 'clean' },
  { icon: '📜', label: 'History', action: 'history' },
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
    items.splice(2, 0, { icon: '🌟', label: '转为"知乎高赞体"', action: 'polish' });
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
    { icon: '📸', label: 'Screenshot', action: 'screenshot' },
    { icon: '⚙️', label: 'Settings', action: 'settings' },
    { icon: '⏻', label: 'Exit', action: 'exit' }
  );
  return items;
});

const menuLabelKeyMap: Record<string, string> = {
  chat: 'common.chat',
  translate: 'popup.translate',
  clean: 'popup.clean',
  citation: 'popup.formatCitation',
  history: 'popup.history',
  polish: 'popup.polish',
  recommend_citation: 'popup.recommendCitation',
  fix_citation: 'popup.fixCitationFormat',
  reading_note: 'popup.generateNote',
  save_to_obsidian: 'popup.saveToObsidian',
  screenshot: 'common.screenshot',
  settings: 'common.settings',
  exit: 'common.exit'
};

const getMenuItemLabel = (action: string, fallback: string) =>
  t(menuLabelKeyMap[action] || '', undefined) || fallback;

const isDetailPanelVisible = computed(() =>
  showPolish.value
  || showReadingNote.value
  || showCitations.value
  || showCitationFix.value
);

const POPUP_MENU_WIDTH = 260;
const POPUP_PANEL_WIDTH = 520;
const POPUP_PANEL_HEIGHT = 420;
const POPUP_MENU_MIN_HEIGHT = 96;
const POPUP_MENU_MAX_HEIGHT = 520;
const POPUP_MENU_VERTICAL_PADDING = 10;

let blurTimeout: number | null = null;
let unlistenClipboard: (() => void) | null = null;
let unlistenWindowActivity: (() => void) | null = null;
let unlistenAutoAction: (() => void) | null = null;
const blurCloseDelayMs = 120;

const handleBlur = () => {
  // Don't auto-cancel when losing focus - let the AI request complete
  // The popup will be hidden but the request continues in background
  // Only auto-close if not processing
  blurTimeout = window.setTimeout(async () => {
    if (!isProcessing.value) {
      await closeWindow();
    }
  }, blurCloseDelayMs);
};

const handleFocus = () => {
  // Cancel the blur timer if window regains focus
  if (blurTimeout) {
    clearTimeout(blurTimeout);
    blurTimeout = null;
  }
};

const syncPopupMenuSize = async () => {
  if (isDetailPanelVisible.value || isProcessing.value) return;

  await nextTick();

  if (!menuContentRef.value) return;

  const contentHeight = Math.ceil(menuContentRef.value.scrollHeight);
  const targetHeight = Math.min(
    Math.max(contentHeight + POPUP_MENU_VERTICAL_PADDING, POPUP_MENU_MIN_HEIGHT),
    POPUP_MENU_MAX_HEIGHT
  );

  await resizeWindow('popup', POPUP_MENU_WIDTH, targetHeight).catch(() => {});
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

  await syncPopupMenuSize();
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

watch(menuItems, () => {
  void syncPopupMenuSize();
}, { deep: true });

watch(isDetailPanelVisible, async (visible) => {
  if (visible) {
    await resizeWindow('popup', POPUP_PANEL_WIDTH, POPUP_PANEL_HEIGHT).catch(() => {});
    return;
  }

  await syncPopupMenuSize();
});

const handleAction = async (action: string) => {
  if (action === 'chat') {
    await showWindow('main');
    await hideCurrent();
    return;
  }

  if (action === 'screenshot') {
    await hideCurrent();
    await invoke('trigger_capture');
    return;
  }

  if (action === 'settings') {
    await openSettingsWindow();
    await hideCurrent();
    return;
  }

  if (action === 'history') {
    await showWindow('history');
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
  const currentItem = menuItems.value.find(item => item.action === action);
  processingActionLabel.value = currentItem
    ? getMenuItemLabel(currentItem.action, currentItem.label)
    : action;
  processingInput.value = clipboardText.value;
  processingOutput.value = '';

  const startTime = performance.now();
  let eventType = '';

  try {
    let outputTextForHistory = '';
    switch (action) {
      case 'translate':
        eventType = 'clipboard_translate';
        outputTextForHistory = await handleTranslate();
        break;
      case 'clean':
        eventType = 'clipboard_purify';
        outputTextForHistory = await handleCleanToWord();
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

    if (outputTextForHistory) {
      const actionType = action as PopupActionType;
      popupHistoryStore.addItem({
        actionType,
        actionLabel: processingActionLabel.value,
        inputText: clipboardText.value,
        outputText: outputTextForHistory
      });
      await invoke('notify_history_changed');
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
    processingActionLabel.value = '';
    processingInput.value = '';
    processingOutput.value = '';
  }
  await hideCurrent();
};

const streamTextResponse = async (messages: Array<{ role: 'system' | 'user'; content: string }>, taskType: TaskType) => {
  let fullText = '';
  let streamError: Error | null = null;
  await aiClient.chatStream(messages, {
    onStart: () => {
      fullText = '';
      processingOutput.value = '';
    },
    onToken: (token) => {
      fullText += token;
      processingOutput.value = fullText;
    },
    onComplete: (text) => {
      fullText = (text || '').trim();
      processingOutput.value = fullText;
    },
    onError: (error) => {
      streamError = error;
    }
  }, false, taskType);
  if (streamError) {
    throw streamError;
  }
  return fullText.trim();
};

const handleTranslate = async () => {
  const { sourceLang, targetLang } = settingsStore.config.translateConfig;
  const sourceLabel = supportedLanguages.find(l => l.code === sourceLang)?.label || sourceLang;
  const targetLabel = supportedLanguages.find(l => l.code === targetLang)?.label || targetLang;

  const systemPrompt = "你现在扮演知乎评论区最严格的'逻辑杠精'。请审视用户提供的这段文字，指出其中可能存在的：1. 逻辑漏洞；2. 幸存者偏差；3. 容易被网友攻击的靶点。最后给出 1-2 条修改建议，帮助作者让这段论述无懈可击。语气可以稍微犀利一点，但最终目的是帮助作者完善文章。";

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: clipboardText.value }
  ];

  const text = await streamTextResponse(messages, 'translation');
  await writeText(text);
  await completeProgress();
  return text;
};

const handleCleanToWord = async () => {
  const hasMarkdown = /[#*`\[\]]/g.test(clipboardText.value);

  if (hasMarkdown) {
    const html = await marked(clipboardText.value);
    await writeHtml(html, clipboardText.value);
    processingOutput.value = clipboardText.value;
    await completeProgress();
    return clipboardText.value;
  } else {
    const messages = [
      {
        role: 'system' as const,
        content: '你是知乎盐选专栏的金牌小说作者，悬疑、脑洞、反转类是你的拿手好戏。根据用户给的东西，扩写成一段 300 字左右的盐选小说高潮或开头，悬念要足，画面感要强，结尾卡在最勾人的地方。像真人写小说一样自然，不要出现星号、井号、列表编号这些 markdown 符号。'
      },
      { role: 'user' as const, content: clipboardText.value }
    ];

    const text = await streamTextResponse(messages, 'text_cleanup');
    await writeText(text);
    await completeProgress();
    return text;
  }
};


const handlePolish = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = t('popup.pleaseSelectText');
    return;
  }

  polishLoading.value = true;
  showPolish.value = true;
  polishOriginal.value = clipboardText.value;
  polishResult.value = '';
  polishDiff.value = [];
  startProgress();

  const startTime = performance.now();

  try {
    const messages = [
      {
        role: 'system' as const,
        content: '你是知乎百万粉大V，改文案是你的绝活。把用户给的内容改成知乎高赞风格，适当来点"谢邀""利益相关"这种知乎味儿。结构上就按知乎套路来：先抛观点，再展开说，最后上个金句收尾。语气要专业但别端着，怎么接地气怎么来。直接输出改写后的内容，别废话，也别用星号、井号、列表编号这些 markdown 符号，纯文字输出。'
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
    progressLabel.value = `${t('popup.polishFailed')}: ${e?.message || t('common.unknownError')}`;
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
    progressLabel.value = t('popup.pleaseSelectPdfText');
    return;
  }

  readingNoteLoading.value = true;
  showReadingNote.value = true;
  readingNoteResult.value = '';
  startProgress();

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
    progressLabel.value = `${t('popup.noteGenerationFailed')}: ${e?.message || t('common.unknownError')}`;
  } finally {
    readingNoteLoading.value = false;
    stopProgress();
  }
};

const closeReadingNote = async () => {
  showReadingNote.value = false;
  readingNoteResult.value = '';
};

const saveReadingNote = async () => {
  if (!readingNoteResult.value) return;

  const vaultPath = settingsStore.config.externalTools.obsidianVaultPath;
  const folder = settingsStore.config.externalTools.obsidianDefaultFolder;

  if (!vaultPath) {
    progressLabel.value = t('popup.pleaseConfigureObsidian');
    await new Promise(resolve => setTimeout(resolve, 1500));
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const docName = currentWindowTitle.value || t('popup.unknownDocument');
  const safeName = docName.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);

  const result = await saveNoteToObsidian(
    vaultPath,
    folder,
    {
      title: `${t('popup.readingNoteTitle')}: ${safeName}`,
      date: dateStr,
      tags: ['reading-note', 'ai-research', 'pdf'],
      source: docName,
      content: readingNoteResult.value
    },
    'full'
  );

  if (result.success) {
    progressLabel.value = t('popup.savedToObsidian');
  } else {
    progressLabel.value = result.error || t('popup.saveFailed');
  }
  await completeProgress();
  await closeReadingNote();
  await hideCurrent();
};

const handleRecommendCitation = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = t('popup.pleaseSelectText');
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
      citationResults.value = [];
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
    progressLabel.value = `文献推荐失败: ${e?.message || t('common.unknownError')}`;
  } finally {
    citationLoading.value = false;
    stopProgress();
  }
};

const handleSaveToObsidian = async () => {
  const vaultPath = settingsStore.config.externalTools.obsidianVaultPath;
  const folder = settingsStore.config.externalTools.obsidianDefaultFolder;

  if (!vaultPath) {
    progressLabel.value = t('popup.pleaseConfigureObsidian');
    await new Promise(resolve => setTimeout(resolve, 1500));
    return;
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const title = clipboardText.value.slice(0, 40).trim() || t('popup.quickNote');

  const result = await saveNoteToObsidian(
    vaultPath,
    folder,
    {
      title: `${t('popup.quickNote')}: ${title}`,
      date: dateStr,
      tags: ['quick-note', 'ai-research'],
      source: t('popup.clipboardSource'),
      content: clipboardText.value
    },
    'full'
  );

  if (result.success) {
    progressLabel.value = t('popup.savedToObsidian');
  } else {
    progressLabel.value = result.error || t('popup.saveFailed');
  }
  await completeProgress();
};

const copyCitationFormat = async (item: any, style?: 'apa' | 'ieee' | 'gb7714') => {
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
const generateReasonForItem = async (item: any, userText: string) => {
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

/** Find matching citation items by author+year. */
const findCitationMatches = async (_parsed: ParsedCitation): Promise<any[]> => {
  return [];
};

const handleFixCitation = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = t('popup.pleaseSelectCitation');
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
      citationFixError.value = t('popup.couldNotParseCitation');
      citationFixLoading.value = false;
      stopProgress();
      return;
    }

    const matches = await findCitationMatches(parsed);
    if (matches.length === 0) {
      citationFixError.value = t('popup.noMatchingPaper', { authors: parsed.rawAuthors, year: parsed.year });
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
    citationFixError.value = `${t('popup.failedToFixCitation')}: ${e?.message || t('common.unknownError')}`;
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
        <span class="polish-title">✨ {{ t('popup.polishResult') }}</span>
        <button class="polish-close" @click="closePolish">✕</button>
      </div>
      <div v-if="polishLoading" class="polish-loading">{{ t('popup.polishingText') }}</div>
      <div v-else class="polish-content">
        <div class="polish-diff">
          <span
            v-for="(segment, idx) in polishDiff"
            :key="idx"
            :class="{ 'diff-add': segment.type === 'add', 'diff-del': segment.type === 'del', 'diff-same': segment.type === 'same' }"
          >{{ segment.text }}</span>
        </div>
        <div class="polish-actions">
          <button class="polish-btn accept" @click="acceptPolish">{{ t('popup.acceptReplace') }}</button>
          <button class="polish-btn reject" @click="closePolish">{{ t('popup.reject') }}</button>
        </div>
      </div>
    </div>

    <!-- Reading companion panel -->
    <div v-if="showReadingNote" class="reading-note-panel">
      <div class="reading-note-header">
        <span class="reading-note-title">📄 {{ t('popup.readingNote') }}</span>
        <button class="reading-note-close" @click="closeReadingNote">✕</button>
      </div>
      <div v-if="readingNoteLoading" class="reading-note-loading">{{ t('popup.generatingReadingNote') }}</div>
      <div v-else class="reading-note-content">
        <div class="reading-note-body">
          <pre>{{ readingNoteResult }}</pre>
        </div>
        <div class="reading-note-actions">
          <button class="reading-note-btn save" @click="saveReadingNote">{{ t('popup.saveToObsidian') }}</button>
          <button class="reading-note-btn copy" @click="writeText(readingNoteResult); closeReadingNote(); hideCurrent();">{{ t('popup.copyAndClose') }}</button>
          <button class="reading-note-btn reject" @click="closeReadingNote">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>

    <!-- Citation recommendation panel -->
    <div v-if="showCitations" class="citation-panel">
      <div class="citation-header">
        <span class="citation-title">📖 {{ t('popup.recommendedCitations') }}</span>
        <button class="citation-close" @click="closeCitations">✕</button>
      </div>
      <div v-if="citationLoading" class="citation-loading">搜索文献中...</div>
      <div v-else-if="citationResults.length === 0" class="citation-empty">
        暂无匹配的文献推荐。
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
            <div class="citation-card-title">{{ item.title || t('popup.untitled') }}</div>
            <div class="citation-card-meta">
              <span v-if="item.creators">{{ item.creators }}</span>
              <span v-if="item.date">({{ item.date.split('-')[0] }})</span>
            </div>
            <div v-if="item.key && citationReasonsLoading.has(item.key)" class="citation-reason loading">
              {{ t('popup.generatingReason') }}
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
        <span class="insert-count">{{ t('popup.selectedCount', { count: selectedCitations.size }) }}</span>
        <button class="insert-btn" @click="insertSelectedCitations">
          {{ t('popup.insertCitation') }}
        </button>
      </div>
    </div>

    <!-- Citation format fix panel -->
    <div v-if="showCitationFix" class="citation-fix-panel">
      <div class="citation-fix-header">
        <span class="citation-fix-title">🔧 {{ t('popup.fixCitationFormat') }}</span>
        <button class="citation-fix-close" @click="closeCitationFix">✕</button>
      </div>
      <div v-if="citationFixLoading" class="citation-fix-loading">{{ t('popup.analyzingCitation') }}</div>
      <div v-else-if="citationFixError" class="citation-fix-error">
        <div class="error-icon">⚠️</div>
        <div class="error-text">{{ citationFixError }}</div>
        <button class="citation-fix-btn reject" @click="closeCitationFix">{{ t('common.close') }}</button>
      </div>
      <div v-else-if="citationFixResult" class="citation-fix-content">
        <div class="citation-fix-label">{{ t('popup.correctedCitation') }}</div>
        <div class="citation-fix-result">{{ citationFixResult }}</div>
        <div class="citation-fix-actions">
          <button class="citation-fix-btn accept" @click="acceptCitationFix">{{ t('popup.replaceInDocument') }}</button>
          <button class="citation-fix-btn copy" @click="writeText(citationFixResult); closeCitationFix(); hideCurrent();">{{ t('popup.copyAndClose') }}</button>
          <button class="citation-fix-btn reject" @click="closeCitationFix">{{ t('common.close') }}</button>
        </div>
      </div>
    </div>

    <!-- Main menu -->
    <div v-else ref="menuContentRef" class="popup-menu-content">
      <div
        v-for="item in menuItems"
        :key="item.action"
        class="menu-item"
        :class="{ 'processing': isProcessing }"
        @click="handleAction(item.action)"
      >
        <span class="icon">{{ item.icon }}</span>
        <span class="label">{{ getMenuItemLabel(item.action, item.label) }}</span>
      </div>
    </div>

    <div v-if="isProcessing" class="processing-overlay">
      <div class="progress-container">
        <div class="progress-action">{{ processingActionLabel }}</div>
        <div class="progress-label">{{ progressLabel }}</div>
        <div class="io-block">
          <div class="io-title">输入</div>
          <pre class="io-content">{{ processingInput }}</pre>
        </div>
        <div class="io-block">
          <div class="io-title">输出</div>
          <pre class="io-content">{{ processingOutput || '处理中...' }}</pre>
        </div>
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
  box-sizing: border-box;
  width: 100%;
  min-height: 100%;
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  padding: var(--space-xs);
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-light);
  position: relative;
  overflow: hidden;
  clip-path: inset(0 round var(--radius-lg));
}

.popup-menu-content {
  display: flex;
  flex-direction: column;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
  color: var(--text-secondary);
  position: relative;
  overflow: hidden;
  font-size: 0.875rem;
  font-weight: 500;
}

.menu-item:hover:not(.processing) {
  background: var(--accent-subtle);
  color: var(--accent-text);
}

.menu-item:active {
  background: var(--accent-border);
}

.menu-item.processing {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon {
  font-size: 1.125rem;
  width: 24px;
  text-align: center;
}

.label {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.processing-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--bg-base) 88%, transparent);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border-subtle);
}

.progress-container {
  width: 80%;
  max-width: 280px;
  text-align: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  box-shadow: var(--shadow-sm);
}

.progress-label {
  font-size: 0.8125rem;
  color: var(--text-secondary);
  margin-bottom: var(--space-md);
}

.progress-action {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-xs);
}

.io-block {
  text-align: left;
  margin-bottom: var(--space-sm);
}

.io-title {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.io-content {
  margin: 0;
  max-height: 80px;
  overflow: auto;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: var(--space-xs);
  font-size: 0.7rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.progress-bar-track {
  width: 100%;
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-percent {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  margin-top: var(--space-sm);
}

.cancel-btn {
  margin-top: var(--space-md);
  padding: var(--space-xs) var(--space-lg);
  background: var(--error-bg);
  border: 1px solid rgba(234, 67, 53, 0.2);
  color: var(--error);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.cancel-btn:hover {
  background: color-mix(in srgb, var(--error-bg) 75%, var(--error) 25%);
}

/* Citation recommendation panel */
.citation-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--space-md);
  overflow: hidden;
}

.citation-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-sm);
}

.citation-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.citation-close {
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  transition: all var(--transition-fast);
}

.citation-close:hover {
  background: var(--error-bg);
  color: var(--error);
}

.citation-loading,
.citation-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.citation-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.citation-card {
  padding: var(--space-sm) var(--space-md);
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-sm);
  transition: all var(--transition-fast);
}

.citation-card:hover {
  border-color: var(--border-medium);
}

.citation-card.selected {
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}

.citation-card-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 0.25rem;
}

.citation-card-meta {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-bottom: 0.4rem;
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
  accent-color: var(--accent);
  width: 14px;
  height: 14px;
  cursor: pointer;
}

.citation-index {
  font-size: 0.65rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
  min-width: 14px;
  text-align: center;
}

.citation-card-body {
  flex: 1;
  min-width: 0;
}

.citation-reason {
  font-size: 0.72rem;
  color: var(--accent-text);
  font-style: italic;
  margin-bottom: 0.4rem;
  line-height: 1.4;
}

.citation-reason.loading {
  color: var(--text-muted);
  font-style: normal;
}

.citation-insert-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-sm) var(--space-md);
  border-top: 1px solid var(--border-subtle);
  background: var(--accent-subtle);
}

.insert-count {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.insert-btn {
  background: var(--accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-md);
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.insert-btn:hover {
  background: var(--accent-hover);
}

.citation-formats {
  display: flex;
  gap: 0.35rem;
}

.format-btn {
  padding: 2px 8px;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 0.65rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.format-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.format-btn.preferred {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
  box-shadow: none;
}

/* Polish / writing companion panel */
.polish-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--space-md);
}

.polish-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-sm);
}

.polish-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.polish-close {
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  transition: all var(--transition-fast);
}

.polish-close:hover {
  background: var(--error-bg);
  color: var(--error);
}

.polish-loading {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted);
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
  background: var(--bg-surface);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  font-size: 0.8125rem;
  border: 1px solid var(--border-subtle);
  white-space: pre-wrap;
  word-break: break-word;
}

.diff-add {
  background: var(--success-bg);
  color: var(--success);
  border-radius: 2px;
  padding: 0 1px;
}

.diff-del {
  background: var(--error-bg);
  color: var(--error);
  text-decoration: line-through;
  border-radius: 2px;
  padding: 0 1px;
}

.diff-same {
  color: var(--text-primary);
}

.polish-actions {
  display: flex;
  gap: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
  margin-top: auto;
}

.polish-btn {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.polish-btn.accept {
  background: var(--accent);
  color: var(--text-on-accent);
}

.polish-btn.accept:hover {
  background: var(--accent-hover);
}

.polish-btn.reject {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}

.polish-btn.reject:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
}

/* Reading companion panel */
.reading-note-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--space-md);
}

.reading-note-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-sm);
}

.reading-note-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.reading-note-close {
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  transition: all var(--transition-fast);
}

.reading-note-close:hover {
  background: var(--error-bg);
  color: var(--error);
}

.reading-note-loading {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted);
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
  background: var(--bg-surface);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
}

.reading-note-body pre {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  margin: 0;
}

.reading-note-actions {
  display: flex;
  gap: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-subtle);
  margin-top: auto;
}

.reading-note-btn {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.reading-note-btn.save {
  background: var(--accent);
  color: var(--text-on-accent);
}

.reading-note-btn.save:hover {
  background: var(--accent-hover);
}

.reading-note-btn.copy {
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
}

.reading-note-btn.copy:hover {
  background: var(--accent);
  color: var(--text-on-accent);
}

.reading-note-btn.reject {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}

.reading-note-btn.reject:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
}

/* Citation format fix panel */
.citation-fix-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: var(--space-md);
}

.citation-fix-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-sm);
  border-bottom: 1px solid var(--border-subtle);
  margin-bottom: var(--space-sm);
}

.citation-fix-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.citation-fix-close {
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.2rem 0.5rem;
  transition: all var(--transition-fast);
}

.citation-fix-close:hover {
  background: var(--error-bg);
  color: var(--error);
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
  color: var(--text-muted);
  font-size: 0.82rem;
}

.citation-fix-error .error-icon {
  font-size: 1.5rem;
}

.citation-fix-error .error-text {
  color: var(--text-secondary);
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
  color: var(--text-muted);
  margin-bottom: 0.4rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.citation-fix-result {
  background: var(--bg-surface);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
  margin-bottom: 0.75rem;
}

.citation-fix-actions {
  display: flex;
  gap: var(--space-sm);
  margin-top: auto;
}

.citation-fix-btn {
  flex: 1;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.citation-fix-btn.accept {
  background: var(--accent);
  color: var(--text-on-accent);
}

.citation-fix-btn.accept:hover {
  background: var(--accent-hover);
}

.citation-fix-btn.copy {
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  color: var(--accent-text);
}

.citation-fix-btn.copy:hover {
  background: var(--accent);
  color: var(--text-on-accent);
}

.citation-fix-btn.reject {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}

.citation-fix-btn.reject:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
}
</style>
