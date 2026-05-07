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
  background: rgba(13, 13, 20, 0.98);
  backdrop-filter: blur(20px);
  display: flex;
  align-items: center;
  justify-content: center;
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
}

.progress-icon {
  font-size: 2.5rem;
  margin-bottom: 16px;
}

.progress-label {
  color: rgba(240, 240, 245, 0.7);
  font-size: 14px;
  margin-bottom: 14px;
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
  transition: width 0.15s ease;
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

.streaming-preview {
  margin-top: 16px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: rgba(240, 240, 245, 0.5);
  background: rgba(0, 0, 0, 0.2);
  padding: 10px;
  border-radius: 8px;
  max-height: 60px;
  overflow: hidden;
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
  align-items: center;
  gap: 10px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 229, 204, 0.03);
  color: rgba(240, 240, 245, 0.9);
  font-size: 14px;
  font-weight: 500;
}

.result-icon { font-size: 18px; }

.result-content {
  flex: 1;
  padding: 16px 20px;
  overflow-y: auto;
}

.result-content pre {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.6;
  margin: 0;
  background: rgba(0, 0, 0, 0.2);
  padding: 14px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.result-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(240, 240, 245, 0.45);
  font-size: 12px;
  background: rgba(0, 229, 204, 0.05);
}

.close-btn {
  padding: 5px 14px;
  background: rgba(0, 229, 204, 0.15);
  border: 1px solid rgba(0, 229, 204, 0.25);
  border-radius: 8px;
  color: #00e5cc;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
}

.close-btn:hover {
  background: rgba(0, 229, 204, 0.25);
}

.result-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.note-btn {
  padding: 5px 14px;
  background: rgba(61, 116, 231, 0.15);
  border: 1px solid rgba(61, 116, 231, 0.25);
  border-radius: 8px;
  color: #3d74e7;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.note-btn:hover {
  background: rgba(61, 116, 231, 0.25);
}

.note-btn.saved {
  background: rgba(34, 197, 94, 0.15);
  border-color: rgba(34, 197, 94, 0.3);
  color: #22c55e;
}
</style>