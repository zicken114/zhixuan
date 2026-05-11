<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { usePopupHistoryStore } from '../stores/popupHistory';
import { useSettingsStore } from '../stores/settings';
import { useI18n } from '../composables/useI18n';

const historyStore = usePopupHistoryStore();
const settingsStore = useSettingsStore();
const { t } = useI18n();
const appWindow = getCurrentWebviewWindow();

let unlistenHistoryChanged: (() => void) | null = null;

const handleWindowMouseDown = async (e: MouseEvent) => {
  const target = e.target as HTMLElement | null;
  if (!target) return;

  // 排除可交互元素和内容区域
  if (target.closest('button, input, textarea, pre, .section-content, .copy-btn, .thumbnail')) {
    return;
  }

  // 只在 header 区域触发拖拽
  if (!target.closest('.header')) {
    return;
  }

  await appWindow.startDragging();
};

const refreshHistory = () => {
  historyStore.loadFromStorage();
};

const getActionIcon = (actionType: string) => {
  switch (actionType) {
    case 'translate': return '🌍';
    case 'clean': return '🧹';
    case 'citation': return '📚';
    case 'extract-text': return '📝';
    case 'extract-latex': return '🧮';
    case 'extract-math': return '∑';
    case 'extract-table': return '📊';
    case 'screenshot': return '📸';
    default: return '🕘';
  }
};

const getActionLabel = (actionType: string) => {
  switch (actionType) {
    case 'translate': return t('popup.translate');
    case 'clean': return t('popup.clean');
    case 'citation': return t('popup.formatCitation');
    case 'history': return t('popup.history');
    case 'screenshot': return t('common.screenshot');
    case 'extract-text': return t('history.extractText');
    case 'extract-latex': return t('history.extractLatex');
    case 'extract-math': return t('history.extractMath');
    case 'extract-table': return t('history.extractTable');
    default: return actionType;
  }
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  return date.toLocaleString();
};

const copyToClipboard = async (text: string) => {
  try {
    await invoke('set_clipboard_text', { text });
  } catch (e) {
    console.error('Failed to copy:', e);
  }
};

const copyImage = async (base64Data: string) => {
  try {
    await invoke('set_clipboard_image', { imageBase64: base64Data });
  } catch (e) {
    console.error('Failed to copy image:', e);
  }
};

const deleteItem = async (id: string) => {
  historyStore.deleteItem(id);
  await invoke('notify_history_changed');
};

const clearAll = async () => {
  historyStore.clearAll();
  await invoke('notify_history_changed');
};

const closeWindow = async () => {
  await invoke('hide_window', { label: 'history' });
};

onMounted(async () => {
  await settingsStore.init();
  refreshHistory();

  unlistenHistoryChanged = await listen('history-changed', () => {
    refreshHistory();
  });
});

onUnmounted(() => {
  if (unlistenHistoryChanged) unlistenHistoryChanged();
});
</script>

<template>
  <div class="history-window" @mousedown="handleWindowMouseDown">
    <div class="header">
      <h2 class="title">{{ t('history.title') }}</h2>
      <div class="header-actions">
        <button v-if="historyStore.items.length > 0" class="clear-btn" @click.stop="clearAll">
          {{ t('history.clearAll') }}
        </button>
        <button class="close-btn" @click.stop="closeWindow">×</button>
      </div>
    </div>

    <div v-if="historyStore.items.length === 0" class="empty-state">
      <div class="empty-icon">🕘</div>
      <div class="empty-text">{{ t('history.emptyTitle') }}</div>
      <div class="empty-hint">{{ t('history.emptyHint') }}</div>
    </div>

    <div v-else class="history-list">
      <div
        v-for="item in historyStore.items"
        :key="item.id"
        class="history-item"
      >
        <div class="item-header">
          <div class="item-action">
            <span class="action-icon">{{ getActionIcon(item.actionType) }}</span>
            <span class="action-label">{{ getActionLabel(item.actionType) }}</span>
          </div>
          <div class="item-meta">
            <span class="item-time">{{ formatTime(item.timestamp) }}</span>
            <button class="delete-btn" @click.stop="deleteItem(item.id)" :title="t('history.delete')">×</button>
          </div>
        </div>

        <div class="section">
          <div class="section-label">{{ t('history.input') }}</div>
          <div class="section-content">
            <div v-if="item.inputImage" class="thumbnail-container">
              <img :src="'data:image/png;base64,' + item.inputImage" alt="screenshot" class="thumbnail" />
              <button class="copy-btn thumbnail-copy-btn" @click.stop="copyImage(item.inputImage)" :title="t('history.copyImage')">{{ t('history.copyImage') }}</button>
            </div>
            <pre v-else class="text-content">{{ item.inputText }}</pre>
            <button v-if="!item.inputImage" class="copy-btn" @click.stop="copyToClipboard(item.inputText)" :title="t('common.copy')">{{ t('common.copy') }}</button>
          </div>
        </div>

        <div class="section">
          <div class="section-label">{{ t('history.output') }}</div>
          <div class="section-content">
            <pre class="text-content output">{{ item.outputText }}</pre>
            <button class="copy-btn" @click.stop="copyToClipboard(item.outputText)" :title="t('common.copy')">{{ t('common.copy') }}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-window {
  width: 100%;
  height: 100%;
  background: var(--bg-elevated);
  backdrop-filter: blur(20px);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  border: 1px solid var(--border-light);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: move;
  -webkit-app-region: drag;
}

.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

button {
  -webkit-app-region: no-drag;
}

.clear-btn {
  padding: 4px 12px;
  background: var(--error-bg);
  border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
  border-radius: var(--radius-sm);
  color: var(--error);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.clear-btn:hover {
  background: color-mix(in srgb, var(--error-bg) 80%, var(--error) 20%);
}

.close-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0;
  transition: all 0.15s;
}

.close-btn:hover {
  background: var(--error-bg);
  border-color: color-mix(in srgb, var(--error) 35%, transparent);
  color: var(--error);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 40px;
}

.empty-icon {
  font-size: 3rem;
  margin-bottom: 8px;
}

.empty-text {
  font-size: 15px;
  color: var(--text-secondary);
  font-weight: 500;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.history-item {
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.item-action {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-icon {
  font-size: 16px;
}

.action-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-time {
  font-size: 11px;
  color: var(--text-muted);
}

.delete-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--error-bg);
  border: 1px solid color-mix(in srgb, var(--error) 30%, transparent);
  border-radius: 4px;
  color: var(--error);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: all 0.15s;
}

.delete-btn:hover {
  background: color-mix(in srgb, var(--error-bg) 80%, var(--error) 20%);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.thumbnail-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.thumbnail {
  max-width: 100%;
  max-height: 80px;
  border-radius: 6px;
  border: 1px solid var(--accent-border);
  cursor: pointer;
  transition: opacity 0.15s;
}

.thumbnail:hover {
  opacity: 0.85;
}

.thumbnail-copy-btn {
  align-self: flex-start;
}

.text-content {
  flex: 1;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-family: inherit;
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  max-height: 80px;
  overflow: hidden;
}

.text-content.output {
  color: var(--text-primary);
  border-color: var(--accent-border);
  background: color-mix(in srgb, var(--accent-subtle) 35%, var(--bg-card) 65%);
}

.copy-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
  align-self: flex-start;
}

.copy-btn:hover {
  background: color-mix(in srgb, var(--accent-subtle) 70%, var(--accent) 30%);
}
</style>
