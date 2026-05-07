<script setup lang="ts">
import { ref } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useProjectStore } from '../stores/projects';
import { createExperimentSnapshot, type ExperimentSnapshot } from '../composables/useDatabase';
import { recordEvent } from '../composables/useEvents';

const appWindow = getCurrentWebviewWindow();
const projectStore = useProjectStore();

const title = ref('');
const notes = ref('');
const parameters = ref('');
const selectedType = ref<ExperimentSnapshot['type']>('screenshot');
const saving = ref(false);
const showToast = ref(false);

const snapshotTypes: { value: ExperimentSnapshot['type']; label: string; icon: string }[] = [
  { value: 'screenshot', label: '截屏', icon: '📸' },
  { value: 'terminal', label: '终端', icon: '💻' },
  { value: 'code', label: '代码', icon: '📝' },
  { value: 'voice', label: '语音', icon: '🎙️' },
];

const closeWindow = () => {
  appWindow.hide();
};

const saveSnapshot = async () => {
  if (!title.value.trim()) return;

  saving.value = true;
  try {
    const params: Record<string, string> = {};
    if (parameters.value.trim()) {
      for (const line of parameters.value.split('\n')) {
        const [key, val] = line.split('=').map((s) => s.trim());
        if (key && val) params[key] = val;
      }
    }

    await createExperimentSnapshot({
      projectId: projectStore.currentProjectId,
      timestamp: Date.now(),
      title: title.value.trim(),
      type: selectedType.value,
      parameters: Object.keys(params).length > 0 ? params : null,
      notes: notes.value.trim() || null,
      screenshotPath: selectedType.value === 'screenshot' ? '[captured]' : null,
      tags: null
    });

    recordEvent({
      event_type: 'experiment_snapshot',
      metadata: { type: selectedType.value, title: title.value.trim() }
    });

    showToast.value = true;
    setTimeout(() => {
      showToast.value = false;
      closeWindow();
    }, 1500);

    title.value = '';
    notes.value = '';
    parameters.value = '';
  } catch (e) {
    console.error('[Experiment] Failed to save snapshot:', e);
  } finally {
    saving.value = false;
  }
};
</script>

<template>
  <div class="experiment-snapshot-window">
    <div class="snapshot-header" @mousedown="appWindow.startDragging()">
      <span class="header-title">⚡ 实验快照</span>
      <button class="close-btn" @click="closeWindow">×</button>
    </div>

    <div class="snapshot-content">
      <div class="type-selector">
        <button
          v-for="t in snapshotTypes"
          :key="t.value"
          class="type-btn"
          :class="{ active: selectedType === t.value }"
          @click="selectedType = t.value"
        >
          <span class="type-icon">{{ t.icon }}</span>
          <span class="type-label">{{ t.label }}</span>
        </button>
      </div>

      <div class="form-group">
        <label>标题</label>
        <input
          v-model="title"
          type="text"
          placeholder="例如：模型训练第一轮结果..."
          @keydown.enter="saveSnapshot"
        />
      </div>

      <div class="form-group">
        <label>参数（每行 key=value）</label>
        <textarea
          v-model="parameters"
          rows="2"
          placeholder="learning_rate=0.001&#10;batch_size=32"
        />
      </div>

      <div class="form-group">
        <label>备注</label>
        <textarea
          v-model="notes"
          rows="2"
          placeholder="补充说明..."
        />
      </div>

      <button
        class="save-btn"
        :disabled="!title.trim() || saving"
        @click="saveSnapshot"
      >
        {{ saving ? '保存中...' : '保存快照' }}
      </button>
    </div>

    <div v-if="showToast" class="toast">✓ 已保存</div>
  </div>
</template>

<style scoped>
.experiment-snapshot-window {
  width: 100%;
  height: 100%;
  background: rgba(7, 7, 13, 0.98);
  display: flex;
  flex-direction: column;
  color: rgba(240, 240, 245, 0.85);
  overflow: hidden;
}

.snapshot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(13, 13, 20, 0.5);
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
  color: rgba(240, 240, 245, 0.4);
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
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.8);
}

.snapshot-content {
  flex: 1;
  padding: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  overflow-y: auto;
}

.type-selector {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 0.4rem;
}

.type-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.5rem 0.25rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  color: rgba(240, 240, 245, 0.6);
  transition: all 0.15s ease;
}

.type-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.type-btn.active {
  background: rgba(0, 229, 204, 0.12);
  border-color: rgba(0, 229, 204, 0.25);
  color: #00e5cc;
}

.type-icon {
  font-size: 1.1rem;
}

.type-label {
  font-size: 0.65rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.form-group label {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.5);
  font-weight: 600;
}

.form-group input,
.form-group textarea {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  color: #f0f0f5;
  font-size: 0.8rem;
  outline: none;
  resize: none;
  font-family: inherit;
}

.form-group input:focus,
.form-group textarea:focus {
  border-color: #00d1bb;
}

.save-btn {
  margin-top: auto;
  padding: 0.55rem;
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  border: none;
  border-radius: 8px;
  color: #06211f;
  font-size: 0.82rem;
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
  background: rgba(0, 229, 204, 0.15);
  border: 1px solid rgba(0, 229, 204, 0.3);
  border-radius: 8px;
  color: #00e5cc;
  font-size: 0.8rem;
  font-weight: 600;
  animation: toast-in 0.3s ease;
}

@keyframes toast-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
