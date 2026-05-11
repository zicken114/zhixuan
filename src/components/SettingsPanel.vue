<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import {
  providerPresets,
  supportedAppLanguages,
  supportedLanguages,
  useSettingsStore,
  type AppLanguage,
  type AIConfig,
  type ModelConfig,
  type ProviderPreset,
  type ProviderPresetId
} from '../stores/settings';
import { resetAllData } from '../composables/useDatabase';
import { setEmbedderMirrorUrl } from '../utils/embedder';
import { useI18n } from '../composables/useI18n';
import {
  listMcpServers,
  startMcpServer,
  stopMcpServer,
  restartMcpServer,
  listMcpTools,
  toggleMcpTool,
  setMcpToolPermission,
  getMcpServersDir,
  type McpServerStatus,
  type McpTool,
  type McpServerConfig,
} from '../composables/useMcp';

const appWindow = getCurrentWebviewWindow();
const settingsStore = useSettingsStore();
const { t } = useI18n();

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
const mcpExpanded = ref(false);

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

const toggleThemeMode = async () => {
  const nextThemeMode = localConfig.value.themeMode === 'dark' ? 'light' : 'dark';
  localConfig.value.themeMode = nextThemeMode;

  try {
    await settingsStore.updateConfig({
      ...settingsStore.config,
      themeMode: nextThemeMode
    });
  } catch (error) {
    console.error('Failed to update theme mode:', error);
    localConfig.value.themeMode = settingsStore.config.themeMode;
  }
};

const updateAppLanguage = async (language: AppLanguage) => {
  localConfig.value.appLanguage = language;

  try {
    await settingsStore.updateConfig({
      ...settingsStore.config,
      appLanguage: language
    });
  } catch (error) {
    console.error('Failed to update app language:', error);
    localConfig.value.appLanguage = settingsStore.config.appLanguage;
  }
};

// ── MCP Management ──
const mcpServers = ref<McpServerStatus[]>([]);
const mcpTools = ref<McpTool[]>([]);
const mcpServersDir = ref('');
const mcpLoading = ref(false);

const showAddServerModal = ref(false);
const newServer = ref<McpServerConfig>({
  name: '',
  command: '',
  args: [],
  env: {},
  transport: { type: 'stdio' },
  auto_start: true,
  timeout_ms: 30000,
  enabled: true,
});
const newServerArgsText = ref('');

const loadMcpData = async () => {
  mcpLoading.value = true;
  try {
    const [servers, tools, dir] = await Promise.all([
      listMcpServers(),
      listMcpTools(),
      getMcpServersDir(),
    ]);
    mcpServers.value = servers;
    mcpTools.value = tools;
    mcpServersDir.value = dir;
  } catch (e) {
    console.error('Failed to load MCP data:', e);
  } finally {
    mcpLoading.value = false;
  }
};

const handleRestartServer = async (name: string) => {
  try {
    await restartMcpServer(name);
    await loadMcpData();
  } catch (e) {
    console.error('Failed to restart MCP server:', e);
    alert(`Failed to start server: ${e}`);
  }
};

const handleStopServer = async (name: string) => {
  try {
    await stopMcpServer(name);
    await loadMcpData();
  } catch (e) {
    console.error('Failed to stop MCP server:', e);
    alert(`Failed to stop server: ${e}`);
  }
};

const handleToggleTool = async (tool: McpTool) => {
  try {
    await toggleMcpTool(tool.name, !tool.enabled);
    await loadMcpData();
  } catch (e) {
    console.error('Failed to toggle MCP tool:', e);
  }
};

const handleSetPermission = async (tool: McpTool, level: string) => {
  try {
    await setMcpToolPermission(tool.name, level);
    await loadMcpData();
  } catch (e) {
    console.error('Failed to set tool permission:', e);
  }
};

const openAddServerModal = () => {
  newServer.value = {
    name: '',
    command: '',
    args: [],
    env: {},
    transport: { type: 'stdio' },
    auto_start: true,
    timeout_ms: 30000,
    enabled: true,
  };
  newServerArgsText.value = '';
  showAddServerModal.value = true;
};

