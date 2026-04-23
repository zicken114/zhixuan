<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { usePopupHistoryStore } from '../stores/popupHistory';

const appWindow = getCurrentWebviewWindow();
const historyStore = usePopupHistoryStore();

let unlistenFocus: (() => void) | null = null;
let unlistenHistoryChanged: (() => void) | null = null;

const refreshHistory = () => {
  historyStore.loadFromStorage();
  console.log('[History] Loaded history, items:', historyStore.items.length);
};

const getActionIcon = (actionType: string) => {
  switch (actionType) {
    case 'translate': return '🌍';
    case 'clean': return '🧹';
    case 'citation': return '📚';
    case 'extract-text': return '📝';
    case 'extract-latex': return '🔢';
    case 'extract-math': return '📐';
    case 'extract-table': return '📊';
    default: return '📋';
  }
};

const getActionLabel = (actionType: string) => {
  switch (actionType) {
    case 'translate': return '翻译';
    case 'clean': return '清理文本';
    case 'citation': return '格式引用';
    case 'extract-text': return '提取文字';
    case 'extract-latex': return '提取LaTeX';
    case 'extract-math': return '提取公式';
    case 'extract-table': return '提取表格';
    default: return actionType;
  }
};

const formatTime = (timestamp: number) => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  const timeStr = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

  if (isToday) {
    return `今天 ${timeStr}`;
  }
  return `${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })} ${timeStr}`;
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
    console.log('[History] Image copied to clipboard');
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
  await appWindow.hide();
};

onMounted(async () => {
  refreshHistory();

  // Listen for history changes from other windows
  unlistenHistoryChanged = await listen('history-changed', () => {
    console.log('[History] Received history-changed event');
    refreshHistory();
  });

  unlistenFocus = await appWindow.onFocusChanged(({ payload: focused }) => {
    if (!focused) {
      closeWindow();
    }
  });
});

onUnmounted(() => {
  if (unlistenFocus) unlistenFocus();
  if (unlistenHistoryChanged) unlistenHistoryChanged();
});
</script>

<template>
  <div class="history-window">
    <!-- Header -->
    <div class="header" @mousedown="appWindow.startDragging()">
      <h2 class="title">历史记录</h2>
      <div class="header-actions">
        <button v-if="historyStore.items.length > 0" class="clear-btn" @click.stop="clearAll">
          清空
        </button>
        <button class="close-btn" @click.stop="closeWindow">×</button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="historyStore.items.length === 0" class="empty-state">
      <div class="empty-icon">📋</div>
      <div class="empty-text">暂无历史记录</div>
      <div class="empty-hint">使用翻译、清理等功能后会自动记录</div>
    </div>

    <!-- History list -->
    <div v-else class="history-list">
      <div
        v-for="item in historyStore.items"
        :key="item.id"
        class="history-item"
      >
        <!-- Item header -->
        <div class="item-header">
          <div class="item-action">
            <span class="action-icon">{{ getActionIcon(item.actionType) }}</span>
            <span class="action-label">{{ getActionLabel(item.actionType) }}</span>
          </div>
          <div class="item-meta">
            <span class="item-time">{{ formatTime(item.timestamp) }}</span>
            <button class="delete-btn" @click.stop="deleteItem(item.id)" title="删除">×</button>
          </div>
        </div>

        <!-- Input section - show thumbnail for screenshots -->
        <div class="section">
          <div class="section-label">输入</div>
          <div class="section-content">
            <div v-if="item.inputImage" class="thumbnail-container">
              <img :src="'data:image/png;base64,' + item.inputImage" alt="截图" class="thumbnail" />
              <button class="copy-btn thumbnail-copy-btn" @click.stop="copyImage(item.inputImage)" title="复制图片">复制图片</button>
            </div>
            <pre v-else class="text-content">{{ item.inputText }}</pre>
            <button v-if="!item.inputImage" class="copy-btn" @click.stop="copyToClipboard(item.inputText)" title="复制输入">复制</button>
          </div>
        </div>

        <!-- Output section -->
        <div class="section">
          <div class="section-label">输出</div>
          <div class="section-content">
            <pre class="text-content output">{{ item.outputText }}</pre>
            <button class="copy-btn" @click.stop="copyToClipboard(item.outputText)" title="复制输出">复制</button>
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
  background: rgba(13, 13, 20, 0.98);
  backdrop-filter: blur(20px);
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 229, 204, 0.03);
  cursor: move;
  -webkit-app-region: drag;
}

.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f0f0f5;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.clear-btn {
  padding: 4px 12px;
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: #ef4444;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.15s;
}

.clear-btn:hover {
  background: rgba(239, 68, 68, 0.25);
}

.close-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: rgba(240, 240, 245, 0.7);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0;
  transition: all 0.15s;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.3);
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
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
  color: rgba(240, 240, 245, 0.6);
  font-weight: 500;
}

.empty-hint {
  font-size: 12px;
  color: rgba(240, 240, 245, 0.35);
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
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
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
  color: #00e5cc;
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-time {
  font-size: 11px;
  color: rgba(240, 240, 245, 0.4);
}

.delete-btn {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 4px;
  color: #ef4444;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: all 0.15s;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.25);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  font-size: 10px;
  font-weight: 600;
  color: rgba(0, 229, 204, 0.6);
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
  border: 1px solid rgba(0, 229, 204, 0.15);
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
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 12px;
  color: rgba(240, 240, 245, 0.8);
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  max-height: 80px;
  overflow: hidden;
}

.text-content.output {
  color: #00e5cc;
  border-color: rgba(0, 229, 204, 0.15);
}

.copy-btn {
  flex-shrink: 0;
  padding: 4px 10px;
  background: rgba(0, 229, 204, 0.1);
  border: 1px solid rgba(0, 229, 204, 0.2);
  border-radius: 6px;
  color: #00e5cc;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
  align-self: flex-start;
}

.copy-btn:hover {
  background: rgba(0, 229, 204, 0.2);
}
</style>
