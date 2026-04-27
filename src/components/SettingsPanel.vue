<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  providerPresets,
  supportedLanguages,
  useSettingsStore,
  type AIConfig,
  type ModelConfig,
  type ProviderPreset,
  type ProviderPresetId
} from '../stores/settings';
import { resetAllData } from '../composables/useDatabase';
import { setEmbedderMirrorUrl } from '../utils/embedder';

const appWindow = getCurrentWebviewWindow();
const settingsStore = useSettingsStore();

const handleDragStart = async (e: MouseEvent) => {
  // Don't drag if clicking interactive elements inside settings
  if ((e.target as HTMLElement).closest('button, input, .settings-panel')) return;
  await appWindow.startDragging();
};
const localConfig = ref<AIConfig>(JSON.parse(JSON.stringify(settingsStore.config)));

const showTextPassword = ref(false);
const showVisionPassword = ref(false);
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'error'>('idle');
const textExpanded = ref(true);
const visionExpanded = ref(false);
const shortcutsExpanded = ref(false);
const translateExpanded = ref(false);
const privacyExpanded = ref(false);
const routingExpanded = ref(false);
const knowledgeExpanded = ref(false);
const externalToolsExpanded = ref(false);

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

const getProfileName = (profileId: string): string => {
  const profile = localConfig.value.routing.profiles.find((p) => p.id === profileId);
  return profile?.name || profileId;
};

const applyPreset = (target: 'textConfig' | 'visionConfig', presetId: ProviderPresetId) => {
  const currentProvider = localConfig.value[target].provider;
  const currentKey = localConfig.value[target].apiKey;

  // Save current API key under its provider
  if (currentKey.trim()) {
    localConfig.value.providerKeys = {
      ...localConfig.value.providerKeys,
      [currentProvider]: currentKey
    };
  }

  const preset = getPreset(presetId);

  // Restore API key for the new provider if previously saved
  const restoredKey = localConfig.value.providerKeys[presetId] || '';

  const nextConfig: ModelConfig = {
    ...localConfig.value[target],
    provider: preset.id,
    apiKey: restoredKey
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
    // Sync current API keys into providerKeys before saving
    const updatedProviderKeys = {
      ...localConfig.value.providerKeys,
      [localConfig.value.textConfig.provider]: localConfig.value.textConfig.apiKey,
      [localConfig.value.visionConfig.provider]: localConfig.value.visionConfig.apiKey
    };

    const configToSave = {
      ...localConfig.value,
      providerKeys: updatedProviderKeys
    };

    await settingsStore.updateConfig(configToSave);
    localConfig.value = JSON.parse(JSON.stringify(settingsStore.config));
    saveStatus.value = 'saved';

    // Apply embedding mirror URL immediately
    setEmbedderMirrorUrl(localConfig.value.hfMirrorUrl);

    window.setTimeout(() => {
      saveStatus.value = 'idle';
    }, 2000);
  } catch (error) {
    console.error('Failed to save settings:', error);
    saveStatus.value = 'error';
  }
};

const resetSettings = async () => {
  try {
    await resetAllData();
  } catch (e) {
    console.error('Failed to reset database:', e);
  }
  location.reload();
};

const toggleCard = (target: 'text' | 'vision' | 'shortcuts' | 'translate' | 'privacy' | 'routing' | 'knowledge' | 'external') => {
  if (target === 'text') textExpanded.value = !textExpanded.value;
  if (target === 'vision') visionExpanded.value = !visionExpanded.value;
  if (target === 'shortcuts') shortcutsExpanded.value = !shortcutsExpanded.value;
  if (target === 'translate') translateExpanded.value = !translateExpanded.value;
  if (target === 'privacy') privacyExpanded.value = !privacyExpanded.value;
  if (target === 'routing') routingExpanded.value = !routingExpanded.value;
  if (target === 'knowledge') knowledgeExpanded.value = !knowledgeExpanded.value;
  if (target === 'external') externalToolsExpanded.value = !externalToolsExpanded.value;
};
</script>