const submitNewServer = async () => {
  try {
    const args = newServerArgsText.value
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const config = { ...newServer.value, args };
    await startMcpServer(config);
    showAddServerModal.value = false;
    await loadMcpData();
  } catch (e) {
    console.error('Failed to add MCP server:', e);
    alert(`Failed to add server: ${e}`);
  }
};

const toggleCard = (target: 'text' | 'vision' | 'shortcuts' | 'translate' | 'privacy' | 'routing' | 'knowledge' | 'external' | 'mcp') => {
  if (target === 'text') textExpanded.value = !textExpanded.value;
  if (target === 'vision') visionExpanded.value = !visionExpanded.value;
  if (target === 'shortcuts') shortcutsExpanded.value = !shortcutsExpanded.value;
  if (target === 'translate') translateExpanded.value = !translateExpanded.value;
  if (target === 'privacy') privacyExpanded.value = !privacyExpanded.value;
  if (target === 'routing') routingExpanded.value = !routingExpanded.value;
  if (target === 'knowledge') knowledgeExpanded.value = !knowledgeExpanded.value;
  if (target === 'external') externalToolsExpanded.value = !externalToolsExpanded.value;
  if (target === 'mcp') {
    mcpExpanded.value = !mcpExpanded.value;
    if (mcpExpanded.value) loadMcpData();
  }
};
</script>

