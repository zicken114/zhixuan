<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  useSettingsStore,
  type AIConfig,
  providerPresets,
} from '../stores/settings';
import { resetAllData } from '../composables/useDatabase';
import { setEmbedderMirrorUrl } from '../utils/embedder';
const appWindow = getCurrentWebviewWindow();
const settingsStore = useSettingsStore();

const handleDragStart = async (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, input, .settings-panel')) return;
  await appWindow.startDragging();
};
const localConfig = ref<AIConfig>(JSON.parse(JSON.stringify(settingsStore.config)));

const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');

const emit = defineEmits<{
  close: [];
}>();

onMounted(() => {
  localConfig.value = JSON.parse(JSON.stringify(settingsStore.config));
});

const saveSettings = async () => {
  saveStatus.value = 'saving';
  try {
    await settingsStore.updateConfig(localConfig.value);
    localConfig.value = JSON.parse(JSON.stringify(settingsStore.config));
    saveStatus.value = 'saved';
    setEmbedderMirrorUrl(localConfig.value.hfMirrorUrl);
    window.setTimeout(() => { saveStatus.value = 'idle'; }, 2000);
  } catch (error) {
    console.error('Failed to save settings:', error);
    saveStatus.value = 'error';
  }
};

const resetSettings = async () => {
  if (!confirm('确定要清空所有本地数据吗？此操作不可恢复。')) return;
  try {
    await resetAllData();
  } catch (e) {
    console.error('Failed to reset database:', e);
  }
  location.reload();
};

const toggleThemeMode = async () => {
  const next = localConfig.value.themeMode === 'dark' ? 'light' : 'dark';
  localConfig.value.themeMode = next;
  try {
    await settingsStore.updateConfig({ ...settingsStore.config, themeMode: next });
  } catch (error) {
    console.error('Failed to update theme mode:', error);
    localConfig.value.themeMode = settingsStore.config.themeMode;
  }
};

/**
 * 当用户选择 provider 时，自动填充对应厂商的 baseUrl 和 model。
 */
const onProviderChange = (type: 'text' | 'vision') => {
  const config = type === 'text' ? localConfig.value.textConfig : localConfig.value.visionConfig;
  const preset = providerPresets.find((p) => p.id === config.provider);
  if (!preset) return;

  if (preset.baseUrl) {
    config.baseUrl = preset.baseUrl;
  }
  const modelKey = type === 'text' ? 'textModel' : 'visionModel';
  const presetModel = (preset as Record<string, string | undefined>)[modelKey];
  if (presetModel) {
    config.model = presetModel;
  }
};
</script>