<template>
  <div class="settings-panel">
    <div class="drag-handle" @mousedown="handleDragStart"></div>
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
        <button class="card-header" @click="toggleCard('translate')">
          <div>
            <h3 class="card-title">Translation</h3>
            <p class="card-subtitle">Configure your translation language preference.</p>
          </div>
          <span class="card-toggle">{{ translateExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="translateExpanded" class="card-body">
          <div class="form-group">
            <label class="label">Source Language</label>
            <select v-model="localConfig.translateConfig.sourceLang" class="input select-input">
              <option v-for="lang in supportedLanguages" :key="lang.code" :value="lang.code">
                {{ lang.label }}
              </option>
            </select>
            <p class="hint">The language of the text you want to translate.</p>
          </div>

          <div class="form-group">
            <label class="label">Target Language</label>
            <select v-model="localConfig.translateConfig.targetLang" class="input select-input">
              <option v-for="lang in supportedLanguages.filter(l => l.code !== 'auto')" :key="lang.code" :value="lang.code">
                {{ lang.label }}
              </option>
            </select>
            <p class="hint">The language you want to translate into.</p>
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

      <div class="card">
        <button class="card-header" @click="toggleCard('privacy')">
          <div>
            <h3 class="card-title">Privacy</h3>
            <p class="card-subtitle">Control data collection and local storage.</p>
          </div>
          <span class="card-toggle">{{ privacyExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="privacyExpanded" class="card-body">
          <div class="form-group toggle-row">
            <div>
              <label class="label">Incognito Mode</label>
              <p class="hint">When enabled, the app stops recording all activity events. Other features are unaffected.</p>
            </div>
            <button
              class="toggle-switch"
              :class="{ active: localConfig.incognitoMode }"
              @click="localConfig.incognitoMode = !localConfig.incognitoMode"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <button class="card-header" @click="toggleCard('routing')">
          <div>
            <h3 class="card-title">Model Routing</h3>
            <p class="card-subtitle">Auto-select models by task type with fallback and usage tracking.</p>
          </div>
          <span class="card-toggle">{{ routingExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="routingExpanded" class="card-body">
          <div class="form-group toggle-row">
            <div>
              <label class="label">Enable Smart Routing</label>
              <p class="hint">When enabled, the app automatically selects the best model for each task type.</p>
            </div>
            <button
              class="toggle-switch"
              :class="{ active: localConfig.routing.enabled }"
              @click="localConfig.routing.enabled = !localConfig.routing.enabled"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <div v-if="localConfig.routing.enabled" class="routing-section">
            <div class="routing-label">Configured Profiles</div>
            <div class="profile-list">
              <div
                v-for="profile in localConfig.routing.profiles"
                :key="profile.id"
                class="profile-item"
              >
                <div class="profile-header">
                  <span class="profile-name">{{ profile.name }}</span>
                  <span class="profile-provider">{{ profile.provider }}</span>
                  <span
                    class="profile-status"
                    :class="{ disabled: !profile.enabled }"
                  >
                    {{ profile.enabled ? 'Enabled' : 'Disabled' }}
                  </span>
                </div>
                <div class="profile-meta">
                  <span class="meta-tag">{{ profile.model }}</span>
                  <span class="meta-tag">{{ profile.capabilities.join(', ') }}</span>
                  <span class="meta-tag">~{{ profile.avgLatencyMs }}ms</span>
                  <span class="meta-tag">${{ profile.costPer1kTokens }}/1k tokens</span>
                </div>
              </div>
            </div>

            <div class="routing-label" style="margin-top: 1rem;">Task Routing Rules</div>
            <div class="rule-list">
              <div
                v-for="rule in localConfig.routing.rules"
                :key="rule.taskType"
                class="rule-item"
              >
                <span class="rule-task">{{ rule.taskType }}</span>
                <span class="rule-arrow">→</span>
                <span class="rule-model">{{ getProfileName(rule.preferredModelId) }}</span>
                <span v-if="rule.fallbackModelIds.length" class="rule-fallback">
                  (fallback: {{ rule.fallbackModelIds.map(getProfileName).join(', ') }})
                </span>
                <span class="rule-timeout">{{ rule.timeoutMs }}ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <button class="card-header" @click="toggleCard('knowledge')">
          <div>
            <h3 class="card-title">Knowledge Base</h3>
            <p class="card-subtitle">Local document indexing and semantic search settings.</p>
          </div>
          <span class="card-toggle">{{ knowledgeExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="knowledgeExpanded" class="card-body">
          <div class="form-group toggle-row">
            <div>
              <label class="label">Auto-Retrieve in Chat</label>
              <p class="hint">When enabled, the app automatically searches the knowledge base for relevant context before each chat message.</p>
            </div>
            <button
              class="toggle-switch"
              :class="{ active: localConfig.kbAutoRetrieve !== false }"
              @click="localConfig.kbAutoRetrieve = !localConfig.kbAutoRetrieve"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <div class="form-group">
            <label class="label">Retrieval Top-K</label>
            <input
              v-model.number="localConfig.kbTopK"
              type="number"
              class="input"
              min="1"
              max="20"
              placeholder="5"
            />
            <p class="hint">Number of most-relevant passages to include as context (1-20).</p>
          </div>

          <div class="form-group">
            <label class="label">HuggingFace Mirror URL</label>
            <input
              v-model="localConfig.hfMirrorUrl"
              type="text"
              class="input"
              placeholder="https://hf-mirror.com/"
            />
            <p class="hint">Mirror site for downloading embedding models. Default: https://hf-mirror.com/</p>
          </div>
        </div>
      </div>

      <div class="card">
        <button class="card-header" @click="toggleCard('external')">
          <div>
            <h3 class="card-title">External Tools</h3>
            <p class="card-subtitle">Connect Zotero and Obsidian for deep research integration.</p>
          </div>
          <span class="card-toggle">{{ externalToolsExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="externalToolsExpanded" class="card-body">
          <!-- Zotero -->
          <div class="form-group">
            <label class="label">Zotero User ID</label>
            <input
              v-model="localConfig.externalTools.zoteroUserId"
              type="text"
              class="input"
              placeholder="0"
            />
            <p class="hint">
              Use <code>0</code> for your local library. This is NOT your online Zotero account ID.
              Zotero must be running with the local API enabled (Edit → Preferences → Advanced → "Allow other applications...").
            </p>
          </div>

          <div class="form-group toggle-row">
            <div>
              <label class="label">Auto-Sync Zotero</label>
              <p class="hint">Automatically sync Zotero library when the app starts.</p>
            </div>
            <button
              class="toggle-switch"
              :class="{ active: localConfig.externalTools.zoteroSyncEnabled }"
              @click="localConfig.externalTools.zoteroSyncEnabled = !localConfig.externalTools.zoteroSyncEnabled"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <!-- Obsidian -->
          <div class="form-group">
            <label class="label">Obsidian Vault Path</label>
            <input
              v-model="localConfig.externalTools.obsidianVaultPath"
              type="text"
              class="input"
              placeholder="C:/Users/.../Documents/Obsidian Vault"
            />
            <p class="hint">Absolute path to your Obsidian Vault folder.</p>
          </div>

          <div class="form-group">
            <label class="label">Default Notes Folder</label>
            <input
              v-model="localConfig.externalTools.obsidianDefaultFolder"
              type="text"
              class="input"
              placeholder="AI-Research-Assistant"
            />
            <p class="hint">Subfolder inside the vault where AI-generated notes are saved.</p>
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

.drag-handle {
  height: 32px;
  cursor: move;
  -webkit-app-region: drag;
  flex-shrink: 0;
  /* Transparent but acts as a hit target */
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

.select-input {
  appearance: none;
  background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e");
  background-position: right 0.75rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
  padding-right: 2.5rem;
}

.toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.toggle-switch {
  flex-shrink: 0;
  width: 48px;
  height: 26px;
  border-radius: 999px;
  background: #d1d5db;
  border: none;
  cursor: pointer;
  position: relative;
  transition: background 0.2s ease;
  padding: 0;
  margin-top: 2px;
}

.toggle-switch.active {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
}

.toggle-knob {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #ffffff;
  position: absolute;
  top: 3px;
  left: 3px;
  transition: transform 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.toggle-switch.active .toggle-knob {
  transform: translateX(22px);
}

/* Routing section */
.routing-section {
  margin-top: 1rem;
}

.routing-label {
  color: #374151;
  font-weight: 600;
  margin-bottom: 0.6rem;
  font-size: 0.8rem;
}

.profile-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.profile-item {
  background: rgba(15, 23, 42, 0.03);
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 10px;
  padding: 0.7rem 0.85rem;
}

.profile-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}

.profile-name {
  font-weight: 700;
  font-size: 0.85rem;
  color: #111827;
}

.profile-provider {
  font-size: 0.75rem;
  color: #6b7280;
  background: rgba(15, 23, 42, 0.06);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.profile-status {
  font-size: 0.7rem;
  font-weight: 600;
  color: #10b981;
  margin-left: auto;
}

.profile-status.disabled {
  color: #9ca3af;
}

.profile-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.meta-tag {
  font-size: 0.72rem;
  color: #6b7280;
  background: rgba(15, 23, 42, 0.04);
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
}

.rule-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.rule-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.82rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.02);
}

.rule-task {
  font-weight: 600;
  color: #374151;
  min-width: 100px;
  text-transform: capitalize;
}

.rule-arrow {
  color: #9ca3af;
}

.rule-model {
  color: #3d74e7;
  font-weight: 600;
}

.rule-fallback {
  font-size: 0.75rem;
  color: #9ca3af;
}

.rule-timeout {
  margin-left: auto;
  font-size: 0.72rem;
  color: #9ca3af;
  font-family: 'JetBrains Mono', monospace;
}
</style>