<template>
  <div class="settings-panel">
    <div class="drag-handle" @mousedown="handleDragStart"></div>
    <div class="header">
      <div>
        <h2>{{ t('settings.title') }}</h2>
        <p class="header-subtitle">{{ t('settings.subtitle') }}</p>
      </div>
      <div class="header-actions">
        <button class="theme-toggle-btn" @click="toggleThemeMode">
          <span class="theme-toggle-label">{{ localConfig.themeMode === 'dark' ? t('common.dark') : t('common.light') }}</span>
          <span class="theme-toggle-state">{{ t('common.mode') }}</span>
        </button>
        <button class="close-btn" @click="emit('close')">x</button>
      </div>
    </div>

    <div class="content">
      <div class="card">
        <button class="card-header" type="button">
          <div>
            <h3 class="card-title">{{ t('settings.appearance') }}</h3>
            <p class="card-subtitle">{{ t('settings.appearanceSubtitle') }}</p>
          </div>
        </button>

        <div class="card-body">
          <div class="form-group toggle-row">
            <div>
              <label class="label">{{ t('settings.themeMode') }}</label>
              <p class="hint">{{ t('settings.themeModeHint') }}</p>
            </div>
            <button class="theme-toggle-btn inline" @click="toggleThemeMode">
              <span class="theme-toggle-label">{{ localConfig.themeMode === 'dark' ? t('common.dark') : t('common.light') }}</span>
              <span class="theme-toggle-state">{{ t('common.mode') }}</span>
            </button>
          </div>

          <div class="form-group">
            <label class="label">{{ t('settings.appLanguage') }}</label>
            <select
              :value="localConfig.appLanguage"
              class="input select-input"
              @change="updateAppLanguage(($event.target as HTMLSelectElement).value as AppLanguage)"
            >
              <option
                v-for="language in supportedAppLanguages"
                :key="language.code"
                :value="language.code"
              >
                {{ language.label }}
              </option>
            </select>
            <p class="hint">{{ t('settings.appLanguageHint') }}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <button class="card-header" @click="toggleCard('text')">
          <div>
            <h3 class="card-title">{{ t('settings.textModel') }}</h3>
            <p class="card-subtitle">{{ t('settings.textModelSubtitle') }}</p>
          </div>
          <span class="card-toggle">{{ textExpanded ? t('common.hide') : t('common.show') }}</span>
        </button>

        <div v-if="textExpanded" class="card-body">
          <div class="provider-group">
            <div class="provider-label">{{ t('settings.providerPresets') }}</div>
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
            <label class="label">{{ t('settings.baseUrl') }}</label>
            <input
              v-model="localConfig.textConfig.baseUrl"
              type="text"
              class="input"
              placeholder="https://api.openai.com/v1"
            />
            <p class="hint">Enter the API root. The app will automatically call `/chat/completions`.</p>
          </div>

          <div class="form-group">
            <label class="label">{{ t('settings.apiKey') }}</label>
            <div class="password-input">
              <input
                v-model="localConfig.textConfig.apiKey"
                :type="showTextPassword ? 'text' : 'password'"
                class="input"
                placeholder="sk-..."
              />
              <button class="toggle-password" @click="showTextPassword = !showTextPassword">
                {{ showTextPassword ? t('settings.hidePassword') : t('settings.showPassword') }}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="label">{{ t('settings.model') }}</label>
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
            <h3 class="card-title">{{ t('settings.visionModel') }}</h3>
            <p class="card-subtitle">{{ t('settings.visionModelSubtitle') }}</p>
          </div>
          <span class="card-toggle">{{ visionExpanded ? t('common.hide') : t('common.show') }}</span>
        </button>

        <div v-if="visionExpanded" class="card-body">
          <div class="provider-group">
            <div class="provider-label">{{ t('settings.providerPresets') }}</div>
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
            <label class="label">{{ t('settings.baseUrl') }}</label>
            <input
              v-model="localConfig.visionConfig.baseUrl"
              type="text"
              class="input"
              placeholder="https://api.openai.com/v1"
            />
            <p class="hint">Use a provider and model that accepts image content in OpenAI-compatible chat calls.</p>
          </div>

          <div class="form-group">
            <label class="label">{{ t('settings.apiKey') }}</label>
            <div class="password-input">
              <input
                v-model="localConfig.visionConfig.apiKey"
                :type="showVisionPassword ? 'text' : 'password'"
                class="input"
                placeholder="sk-..."
              />
              <button class="toggle-password" @click="showVisionPassword = !showVisionPassword">
                {{ showVisionPassword ? t('settings.hidePassword') : t('settings.showPassword') }}
              </button>
            </div>
          </div>

          <div class="form-group">
            <label class="label">{{ t('settings.model') }}</label>
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
            <h3 class="card-title">{{ t('settings.translation') }}</h3>
            <p class="card-subtitle">{{ t('settings.translationSubtitle') }}</p>
          </div>
          <span class="card-toggle">{{ translateExpanded ? t('common.hide') : t('common.show') }}</span>
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
            <h3 class="card-title">{{ t('settings.shortcuts') }}</h3>
            <p class="card-subtitle">{{ t('settings.shortcutsSubtitle') }}</p>
          </div>
          <span class="card-toggle">{{ shortcutsExpanded ? t('common.hide') : t('common.show') }}</span>
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
            <h3 class="card-title">{{ t('settings.privacy') }}</h3>
            <p class="card-subtitle">{{ t('settings.privacySubtitle') }}</p>
          </div>
          <span class="card-toggle">{{ privacyExpanded ? t('common.hide') : t('common.show') }}</span>
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
            <h3 class="card-title">知乎知识库</h3>
            <p class="card-subtitle">Local document indexing and semantic search settings.</p>
          </div>
          <span class="card-toggle">{{ knowledgeExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="knowledgeExpanded" class="card-body">
          <div class="form-group toggle-row">
            <div>
              <label class="label">Auto-Retrieve in Chat</label>
              <p class="hint">开启后，每次发送消息前，应用会自动在知乎知识库中搜索相关上下文。</p>
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

          <div class="form-group">
            <label class="label">Session Summary Interval</label>
            <input
              v-model.number="localConfig.summaryInterval"
              type="number"
              class="input"
              min="0"
              max="50"
              placeholder="5"
            />
            <p class="hint">Generate an AI summary every N user messages (0 = disabled). Summaries help maintain long-term context across sessions.</p>
          </div>
        </div>
      </div>

      <div class="card">
        <button class="card-header" @click="toggleCard('external')">
          <div>
            <h3 class="card-title">External Tools</h3>
            <p class="card-subtitle">Connect Obsidian for deep research integration.</p>
          </div>
          <span class="card-toggle">{{ externalToolsExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="externalToolsExpanded" class="card-body">
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

      <!-- MCP Servers -->
      <div class="card">
        <button class="card-header" @click="toggleCard('mcp')">
          <div>
            <h3 class="card-title">MCP Servers</h3>
            <p class="card-subtitle">Manage Model Context Protocol servers and tools.</p>
          </div>
          <span class="card-toggle">{{ mcpExpanded ? 'Hide' : 'Show' }}</span>
        </button>

        <div v-if="mcpExpanded" class="card-body">
          <div v-if="mcpLoading" class="mcp-loading">Loading...</div>

          <!-- Servers Directory -->
          <div class="form-group">
            <label class="label">Servers Directory</label>
            <input :value="mcpServersDir" type="text" class="input" readonly />
            <p class="hint">Place MCP server scripts here. Built-in servers are auto-deployed on startup.</p>
          </div>

          <!-- Server List -->
          <div class="mcp-section">
            <div class="mcp-section-header">
              <h4 class="mcp-section-title">Servers</h4>
              <button class="btn-secondary small" @click="openAddServerModal">+ Add Server</button>
            </div>

            <div v-if="mcpServers.length === 0" class="mcp-empty">No servers configured.</div>

            <div v-for="server in mcpServers" :key="server.name" class="mcp-item">
              <div class="mcp-item-main">
                <div class="mcp-item-info">
                  <span class="mcp-item-name">{{ server.name }}</span>
                  <span
                    class="mcp-status-badge"
                    :class="{
                      running: server.status === 'Running',
                      starting: server.status === 'Starting',
                      error: server.status === 'Error',
                      stopped: server.status === 'Stopped',
                    }"
                  >
                    {{ server.status }}
                  </span>
                </div>
                <div class="mcp-item-actions">
                  <button
                    v-if="server.status === 'Running'"
                    class="btn-secondary small"
                    @click="handleStopServer(server.name)"
                  >
                    Stop
                  </button>
                  <button
                    v-else
                    class="btn-secondary small"
                    @click="handleRestartServer(server.name)"
                  >
                    Start
                  </button>
                  <button class="btn-secondary small" @click="loadMcpData">Refresh</button>
                </div>
              </div>
              <p v-if="server.error_message" class="mcp-item-desc" style="color: #ef4444;">
                {{ server.error_message }}
              </p>
            </div>
          </div>

          <!-- Tool List -->
          <div class="mcp-section">
            <div class="mcp-section-header">
              <h4 class="mcp-section-title">Tools</h4>
              <button class="btn-secondary small" @click="loadMcpData">Refresh</button>
            </div>

            <div v-if="mcpTools.length === 0" class="mcp-empty">No tools available.</div>

            <div v-for="tool in mcpTools" :key="tool.name" class="mcp-item">
              <div class="mcp-item-main">
                <div class="mcp-item-info">
                  <span class="mcp-item-name">{{ tool.name }}</span>
                  <span class="mcp-item-server">{{ tool.server_name }}</span>
                </div>
                <div class="mcp-item-actions">
                  <button
                    class="toggle-switch small"
                    :class="{ active: tool.enabled }"
                    @click="handleToggleTool(tool)"
                  >
                    <span class="toggle-knob"></span>
                  </button>
                </div>
              </div>
              <p class="mcp-item-desc">{{ tool.description }}</p>
              <div class="mcp-permission">
                <label class="mcp-permission-label">Permission:</label>
                <select
                  :value="tool.permission_level"
                  class="input small"
                  @change="handleSetPermission(tool, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="always_allow">Always Allow</option>
                  <option value="ask_user">Ask User</option>
                  <option value="never_allow">Never Allow</option>
                </select>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Add Server Modal -->
      <div v-if="showAddServerModal" class="modal-overlay" @click.self="showAddServerModal = false">
        <div class="modal-content">
          <h3 class="modal-title">Add MCP Server</h3>

          <div class="form-group">
            <label class="label">Name</label>
            <input v-model="newServer.name" type="text" class="input" placeholder="e.g. web_search" />
          </div>

          <div class="form-group">
            <label class="label">Command</label>
            <input v-model="newServer.command" type="text" class="input" placeholder="e.g. node or python" />
          </div>

          <div class="form-group">
            <label class="label">Arguments (one per line)</label>
            <textarea
              v-model="newServerArgsText"
              class="input"
              rows="3"
              placeholder="/path/to/server.js"
            />
            <p class="hint">Absolute path to the server script.</p>
          </div>

          <div class="form-group toggle-row">
            <div>
              <label class="label">Auto Start</label>
              <p class="hint">Start this server automatically on app launch.</p>
            </div>
            <button
              class="toggle-switch"
              :class="{ active: newServer.auto_start }"
              @click="newServer.auto_start = !newServer.auto_start"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <div class="form-group toggle-row">
            <div>
              <label class="label">Enabled</label>
              <p class="hint">Enable this server for tool discovery.</p>
            </div>
            <button
              class="toggle-switch"
              :class="{ active: newServer.enabled }"
              @click="newServer.enabled = !newServer.enabled"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <div class="modal-actions">
            <button class="btn-secondary" @click="showAddServerModal = false">Cancel</button>
            <button class="save-btn" @click="submitNewServer">Add Server</button>
          </div>
        </div>
      </div>

      <button
        class="save-btn"
        :class="{ saved: saveStatus === 'saved' }"
        @click="saveSettings"
        :disabled="saveStatus === 'saving'"
      >
        <span v-if="saveStatus === 'idle'">{{ t('settings.saveSettings') }}</span>
        <span v-else-if="saveStatus === 'saving'">{{ t('common.saving') }}</span>
        <span v-else-if="saveStatus === 'saved'">{{ t('settings.saved') }}</span>
        <span v-else>{{ t('settings.error') }}</span>
      </button>

      <button class="reset-btn" @click="resetSettings">
        {{ t('settings.reset') }}
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
  /* Transparent but acts as a hit target */
}

.header {
  padding: 1.25rem 1.5rem;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  background: var(--bg-card);
  backdrop-filter: blur(10px);
}

.header h2 {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
  font-family: 'Syne', sans-serif;
}

.header-subtitle {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.5;
}

.close-btn {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.2rem;
  cursor: pointer;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.65rem;
}

.theme-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.8rem;
  border: 1px solid var(--border-medium);
  border-radius: 999px;
  background: var(--bg-surface);
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
}

.theme-toggle-btn.inline {
  flex-shrink: 0;
}

.theme-toggle-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-primary);
  border-color: var(--border-focus);
}

