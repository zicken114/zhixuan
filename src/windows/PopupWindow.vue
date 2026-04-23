<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient } from '../utils/aiClient';
import { marked } from 'marked';
import { useSettingsStore, supportedLanguages } from '../stores/settings';
import { usePopupHistoryStore } from '../stores/popupHistory';

const appWindow = getCurrentWebviewWindow();
const clipboardText = ref('');
const settingsStore = useSettingsStore();
const historyStore = usePopupHistoryStore();
const isProcessing = ref(false);
const progress = ref(0);
const progressLabel = ref('处理中...');
const inputText = ref('');
const outputText = ref('');
let progressTimer: number | null = null;

interface ClipboardPayload {
  text: string;
  x: number;
  y: number;
}

const menuItems = [
  { icon: '🌍', label: 'Translate', action: 'translate' },
  { icon: '🧹', label: 'Clean to Word', action: 'clean' },
  { icon: '📚', label: 'Format Citation', action: 'citation' },
  { icon: '📷', label: 'Screenshot', action: 'screenshot' },
  { icon: '⚙️', label: 'Settings', action: 'settings' },
  { icon: '📋', label: 'History', action: 'history' },
  { icon: '⏻', label: 'Exit', action: 'exit' }
];

let blurTimeout: number | null = null;

const handleBlur = () => {
  // Don't auto-cancel when losing focus - let the AI request complete
  // The popup will be hidden but the request continues in background
  // Only auto-close if not processing
  blurTimeout = window.setTimeout(async () => {
    if (!isProcessing.value) {
      await closeWindow();
    }
  }, 500); // Wait 500ms before closing if not processing
};

const handleFocus = () => {
  // Cancel the blur timer if window regains focus
  if (blurTimeout) {
    clearTimeout(blurTimeout);
    blurTimeout = null;
  }
};

const handleDocumentClick = async (e: MouseEvent) => {
  // Close popup when clicking outside (except during processing)
  if (isProcessing.value) return;

  const target = e.target as HTMLElement;
  // If click is not on the popup window, close it
  if (!target.closest('.popup-window')) {
    await closeWindow();
  }
};

onMounted(async () => {
  // Listen for clipboard data from Rust
  await listen<ClipboardPayload>('clipboard-data', (event) => {
    clipboardText.value = event.payload.text;
  });

  // Listen for widget position updates while dragging
  await listen('widget-move-update', () => {
    // The popup window is positioned by Rust, no need to update from frontend
    // This listener is kept for potential future use
  });

  // Add blur/focus listeners for auto-hide
  window.addEventListener('blur', handleBlur);
  window.addEventListener('focus', handleFocus);

  // Add document click listener to close popup when clicking outside
  document.addEventListener('click', handleDocumentClick);

});

// Adjust window size based on content

const handleAction = async (action: string) => {
  console.log('[Popup] handleAction called with:', action, 'isProcessing:', isProcessing.value);
  if (action === 'settings') {
    // Open settings in main window
    await invoke('show_window_with_settings');
    await closeWindow();
    return;
  }

  if (action === 'history') {
    await invoke('show_window', { label: 'history' });
    await closeWindow();
    return;
  }

if (action === 'exit') {
    await invoke('quit_app');
    return;
  }

  if (action === 'screenshot') {
    await invoke('trigger_capture');
    await closeWindow();
    return;
  }

  if (isProcessing.value) return;

  // Allow actions to proceed even with empty clipboard (for testing)
  // but show error after if API call fails
  if (!clipboardText.value.trim()) {
    console.log('Clipboard is empty, showing settings');
    await invoke('show_window_with_settings');
    await closeWindow();
    return;
  }

  isProcessing.value = true;
  inputText.value = clipboardText.value;
  outputText.value = '';
  startFakeProgress();

  try {
    switch (action) {
      case 'translate':
        await handleTranslate();
        break;
      case 'clean':
        await handleCleanToWord();
        break;
      case 'citation':
        await handleFormatCitation();
        break;
    }
  } catch (error: any) {
    // Don't show error UI if user aborted
    if (error?.name === 'AbortError' || error?.message?.includes('abort')) {
      console.log('Action cancelled by user');
      return;
    }
    console.error('[Popup] Action failed with error:', error);
    // Update progress to show error state
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    progress.value = 0;
    progressLabel.value = `错误: ${error?.message || '操作失败'}`;
    // Auto-close after showing error
    await new Promise(resolve => setTimeout(resolve, 2000));
    await closeWindow();
    return;
  } finally {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    isProcessing.value = false;
  }
  await closeWindow();
};

