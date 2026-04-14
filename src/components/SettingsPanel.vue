<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettingsStore } from '../stores/settings';

const settingsStore = useSettingsStore();
const localConfig = ref({
  textConfig: {
    baseUrl: '',
    apiKey: '',
    model: ''
  },
  visionConfig: {
    baseUrl: '',
    apiKey: '',
    model: ''
  },
  autoHideOnBlur: true,
  popupShortcut: 'Alt+Q',
  captureShortcut: 'Alt+S'
});

const showTextPassword = ref(false);
const showVisionPassword = ref(false);
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');

onMounted(() => {
  // Deep clone to avoid mutating store directly
  localConfig.value = JSON.parse(JSON.stringify(settingsStore.config));
});

const saveSettings = async () => {
  saveStatus.value = 'saving';

  try {
    settingsStore.updateConfig(localConfig.value);
    saveStatus.value = 'saved';

    setTimeout(() => {
      saveStatus.value = 'idle';
    }, 2000);
  } catch (error) {
    console.error('Failed to save settings:', error);
    saveStatus.value = 'error';
  }
};

const resetSettings = () => {
  localStorage.clear();
  location.reload();
};

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="settings-panel">
    <div class="header">
      <h2>Settings</h2>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>

    <div class="content">
      <!-- Text Model Section -->
      <div class="section">
        <h3 class="section-title">Text Model (对话/翻译)</h3>

        <div class="form-group">
          <label class="label">Base URL</label>
          <input
            v-model="localConfig.textConfig.baseUrl"
            type="text"
            class="input"
            placeholder="https://api.openai.com/v1"
          />
          <p class="hint">OpenAI-compatible API endpoint</p>
        </div>

        <div class="form-group">
          <label class="label">API Key</label>
          <div class="password-input">
            <input
              v-model="localConfig.textConfig.apiKey"
              :type="showTextPassword ? 'text' : 'password'"
              class="input"
              placeholder="sk-..."
            />
            <button
              class="toggle-password"
              @click="showTextPassword = !showTextPassword"
            >
              {{ showTextPassword ? '👁️' : '👁️‍🗨️' }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="label">Model</label>
          <input
            v-model="localConfig.textConfig.model"
            type="text"
            class="input"
            placeholder="gpt-4o"
          />
          <p class="hint">Model for text tasks (chat, translation)</p>
        </div>
      </div>

      <!-- Vision Model Section -->
      <div class="section">
        <h3 class="section-title">Vision Model (截图识别)</h3>

        <div class="form-group">
          <label class="label">Base URL</label>
          <input
            v-model="localConfig.visionConfig.baseUrl"
            type="text"
            class="input"
            placeholder="https://api.openai.com/v1"
          />
          <p class="hint">OpenAI-compatible API endpoint</p>
        </div>

        <div class="form-group">
          <label class="label">API Key</label>
          <div class="password-input">
            <input
              v-model="localConfig.visionConfig.apiKey"
              :type="showVisionPassword ? 'text' : 'password'"
              class="input"
              placeholder="sk-..."
            />
            <button
              class="toggle-password"
              @click="showVisionPassword = !showVisionPassword"
            >
              {{ showVisionPassword ? '👁️' : '👁️‍🗨️' }}
            </button>
          </div>
        </div>

        <div class="form-group">
          <label class="label">Model</label>
          <input
            v-model="localConfig.visionConfig.model"
            type="text"
            class="input"
            placeholder="gpt-4o"
          />
          <p class="hint">Model for image analysis (screenshot extraction)</p>
        </div>
      </div>

      <!-- Keyboard Shortcuts Section -->
      <div class="section">
        <h3 class="section-title">Keyboard Shortcuts</h3>

        <div class="form-group">
          <label class="label">Popup Menu</label>
          <input
            v-model="localConfig.popupShortcut"
            type="text"
            class="input shortcut-input"
            placeholder="Alt+Q"
            readonly
          />
          <p class="hint">Global shortcut to show popup menu</p>
        </div>

        <div class="form-group">
          <label class="label">Screen Capture</label>
          <input
            v-model="localConfig.captureShortcut"
            type="text"
            class="input shortcut-input"
            placeholder="Alt+S"
            readonly
          />
          <p class="hint">Global shortcut to capture screen</p>
        </div>
      </div>

      <button
        class="save-btn"
        :class="{ 'saving': saveStatus === 'saving', 'saved': saveStatus === 'saved' }"
        @click="saveSettings"
        :disabled="saveStatus === 'saving'"
      >
        <span v-if="saveStatus === 'idle'">Save Settings</span>
        <span v-else-if="saveStatus === 'saving'">Saving...</span>
        <span v-else-if="saveStatus === 'saved'">✓ Saved</span>
        <span v-else>Error</span>
      </button>

      <button
        class="reset-btn"
        @click="resetSettings"
      >
        Reset to Default
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  width: 100%;
  height: 100%;
  background: #f8f9fb;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
}

