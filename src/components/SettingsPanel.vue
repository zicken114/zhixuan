<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  providerPresets,
  useSettingsStore,
  type AIConfig,
  type ModelConfig,
  type ProviderPreset,
  type ProviderPresetId
} from '../stores/settings';

const settingsStore = useSettingsStore();
const localConfig = ref<AIConfig>(JSON.parse(JSON.stringify(settingsStore.config)));

const showTextPassword = ref(false);
const showVisionPassword = ref(false);
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const textExpanded = ref(true);
const visionExpanded = ref(false);
const shortcutsExpanded = ref(false);

const emit = defineEmits<{
  close: [];
}>();

onMounted(() => {
  localConfig.value = JSON.parse(JSON.stringify(settingsStore.config));
});

const textProviderPresets = computed(() =>
  providerPresets.filter((preset) => preset.supportsText)
);

const visionProviderPresets = computed(() =>
  providerPresets.filter((preset) => preset.supportsVision)
);

const getPreset = (presetId: ProviderPresetId): ProviderPreset =>
  providerPresets.find((preset) => preset.id === presetId) || providerPresets[0];

const applyPreset = (target: 'textConfig' | 'visionConfig', presetId: ProviderPresetId) => {
  const preset = getPreset(presetId);
  const nextConfig: ModelConfig = {
    ...localConfig.value[target],
    provider: preset.id
  };

  if (preset.baseUrl) {
    nextConfig.baseUrl = preset.baseUrl;
  }

  const suggestedModel =
    target === 'textConfig'
      ? (preset.textModel || localConfig.value[target].model)
      : (preset.visionModel || localConfig.value[target].model);

  if (suggestedModel) {
    nextConfig.model = suggestedModel;
  }

  localConfig.value[target] = nextConfig;
};