const handleTranslate = async () => {
  console.log('[Popup] handleTranslate called, clipboard text length:', clipboardText.value.length);

  const { sourceLang, targetLang } = settingsStore.config.translateConfig;
  const sourceLabel = supportedLanguages.find(l => l.code === sourceLang)?.label || sourceLang;
  const targetLabel = supportedLanguages.find(l => l.code === targetLang)?.label || targetLang;

  const systemPrompt = sourceLang === 'auto'
    ? `You are a professional translator. Translate the given text to ${targetLabel}. Only output the translation, no explanations.`
    : `You are a professional translator. Translate the given text from ${sourceLabel} to ${targetLabel}. Only output the translation, no explanations.`;

  const messages = [
    {
      role: 'system' as const,
      content: systemPrompt
    },
    {
      role: 'user' as const,
      content: clipboardText.value
    }
  ];

  console.log('[Popup] calling aiClient.chatOnce...');
  const result = await aiClient.chatOnce(messages);
  console.log('[Popup] chatOnce returned, result length:', result.length);
  outputText.value = result;

  // Save to history
  try {
    historyStore.addItem({
      actionType: 'translate',
      actionLabel: '翻译',
      inputText: clipboardText.value,
      outputText: result
    });
    await invoke('notify_history_changed');
    console.log('[Popup] history saved, total items:', historyStore.items.length);
  } catch (e) {
    console.error('[Popup] Failed to save history:', e);
  }

  try {
    await invoke('set_clipboard_text', { text: result });
    console.log('[Popup] clipboard set successfully');
  } catch (e) {
    console.error('Failed to set clipboard:', e);
  }
  await completeProgress();
};