/* Subtle background pattern */
.settings-panel::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background:
    radial-gradient(ellipse at 100% 0%, rgba(0, 229, 204, 0.04) 0%, transparent 50%),
    radial-gradient(ellipse at 0% 100%, rgba(0, 229, 204, 0.03) 0%, transparent 50%);
  pointer-events: none;
}

.header {
  padding: 1.5rem 1.75rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(10px);
  position: relative;
  z-index: 1;
}

.header h2 {
  font-size: 1.2rem;
  font-weight: 700;
  color: #0f1419;
  margin: 0;
  font-family: 'Syne', sans-serif;
  letter-spacing: -0.01em;
}

.close-btn {
  background: none;
  border: none;
  color: #6b7280;
  font-size: 1.75rem;
  cursor: pointer;
  padding: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.08);
  color: #ef4444;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 1.75rem;
  position: relative;
  z-index: 1;
}

.section {
  margin-bottom: 2rem;
  padding-bottom: 1.75rem;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.section:last-of-type {
  border-bottom: none;
}

.section-title {
  font-size: 0.7rem;
  font-weight: 700;
  color: #00b8a3;
  margin: 0 0 1.25rem 0;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-family: 'Syne', sans-serif;
}

.form-group {
  margin-bottom: 1.25rem;
}

.label {
  display: block;
  color: #374151;
  font-weight: 600;
  margin-bottom: 0.5rem;
  font-size: 0.8rem;
  letter-spacing: 0.01em;
}

.input {
  width: 100%;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  padding: 0.8rem 1rem;
  color: #111827;
  font-size: 0.875rem;
  outline: none;
  transition: all 0.2s ease;
  font-family: 'DM Sans', sans-serif;
}

.input:focus {
  border-color: #00e5cc;
  box-shadow: 0 0 0 3px rgba(0, 229, 204, 0.12), 0 2px 8px rgba(0, 0, 0, 0.04);
}

.input::placeholder {
  color: #9ca3af;
}

.shortcut-input {
  background: #f3f4f6;
  cursor: not-allowed;
  color: #6b7280;
}

.hint {
  margin-top: 0.35rem;
  font-size: 0.72rem;
  color: #9ca3af;
  letter-spacing: 0.01em;
}

.password-input {
  position: relative;
}

.toggle-password {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.1rem;
  padding: 0.25rem;
  transition: transform 0.15s ease;
}

.toggle-password:hover {
  transform: translateY(-50%) scale(1.1);
}

.save-btn {
  width: 100%;
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  border: none;
  border-radius: 10px;
  padding: 1rem;
  color: #07070d;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.875rem;
  font-family: 'Syne', sans-serif;
  letter-spacing: 0.02em;
  box-shadow: 0 2px 12px rgba(0, 229, 204, 0.25);
}

.save-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 18px rgba(0, 229, 204, 0.35);
}

.save-btn:active:not(:disabled) {
  transform: translateY(0);
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.save-btn.saved {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  box-shadow: 0 2px 12px rgba(16, 185, 129, 0.25);
}

.reset-btn {
  width: 100%;
  margin-top: 0.6rem;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 10px;
  padding: 0.85rem;
  color: #6b7280;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.85rem;
  font-family: 'DM Sans', sans-serif;
}

.reset-btn:hover {
  background: rgba(0, 0, 0, 0.02);
  border-color: rgba(0, 0, 0, 0.15);
  color: #374151;
}
</style>