.theme-toggle-label {
  color: var(--accent);
}

.theme-toggle-state {
  color: var(--text-muted);
  font-weight: 600;
}

.close-btn:hover {
  background: rgba(234, 67, 53, 0.08);
  color: var(--error);
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
}

.card {
  margin-bottom: 1rem;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  box-shadow: var(--shadow-md);
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
  color: var(--accent);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-family: 'Syne', sans-serif;
}

.card-subtitle {
  margin: 0.35rem 0 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.5;
}

.card-toggle {
  flex-shrink: 0;
  color: var(--accent);
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
  color: var(--text-secondary);
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
  background: var(--bg-surface);
  color: var(--text-muted);
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
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.provider-chip.active {
  background: var(--accent);
  color: var(--text-on-accent);
  box-shadow: 0 10px 22px rgba(26, 115, 232, 0.22);
}

.form-group {
  margin-bottom: 1rem;
}

.label {
  display: block;
  color: var(--text-secondary);
  font-weight: 600;
  margin-bottom: 0.45rem;
  font-size: 0.8rem;
}

.input {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  background: var(--bg-input);
  border: 1px solid var(--border-medium);
  border-radius: 12px;
  padding: 0.82rem 1rem;
  color: var(--text-primary);
  font-size: 0.9rem;
  outline: none;
  transition: all 0.2s ease;
  font-family: 'DM Sans', sans-serif;
}

.input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 4px rgba(26, 115, 232, 0.12);
}