const handleCleanToWord = async () => {
  const hasMarkdown = /[#*`\[\]]/g.test(clipboardText.value);

  if (hasMarkdown) {
    const html = await marked(clipboardText.value);
    outputText.value = html;

    historyStore.addItem({
      actionType: 'clean',
      actionLabel: '清理文本',
      inputText: clipboardText.value,
      outputText: html
    });
    await invoke('notify_history_changed');

    try {
      await invoke('set_clipboard_html', { html });
    } catch (e) {
      console.error('Failed to set clipboard HTML:', e);
    }
    await completeProgress();
  } else {
    const messages = [
      {
        role: 'system' as const,
        content: 'Clean up the given text by removing extra whitespace, fixing formatting issues, and making it suitable for pasting into Word. Return the cleaned text only.'
      },
      {
        role: 'user' as const,
        content: clipboardText.value
      }
    ];

    const result = await aiClient.chatOnce(messages);
    outputText.value = result;

    historyStore.addItem({
      actionType: 'clean',
      actionLabel: '清理文本',
      inputText: clipboardText.value,
      outputText: result
    });
    await invoke('notify_history_changed');

    try {
      await invoke('set_clipboard_text', { text: result });
    } catch (e) {
      console.error('Failed to set clipboard text:', e);
    }
    await completeProgress();
  }
};

const handleFormatCitation = async () => {
  const messages = [
    {
      role: 'system' as const,
      content: 'Convert the given citation or reference into proper BibTeX format. Only output the BibTeX entry, no explanations.'
    },
    {
      role: 'user' as const,
      content: clipboardText.value
    }
  ];

  const result = await aiClient.chatOnce(messages);
  outputText.value = result;

  historyStore.addItem({
    actionType: 'citation',
    actionLabel: '格式引用',
    inputText: clipboardText.value,
    outputText: result
  });
  await invoke('notify_history_changed');

  try {
    await invoke('set_clipboard_text', { text: result });
  } catch (e) {
    console.error('Failed to set clipboard:', e);
  }
  await completeProgress();
};

const closeWindow = async () => {
  await appWindow.hide();
  await invoke('popup_closed');
};

const hidePopup = async () => {
  await invoke('hide_popup');
};

const cancelProgress = async () => {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  await aiClient.cancel();
  isProcessing.value = false;
  await closeWindow();
};

const startFakeProgress = () => {
  console.log('[Popup] startFakeProgress called');
  progress.value = 0;
  progressLabel.value = '处理中...';
  progressTimer = window.setInterval(() => {
    if (progress.value < 85) {
      // Simulate variable speed (slow start, faster middle, slow end)
      const increment = progress.value < 30 ? 2 : progress.value < 70 ? 3.5 : 1.5;
      progress.value = Math.min(85, progress.value + increment);
      console.log('[Popup] progress:', progress.value);
    }
  }, 80);
};

const completeProgress = async () => {
  console.log('[Popup] completeProgress called');
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
  progress.value = 100;
  progressLabel.value = '✓ 已复制到粘贴板';
  console.log('[Popup] progress set to 100%, waiting...');

  // Wait 5 seconds if output is available, otherwise 1.5 seconds
  const waitTime = outputText.value ? 5000 : 1500;
  await new Promise(resolve => setTimeout(resolve, waitTime));
  console.log('[Popup] completeProgress done, closing window');
};

onUnmounted(() => {
  window.removeEventListener('blur', handleBlur);
  window.removeEventListener('focus', handleFocus);
  document.removeEventListener('click', handleDocumentClick);

  if (blurTimeout) {
    clearTimeout(blurTimeout);
  }
});
</script>

<template>
  <div class="popup-window" @click.self="hidePopup">
    <!-- Menu View -->
    <div v-if="!isProcessing" class="menu-list">
      <div
        v-for="item in menuItems"
        :key="item.action"
        class="menu-item"
        @click.stop="handleAction(item.action)"
      >
        <span class="icon">{{ item.icon }}</span>
        <span class="label">{{ item.label }}</span>
      </div>
    </div>

    <!-- Processing View -->
    <div v-else class="processing-view">
      <div class="section">
        <div class="section-label">输入</div>
        <div class="text-preview input-preview">{{ inputText }}</div>
      </div>
      <div v-if="outputText" class="section">
        <div class="section-label">输出</div>
        <div class="text-preview output-preview">{{ outputText }}</div>
      </div>
      <div class="progress-info">
        <div class="progress-label">{{ progressLabel }}</div>
        <div class="progress-percent">{{ Math.round(progress) }}%</div>
      </div>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" :style="{ width: progress + '%' }"></div>
      </div>
      <button class="cancel-btn" @click="cancelProgress">终止任务</button>
    </div>
  </div>
</template>

<style scoped>
.popup-window {
  width: 100%;
  height: 100%;
  background: rgba(13, 13, 20, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  position: relative;
  overflow: hidden;
}

.menu-list {
  padding: 10px 8px;
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

.menu-item:hover {
  background: rgba(0, 229, 204, 0.08);
  color: #f0f0f5;
}

.menu-item:hover::before {
  transform: scaleY(1);
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

.processing-view {
  padding: 14px 12px;
}

.section {
  margin-bottom: 10px;
}

.section-label {
  color: rgba(0, 229, 204, 0.7);
  font-size: 10px;
  font-weight: 600;
  margin-bottom: 5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.text-preview {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 11px;
  color: rgba(240, 240, 245, 0.8);
  text-align: left;
  max-height: 60px;
  overflow: hidden;
  word-break: break-word;
  line-height: 1.4;
}

.input-preview {
  border-color: rgba(0, 229, 204, 0.15);
}

.output-preview {
  border-color: rgba(0, 229, 204, 0.25);
  color: #00e5cc;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 5px;
}

.progress-label {
  color: rgba(240, 240, 245, 0.7);
  font-size: 12px;
  letter-spacing: 0.02em;
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
}

.cancel-btn {
  padding: 6px 16px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  color: #ef4444;
  cursor: pointer;
  font-size: 11px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.cancel-btn:hover {
  background: rgba(239, 68, 68, 0.25);
  border-color: rgba(239, 68, 68, 0.5);
}
</style>