const saveSettings = async () => {
  saveStatus.value = 'saving';

  try {
    settingsStore.updateConfig(localConfig.value);
    saveStatus.value = 'saved';

    window.setTimeout(() => {
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

const toggleCard = (target: 'text' | 'vision' | 'shortcuts') => {
  if (target === 'text') textExpanded.value = !textExpanded.value;
  if (target === 'vision') visionExpanded.value = !visionExpanded.value;
  if (target === 'shortcuts') shortcutsExpanded.value = !shortcutsExpanded.value;
};
</script>

<template>
  <div class="settings-panel">
    <div class="header">
      <div>
        <h2>Settings</h2>
        <p class="header-subtitle">Choose a provider preset or keep using a custom OpenAI-compatible endpoint.</p>
      </div>
      <button class="close-btn" @click="emit('close')">x</button>
    </div>

    <div class="content">
      <div class="card">
        <button class="card-header" @click="toggleCard('text')">
          <div>
            <h3 class="card-title">Text Model</h3>
            <p class="card-subtitle">Chat, translation, citation formatting, and clipboard cleanup.</p>
          </div>
          <span class="card-toggle">{{ textExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="textExpanded" class="card-body">
          <div class="provider-group">
            <div class="provider-label">Provider Presets</div>
            <div class="provider-grid">
              <button
                v-for="preset in textProviderPresets"
                :key="`text-${preset.id}`"
                class="provider-chip"
                :class="{ active: localConfig.textConfig.provider === preset.id }"
                @click="applyPreset('textConfig', preset.id)"
              >
                {{ preset.label }}
              </button>
            </div>
            <p class="hint">{{ getPreset(localConfig.textConfig.provider).description }}</p>
          </div>

          <div class="form-group">
            <label class="label">Base URL</label>
            <input
              v-model="localConfig.textConfig.baseUrl"
              type="text"
              class="input"
              placeholder="https://api.openai.com/v1"
            />
            <p class="hint">Enter the API root. The app will automatically call `/chat/completions`.</p>
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
              <button class="toggle-password" @click="showTextPassword = !showTextPassword">
                {{ showTextPassword ? 'Hide' : 'Show' }}
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
            <p class="hint">Preset suggestions are provider-specific, but you can override them manually.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <button class="card-header" @click="toggleCard('vision')">
          <div>
            <h3 class="card-title">Vision Model</h3>
            <p class="card-subtitle">Screenshot OCR and multimodal extraction.</p>
          </div>
          <span class="card-toggle">{{ visionExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="visionExpanded" class="card-body">
          <div class="provider-group">
            <div class="provider-label">Provider Presets</div>
            <div class="provider-grid">
              <button
                v-for="preset in visionProviderPresets"
                :key="`vision-${preset.id}`"
                class="provider-chip"
                :class="{ active: localConfig.visionConfig.provider === preset.id }"
                @click="applyPreset('visionConfig', preset.id)"
              >
                {{ preset.label }}
              </button>
            </div>
            <p class="hint">{{ getPreset(localConfig.visionConfig.provider).description }}</p>
          </div>

          <div class="form-group">
            <label class="label">Base URL</label>
            <input
              v-model="localConfig.visionConfig.baseUrl"
              type="text"
              class="input"
              placeholder="https://api.openai.com/v1"
            />
            <p class="hint">Use a provider and model that accepts image content in OpenAI-compatible chat calls.</p>
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
              <button class="toggle-password" @click="showVisionPassword = !showVisionPassword">
                {{ showVisionPassword ? 'Hide' : 'Show' }}
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
            <p class="hint">Current built-in vision-safe presets: OpenAI and Bailian. Custom endpoints still work.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <button class="card-header" @click="toggleCard('shortcuts')">
          <div>
            <h3 class="card-title">Keyboard Shortcuts</h3>
            <p class="card-subtitle">Read-only shortcuts used by the current desktop build.</p>
          </div>
          <span class="card-toggle">{{ shortcutsExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="shortcutsExpanded" class="card-body">
          <div class="form-group">
            <label class="label">Popup Menu</label>
            <input
              v-model="localConfig.popupShortcut"
              type="text"
              class="input shortcut-input"
              placeholder="Alt+Q"
              readonly
            />
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
          </div>
        </div>
      </div>

      <button
        class="save-btn"
        :class="{ saved: saveStatus === 'saved' }"
        @click="saveSettings"
        :disabled="saveStatus === 'saving'"
      >
        <span v-if="saveStatus === 'idle'">Save Settings</span>
        <span v-else-if="saveStatus === 'saving'">Saving...</span>
        <span v-else-if="saveStatus === 'saved'">Saved</span>
        <span v-else>Error</span>
      </button>

      <button class="reset-btn" @click="resetSettings">
        Reset to Default
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  width: 100%;
  height: 100%;
  background:
    radial-gradient(circle at top right, rgba(0, 229, 204, 0.08), transparent 32%),
    linear-gradient(180deg, #fbfcfe 0%, #f4f7fb 100%);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid rgba(15, 23, 42, 0.08);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(10px);
}

.header h2 {
  font-size: 1.15rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
  font-family: 'Syne', sans-serif;
}

.header-subtitle {
  margin: 0.35rem 0 0;
  color: #6b7280;
  font-size: 0.82rem;
  line-height: 1.5;
}

.close-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  color: #6b7280;
  font-size: 1.2rem;
  cursor: pointer;
  width: 34px;
  height: 34px;
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
  padding: 1.25rem;
}

.card {
  margin-bottom: 1rem;
  background: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 18px;
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.05);
  overflow: hidden;
}

.card-header {
  width: 100%;
  border: none;
  background: transparent;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  text-align: left;
  padding: 1.2rem 1.25rem;
  cursor: pointer;
}

.card-title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 700;
  color: #00a896;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-family: 'Syne', sans-serif;
}

.card-subtitle {
  margin: 0.35rem 0 0;
  color: #6b7280;
  font-size: 0.82rem;
  line-height: 1.5;
}

.card-toggle {
  flex-shrink: 0;
  color: #3d74e7;
  font-size: 0.8rem;
  font-weight: 700;
}

.card-body {
  padding: 0 1.25rem 1.25rem;
}

.provider-group {
  margin-bottom: 1.2rem;
}

.provider-label {
  color: #374151;
  font-weight: 600;
  margin-bottom: 0.6rem;
  font-size: 0.8rem;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 0.65rem;
}

.provider-chip {
  width: 100%;
  border: none;
  border-radius: 999px;
  padding: 0.75rem 0.95rem;
  background: #eef2f7;
  color: #6b7280;
  cursor: pointer;
  font-weight: 700;
  font-size: 0.88rem;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.provider-chip:hover {
  transform: translateY(-1px);
  background: #e6ebf3;
  color: #374151;
}

.provider-chip.active {
  background: linear-gradient(135deg, #4f8cff 0%, #3d74e7 100%);
  color: #ffffff;
  box-shadow: 0 10px 22px rgba(61, 116, 231, 0.22);
}

.form-group {
  margin-bottom: 1rem;
}

.label {
  display: block;
  color: #374151;
  font-weight: 600;
  margin-bottom: 0.45rem;
  font-size: 0.8rem;
}

.input {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: #ffffff;
  border: 1px solid rgba(15, 23, 42, 0.1);
  border-radius: 12px;
  padding: 0.82rem 1rem;
  color: #111827;
  font-size: 0.9rem;
  outline: none;
  transition: all 0.2s ease;
  font-family: 'DM Sans', sans-serif;
}

.input:focus {
  border-color: #00d1bb;
  box-shadow: 0 0 0 4px rgba(0, 209, 187, 0.12);
}

.shortcut-input {
  background: #f3f4f6;
  cursor: not-allowed;
  color: #6b7280;
}

.hint {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: #8a94a6;
  line-height: 1.5;
}

.password-input {
  position: relative;
}

.password-input .input {
  padding-right: 5rem;
}

.toggle-password {
  position: absolute;
  right: 0.6rem;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(15, 23, 42, 0.06);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 700;
  color: #4b5563;
  padding: 0.42rem 0.72rem;
}

.save-btn {
  width: 100%;
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  border: none;
  border-radius: 12px;
  padding: 0.95rem;
  color: #06211f;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
  font-family: 'Syne', sans-serif;
  box-shadow: 0 8px 20px rgba(0, 184, 163, 0.22);
}

.save-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.save-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
}

.save-btn.saved {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.reset-btn {
  width: 100%;
  margin-top: 0.7rem;
  background: transparent;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 12px;
  padding: 0.9rem;
  color: #6b7280;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.86rem;
  font-family: 'DM Sans', sans-serif;
}

.reset-btn:hover {
  background: rgba(15, 23, 42, 0.03);
  color: #374151;
}
</style>
