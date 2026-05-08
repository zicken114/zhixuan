<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient } from '../utils/aiClient';
import { useProgress } from '../composables/useProgress';
import { useWindow } from '../composables/useWindow';
import { createReadingNote } from '../composables/useDatabase';
import { useReadingSessionState } from '../composables/useReadingSession';

const { hideCurrent } = useWindow();
const { progress, label: progressLabel, start: startProgress, complete: completeProgress, stop: stopProgress } = useProgress();
const { activeSession } = useReadingSessionState();

const resultData = ref<{ icon: string; label: string; content: string } | null>(null);
const isProcessing = ref(true);
const noteSaved = ref(false);

let unlistenComplete: UnlistenFn | null = null;
let unlistenError: UnlistenFn | null = null;
let unlistenStream: UnlistenFn | null = null;
let unlistenNewCapture: UnlistenFn | null = null;
const streamingContent = ref('');
let isClosing = false;

// Called when window needs to reset for new extraction
const resetForNewExtraction = () => {
  stopProgress();
  resultData.value = null;
  isProcessing.value = true;
  streamingContent.value = '';
  startProgress('正在提取...');
};

onMounted(async () => {
  // Reset state on mount - Vue component just mounted so we need fresh state
  resetForNewExtraction();

  unlistenComplete = await listen<{ icon: string; label: string; content: string }>('extraction-complete', (event) => {
    if (isClosing) return;
    resultData.value = event.payload;
    isProcessing.value = false;
    completeProgress();
  });

  unlistenError = await listen<string>('extraction-error', (event) => {
    if (isClosing) return;
    resultData.value = { icon: '❌', label: '错误', content: event.payload };
    isProcessing.value = false;
    completeProgress();
  });

  unlistenStream = await listen<string>('result-stream', (event) => {
    if (isClosing) return;
    streamingContent.value = event.payload;
  });

  // Listen for new capture started - reset state for new extraction
  unlistenNewCapture = await listen('new-capture-started', () => {
    isClosing = false;
    resetForNewExtraction();
  });

  // Emit ready event to signal that Vue has mounted and listeners are set up
  await invoke('result_window_ready');
});

onUnmounted(() => {
  if (unlistenComplete) unlistenComplete();
  if (unlistenError) unlistenError();
  if (unlistenStream) unlistenStream();
  if (unlistenNewCapture) unlistenNewCapture();
  stopProgress();
});

const closeWindow = async () => {
  if (isClosing) return;
  isClosing = true;
  try {
    await hideCurrent();
  } catch (e) {
    console.warn('[ResultWindow] closeWindow error:', e);
  }
};

const cancelExtraction = async () => {
  stopProgress();
  await aiClient.cancel();
  isProcessing.value = false;
  await closeWindow();
};

const saveToReadingNotes = async () => {
  if (!resultData.value?.content) return;

  const session = activeSession.value;
  if (!session) {
    // No active reading session — show a transient hint (could be expanded later)
    return;
  }

  try {
    const contentType = resultData.value.label.includes('公式')
      ? 'formula'
      : resultData.value.label.includes('表格')
        ? 'table'
        : 'text';

    await createReadingNote({
      sessionId: session.id ?? null,
      documentTitle: session.documentTitle,
      pageNumber: session.endPage,
      contentType: contentType as any,
      content: resultData.value.content,
      source: resultData.value.label
    });

    noteSaved.value = true;
    setTimeout(() => {
      noteSaved.value = false;
    }, 2000);
  } catch (e) {
    console.error('[ResultWindow] Failed to save reading note:', e);
  }
};
</script>

<template>
  <div class="result-window">
    <!-- Processing state -->
    <div v-if="isProcessing" class="processing-state">
      <div class="progress-container">
        <div class="progress-icon">🔍</div>
        <div class="progress-label">{{ progressLabel }}</div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" :style="{ width: progress + '%' }"></div>
        </div>
        <div class="progress-percent">{{ Math.round(progress) }}%</div>
        <button class="cancel-btn" @click="cancelExtraction">终止任务</button>
        <div v-if="streamingContent" class="streaming-preview">{{ streamingContent }}</div>
      </div>
    </div>

    <!-- Result state -->
    <div v-else-if="resultData" class="result-state">
      <div class="result-header">
        <span class="result-icon">{{ resultData.icon }}</span>
        <span class="result-label">{{ resultData.label }}</span>
      </div>
      <div class="result-content">
        <pre>{{ resultData.content }}</pre>
      </div>
      <div class="result-footer">
        <span>✓ 已复制到剪贴板，可直接粘贴</span>
        <div class="result-actions">
          <button
            v-if="activeSession"
            class="note-btn"
            :class="{ saved: noteSaved }"
            @click="saveToReadingNotes"
          >
            {{ noteSaved ? '已保存 ✓' : '加入阅读笔记' }}
          </button>
          <button class="close-btn" @click="closeWindow">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-window {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
}

.processing-state {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.progress-container {
  width: 80%;
  max-width: 320px;
  text-align: center;
  margin: auto;
}

.progress-icon {
  font-size: 2.5rem;
  margin-bottom: var(--space-md);
  color: var(--accent);
}

.progress-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-bottom: var(--space-md);
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
  margin-top: var(--space-lg);
  padding: var(--space-xs) var(--space-lg);
  background: var(--error-bg);
  border: 1px solid rgba(234, 67, 53, 0.2);
  color: var(--error);
  border-radius: var(--radius-sm);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.cancel-btn:hover {
  background: var(--error-bg);
}

.streaming-preview {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--bg-surface);
  padding: var(--space-sm);
  border-radius: var(--radius-sm);
  max-height: 60px;
  overflow: hidden;
  margin-top: var(--space-md);
  border: 1px solid var(--border-subtle);
  text-align: left;
  white-space: pre-wrap;
  word-break: break-all;
}

.result-state {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.result-header {
  display: flex;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-weight: 600;
  font-size: 0.875rem;
}

.result-icon { font-size: 18px; }

.result-content {
  flex: 1;
  padding: var(--space-md) var(--space-lg);
  overflow-y: auto;
}

.result-content pre {
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-surface);
  padding: var(--space-md);
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
  margin: 0;
}

.result-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-sm) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: 0.75rem;
  background: var(--bg-surface);
}

.result-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.note-btn {
  background: var(--info-bg);
  border: 1px solid rgba(95, 99, 104, 0.15);
  color: var(--info);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.note-btn:hover {
  background: var(--info-bg);
}

.note-btn.saved {
  background: var(--success-bg);
  border-color: rgba(52, 168, 83, 0.2);
  color: var(--success);
}

.close-btn {
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}
</style>