.shortcut-input {
  background: var(--bg-surface);
  cursor: not-allowed;
  color: var(--text-muted);
}

.hint {
  margin-top: 0.4rem;
  font-size: 0.75rem;
  color: var(--text-muted);
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
  background: var(--bg-surface);
  border: none;
  border-radius: 999px;
  cursor: pointer;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--text-secondary);
  padding: 0.42rem 0.72rem;
}

.save-btn {
  width: 100%;
  background: var(--accent);
  border: none;
  border-radius: 12px;
  padding: 0.95rem;
  color: var(--text-on-accent);
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.9rem;
  font-family: 'Syne', sans-serif;
  box-shadow: 0 8px 20px rgba(26, 115, 232, 0.22);
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
  background: var(--success);
}

.reset-btn {
  width: 100%;
  margin-top: 0.7rem;
  background: transparent;
  border: 1px solid var(--border-medium);
  border-radius: 12px;
  padding: 0.9rem;
  color: var(--text-muted);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 0.86rem;
  font-family: 'DM Sans', sans-serif;
}

.reset-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
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
  background: var(--border-medium);
  border: none;
  cursor: pointer;
  position: relative;
  transition: background 0.2s ease;
  padding: 0;
  margin-top: 2px;
}

.toggle-switch.active {
  background: var(--accent);
}

