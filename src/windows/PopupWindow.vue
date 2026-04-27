<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { aiClient } from '../utils/aiClient';
import { marked } from 'marked';
import { useSettingsStore, supportedLanguages } from '../stores/settings';
import { useProgress } from '../composables/useProgress';
import { useClipboard } from '../composables/useClipboard';
import { useWindow } from '../composables/useWindow';
import { recordEvent } from '../composables/useEvents';
import { searchZoteroCache, formatCitation } from '../utils/zoteroBridge';
import { saveNoteToObsidian } from '../utils/obsidianBridge';
import type { ZoteroItem } from '../composables/useDatabase';

const settingsStore = useSettingsStore();
const { progress, label: progressLabel, start: startProgress, complete: completeProgress, stop: stopProgress } = useProgress();
const { writeText, writeHtml } = useClipboard();
const { hideCurrent, showSettings: openSettingsWindow, quitApp } = useWindow();

const clipboardText = ref('');
const isProcessing = ref(false);
const currentAppType = ref<string>('unknown');

// Citation recommendation state
const showCitations = ref(false);
const citationResults = ref<ZoteroItem[]>([]);
const citationLoading = ref(false);

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

const menuItems = computed(() => {
  const items = [...baseMenuItems];
  // Show citation recommendation when in writing apps
  if (currentAppType.value === 'writing') {
    items.splice(2, 0, { icon: '📖', label: 'Recommend Citation', action: 'recommend_citation' });
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
      case 'recommend_citation':
        eventType = 'citation_recommend';
        await handleRecommendCitation();
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

const handleRecommendCitation = async () => {
  if (!clipboardText.value.trim()) {
    progressLabel.value = 'Please select some text first';
    return;
  }

  citationLoading.value = true;
  showCitations.value = true;
  startProgress();

  try {
    // Extract keywords from selected text (simple heuristic: take first 10 words)
    const keywords = clipboardText.value.split(/\s+/).slice(0, 10).join(' ');
    const results = await searchZoteroCache(keywords, 10);
    citationResults.value = results;
    completeProgress();
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

const copyCitationFormat = async (item: ZoteroItem, style: 'apa' | 'ieee' | 'gb7714' = 'gb7714') => {
  const citation = formatCitation(item, style);
  await writeText(citation);
};

const closeCitations = () => {
  showCitations.value = false;
  citationResults.value = [];
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
          v-for="item in citationResults"
          :key="item.key"
          class="citation-card"
        >
          <div class="citation-card-title">{{ item.title || 'Untitled' }}</div>
          <div class="citation-card-meta">
            <span v-if="item.creators">{{ item.creators }}</span>
            <span v-if="item.date">({{ item.date.split('-')[0] }})</span>
          </div>
          <div class="citation-formats">
            <button class="format-btn" @click="copyCitationFormat(item, 'gb7714')">GB7714</button>
            <button class="format-btn" @click="copyCitationFormat(item, 'apa')">APA</button>
            <button class="format-btn" @click="copyCitationFormat(item, 'ieee')">IEEE</button>
          </div>
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
</style>