<template>
  <div class="settings-panel">
    <div class="drag-handle" @mousedown="handleDragStart"></div>

    <div class="header">
      <h2>设置</h2>
      <button class="close-btn" @click="emit('close')">x</button>
    </div>

    <div class="content">
      <!-- 文本模型 -->
      <div class="section">
        <h3 class="section-title">文本模型</h3>
        <div class="form-row">
          <span class="label">提供商</span>
          <select v-model="localConfig.textConfig.provider" class="input select" @change="onProviderChange('text')">
            <option v-for="p in providerPresets" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="form-row">
          <span class="label">API 地址</span>
          <input v-model="localConfig.textConfig.baseUrl" type="text" class="input wide" />
        </div>
        <div class="form-row">
          <span class="label">API Key</span>
          <input v-model="localConfig.textConfig.apiKey" type="password" class="input wide" placeholder="留空则使用内置 API" />
        </div>
        <div class="form-row">
          <span class="label">模型</span>
          <input v-model="localConfig.textConfig.model" type="text" class="input wide" />
        </div>
      </div>

      <!-- 视觉模型 -->
      <div class="section">
        <h3 class="section-title">视觉模型</h3>
        <div class="form-row">
          <span class="label">提供商</span>
          <select v-model="localConfig.visionConfig.provider" class="input select" @change="onProviderChange('vision')">
            <option v-for="p in providerPresets" :key="p.id" :value="p.id">{{ p.label }}</option>
          </select>
        </div>
        <div class="form-row">
          <span class="label">API 地址</span>
          <input v-model="localConfig.visionConfig.baseUrl" type="text" class="input wide" />
        </div>
        <div class="form-row">
          <span class="label">API Key</span>
          <input v-model="localConfig.visionConfig.apiKey" type="password" class="input wide" placeholder="留空则使用内置 API" />
        </div>
        <div class="form-row">
          <span class="label">模型</span>
          <input v-model="localConfig.visionConfig.model" type="text" class="input wide" />
        </div>
      </div>

      <!-- 外观 -->
      <div class="section">
        <h3 class="section-title">外观</h3>
        <div class="form-row">
          <div>
            <span class="label">主题模式</span>
            <p class="hint">切换亮色 / 暗色主题</p>
          </div>
          <button class="theme-btn" @click="toggleThemeMode">
            <span>{{ localConfig.themeMode === 'dark' ? '暗色' : '亮色' }}</span>
          </button>
        </div>
      </div>

      <!-- 快捷键 -->
      <div class="section">
        <h3 class="section-title">快捷键</h3>
        <p class="section-hint">以下快捷键为系统全局热键，暂不支持自定义</p>
        <div class="form-row">
          <span class="label">呼出悬浮菜单</span>
          <input v-model="localConfig.popupShortcut" type="text" class="input readonly" readonly />
        </div>
        <div class="form-row">
          <span class="label">开始截图</span>
          <input v-model="localConfig.captureShortcut" type="text" class="input readonly" readonly />
        </div>
      </div>

      <!-- 数据 -->
      <div class="section">
        <h3 class="section-title">数据管理</h3>
        <div class="form-row danger">
          <div>
            <span class="label">清空所有数据</span>
            <p class="hint">删除所有本地记录，包括对话、素材、统计数据等。操作不可恢复。</p>
          </div>
          <button class="danger-btn" @click="resetSettings">清空数据</button>
        </div>
      </div>
    </div>

    <!-- 底部保存 -->
    <div class="footer">
      <button
        class="save-btn"
        :class="{ saved: saveStatus === 'saved' }"
        @click="saveSettings"
        :disabled="saveStatus === 'saving'"
      >
        <span v-if="saveStatus === 'idle'">保存设置</span>
        <span v-else-if="saveStatus === 'saving'">保存中...</span>
        <span v-else-if="saveStatus === 'saved'">已保存</span>
        <span v-else>保存失败</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drag-handle {
  height: 32px;
  cursor: move;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-surface);
  flex-shrink: 0;
}

.header h2 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.2rem;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
}

.section {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 0 0 0.75rem;
}

.section-hint {
  font-size: 0.72rem;
  color: var(--text-dim);
  margin: -0.5rem 0 0.75rem;
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--border-subtle);
}

.form-row:last-child {
  border-bottom: none;
}

.form-row.danger {
  align-items: flex-start;
}

.form-row.danger .label {
  color: var(--error);
}

.label {
  display: block;
  color: var(--text-primary);
  font-weight: 500;
  font-size: 0.85rem;
}

.hint {
  margin: 0.2rem 0 0;
  font-size: 0.72rem;
  color: var(--text-dim);
}

.input {
  width: 120px;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  color: var(--text-primary);
  font-size: 0.85rem;
  outline: none;
  font-family: var(--font-body);
  text-align: center;
}

.input.wide {
  width: 220px;
  text-align: left;
}

.input.select {
  width: 140px;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.6rem center;
  padding-right: 1.8rem;
}

.input.readonly {
  background: var(--bg-surface);
  color: var(--text-muted);
  cursor: not-allowed;
}

.theme-btn {
  padding: 0.4rem 1rem;
  border: 1px solid var(--border-light);
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.theme-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
}

.danger-btn {
  padding: 0.4rem 0.9rem;
  border: 1px solid rgba(234, 67, 53, 0.3);
  border-radius: 8px;
  background: var(--error-bg);
  color: var(--error);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.danger-btn:hover {
  background: var(--error);
  color: #fff;
}

.footer {
  padding: 1rem 1.5rem;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  flex-shrink: 0;
}

.save-btn {
  width: 100%;
  background: var(--accent);
  border: none;
  border-radius: 10px;
  padding: 0.8rem;
  color: var(--text-on-accent);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.88rem;
}

.save-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.save-btn.saved {
  background: var(--success);
}
</style>