.toggle-knob {
  display: block;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--bg-base);
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
  color: var(--text-secondary);
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
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
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
  color: var(--text-primary);
}

.profile-provider {
  font-size: 0.75rem;
  color: var(--text-muted);
  background: var(--bg-card-hover);
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
}

.profile-status {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--success);
  margin-left: auto;
}

.profile-status.disabled {
  color: var(--text-muted);
}

.profile-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.meta-tag {
  font-size: 0.72rem;
  color: var(--text-muted);
  background: var(--bg-card-hover);
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
  background: var(--bg-surface);
}

.rule-task {
  font-weight: 600;
  color: var(--text-secondary);
  min-width: 100px;
  text-transform: capitalize;
}

.rule-arrow {
  color: var(--text-muted);
}

.rule-model {
  color: var(--accent);
  font-weight: 600;
}

.rule-fallback {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.rule-timeout {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}


.test-btn {
  padding: 0.5rem 0.9rem;
  font-size: 0.78rem;
  white-space: nowrap;
}

/* MCP Panel */
.mcp-loading {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.mcp-section {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}

.mcp-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.mcp-section-title {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.mcp-empty {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.8rem;
  background: var(--bg-base);
  border-radius: 10px;
}

.mcp-item {
  padding: 0.75rem 1rem;
  background: var(--bg-base);
  border-radius: 12px;
  margin-bottom: 0.5rem;
  border: 1px solid var(--border-subtle);
}

.mcp-item-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.mcp-item-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.mcp-item-name {
  font-weight: 600;
  font-size: 0.85rem;
  color: var(--text-primary);
}

.mcp-item-server {
  font-size: 0.72rem;
  color: var(--text-muted);
  background: var(--bg-card);
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
}

.mcp-item-desc {
  margin: 0.4rem 0 0 0;
  font-size: 0.78rem;
  color: var(--text-muted);
  line-height: 1.4;
}

.mcp-item-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}

.mcp-status-badge {
  font-size: 0.7rem;
  padding: 0.15rem 0.5rem;
  border-radius: 4px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.mcp-status-badge.running {
  background: rgba(52, 168, 83, 0.12);
  color: var(--success);
}

.mcp-status-badge.starting {
  background: rgba(251, 188, 5, 0.12);
  color: #f9ab00;
}

.mcp-status-badge.error {
  background: rgba(234, 67, 53, 0.12);
  color: var(--error);
}

.mcp-status-badge.stopped {
  background: var(--bg-card);
  color: var(--text-muted);
}

.mcp-permission {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.mcp-permission-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.btn-secondary.small {
  padding: 0.35rem 0.7rem;
  font-size: 0.75rem;
}

.toggle-switch.small {
  width: 36px;
  height: 20px;
}

.toggle-switch.small .toggle-knob {
  width: 16px;
  height: 16px;
}

.toggle-switch.small.active .toggle-knob {
  transform: translateX(16px);
}

.input.small {
  padding: 0.35rem 0.6rem;
  font-size: 0.78rem;
  width: auto;
  min-width: 140px;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal-content {
  background: var(--bg-card);
  border-radius: 18px;
  padding: 1.5rem;
  width: 100%;
  max-width: 480px;
  max-height: 80vh;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-subtle);
}

.modal-title {
  margin: 0 0 1rem 0;
  font-size: 1rem;
  font-weight: 600;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-subtle);
}
</style>
