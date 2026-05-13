<script setup lang="ts">
import { ref } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';
import { useProjectStore } from '../stores/projects';
import { createExperimentSnapshot } from '../composables/useDatabase';
import { recordEvent } from '../composables/useEvents';

interface ScreenshotPayload {
  image: string;
  width: number;
  height: number;
  x: number;
  y: number;
}

const appWindow = getCurrentWebviewWindow();
const projectStore = useProjectStore();

const title = ref('');
const thought = ref('');
const screenshotDataUrl = ref<string | null>(null);
const capturing = ref(false);
const captureError = ref<string | null>(null);
const saving = ref(false);
const showToast = ref(false);

const closeWindow = () => {
  appWindow.hide();
};

const captureScreen = async () => {
  capturing.value = true;
  captureError.value = null;
  try {
    // Hide this window briefly so it doesn't appear in the screenshot.
    await appWindow.hide();
    await new Promise((resolve) => setTimeout(resolve, 250));
    const payload = await invoke<ScreenshotPayload>('capture_fullscreen');
    screenshotDataUrl.value = `data:image/png;base64,${payload.image}`;
  } catch (e) {
    captureError.value = e instanceof Error ? e.message : String(e);
    console.error('[Snapshot] capture failed:', e);
  } finally {
    await appWindow.show();
    await appWindow.setFocus();
    capturing.value = false;
  }
};

const clearScreenshot = () => {
  screenshotDataUrl.value = null;
};

const saveSnapshot = async () => {
  if (!title.value.trim()) return;

  saving.value = true;
  try {
    await createExperimentSnapshot({
      projectId: projectStore.currentProjectId,
      timestamp: Date.now(),
      title: title.value.trim(),
      type: 'screenshot',
      parameters: null,
      notes: thought.value.trim() || null,
      screenshotPath: screenshotDataUrl.value,
      tags: null,
    });

    recordEvent({
      event_type: 'experiment_snapshot',
      metadata: {
        type: 'idea_snapshot',
        title: title.value.trim(),
        hasScreenshot: !!screenshotDataUrl.value,
      },
    });

    showToast.value = true;
    setTimeout(() => {
      showToast.value = false;
      closeWindow();
    }, 1200);

    title.value = '';
    thought.value = '';
    screenshotDataUrl.value = null;
  } catch (e) {
    console.error('[Snapshot] save failed:', e);
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div class="snapshot-window">
    <div class="snapshot-header" @mousedown="appWindow.startDragging()">
      <span class="header-title">📸 创作快照与碎片记录</span>
      <button class="close-btn" @click="closeWindow">×</button>
    </div>

    <div class="snapshot-content">
      <div class="form-group">
        <label>灵感标题</label>
        <input
          v-model="title"
          type="text"
          placeholder="给这个一闪而过的念头起个名字..."
          @keydown.enter="saveSnapshot"
        />
      </div>

      <div class="form-group">
        <label>一闪而过的念头</label>
        <textarea
          v-model="thought"
          rows="5"
          placeholder="趁着脑袋里这股劲儿，把它先打下来。一两句话也行，一段话也行..."
        />
      </div>

      <div class="form-group">
        <div class="screenshot-label-row">
          <label>相关截图展示</label>
          <div class="screenshot-actions">
            <button class="ghost-btn" :disabled="capturing" @click="captureScreen">
              {{ capturing ? '截取中...' : screenshotDataUrl ? '🔄 重新截取' : '📷 截取屏幕' }}
            </button>
            <button
              v-if="screenshotDataUrl"
              class="ghost-btn danger"
              @click="clearScreenshot"
            >
              ✕ 清除
            </button>
          </div>
        </div>

        <div class="screenshot-preview" :class="{ empty: !screenshotDataUrl }">
          <img v-if="screenshotDataUrl" :src="screenshotDataUrl" alt="screenshot preview" />
          <div v-else class="screenshot-placeholder">
            <span class="placeholder-icon">🖼️</span>
            <span class="placeholder-hint">点击「截取屏幕」捕捉当前画面，给念头配个上下文</span>
          </div>
        </div>

        <div v-if="captureError" class="error-msg">截图失败：{{ captureError }}</div>
      </div>

      <button
        class="save-btn"
        :disabled="!title.trim() || saving"
        @click="saveSnapshot"
      >
        {{ saving ? '保存中...' : '保存这条碎片' }}
      </button>
    </div>

    <div v-if="showToast" class="toast">✓ 已存入碎片库</div>
  </div>
</template>

<style scoped>
.snapshot-window {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  color: var(--text-primary);
  overflow: hidden;
}

.snapshot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
}

.header-title {
  font-size: 0.85rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  transition: all 0.2s ease;
  -webkit-app-region: no-drag;
}

.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.snapshot-content {
  flex: 1;
  padding: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  overflow-y: auto;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.form-group label {
  font-size: 0.72rem;
  color: var(--text-secondary);
  font-weight: 600;
}

.form-group input,
.form-group textarea {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.55rem 0.65rem;
  color: var(--text-primary);
  font-size: 0.82rem;
  outline: none;
  resize: none;
  font-family: inherit;
  line-height: 1.5;
}

.form-group input:focus,
.form-group textarea:focus {
  border-color: var(--accent);
}

.screenshot-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.screenshot-actions {
  display: flex;
  gap: 0.35rem;
}

.ghost-btn {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  padding: 0.25rem 0.55rem;
  color: var(--text-secondary);
  font-size: 0.7rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.ghost-btn:hover {
  background: var(--bg-card-hover);
  color: var(--accent);
  border-color: var(--accent-border);
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ghost-btn.danger:hover {
  color: var(--error);
  border-color: rgba(234, 67, 53, 0.3);
  background: rgba(234, 67, 53, 0.08);
}

.screenshot-preview {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  overflow: hidden;
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.screenshot-preview.empty {
  border-style: dashed;
  padding: 1rem;
}

.screenshot-preview img {
  display: block;
  width: 100%;
  height: auto;
  max-height: 220px;
  object-fit: contain;
  background: #000;
}

.screenshot-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  text-align: center;
}

.placeholder-icon {
  font-size: 1.4rem;
  opacity: 0.6;
}

.placeholder-hint {
  font-size: 0.7rem;
  line-height: 1.4;
}

.error-msg {
  font-size: 0.7rem;
  color: var(--error);
  margin-top: 0.2rem;
}

.save-btn {
  margin-top: auto;
  padding: 0.6rem;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: var(--text-on-accent);
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.save-btn:hover {
  opacity: 0.9;
}

.save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toast {
  position: absolute;
  bottom: 1rem;
  right: 1rem;
  padding: 0.5rem 0.9rem;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  color: var(--accent);
  font-size: 0.8rem;
  font-weight: 600;
  animation: toast-in 0.3s ease;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
