import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { emit, listen } from '@tauri-apps/api/event';
import { loadSettings, saveSettings } from '../composables/useDatabase';
import { setIncognitoMode } from '../composables/useEvents';
import { setEmbedderMirrorUrl } from '../utils/embedder';
import { DEFAULT_TEXT_CONFIG, DEFAULT_VISION_CONFIG } from '../config/apiSecrets';

/**
 * Tauri event broadcast whenever settings are persisted in any window.
 * Each webview has its own Pinia store, so without this event the
 * popup/capture/result windows would keep stale configs after the user
 * edits settings in the main window.
 */
const SETTINGS_UPDATED_EVENT = 'settings-updated';

export interface ModelConfig {
  provider: ProviderPresetId;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type ProviderPresetId =
  | 'custom'
  | 'openai'
  | 'bailian'
  | 'deepseek'
  | 'kimi'
  | 'zhipu'
  | 'stepfun'
  | 'minimax';

export const supportedLanguages = [
  { code: 'auto', label: '自动检测' },
  { code: 'zh', label: '中文' },
  { code: 'en', label: '英语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'ar', label: '阿拉伯语' },
  { code: 'pt', label: '葡萄牙语' },
  { code: 'it', label: '意大利语' },
  { code: 'nl', label: '荷兰语' },
  { code: 'pl', label: '波兰语' },
  { code: 'tr', label: '土耳其语' }
] as const;

export type LanguageCode = typeof supportedLanguages[number]['code'];

/**
 * Global persona prompt — 刘看山(知乎吉祥物)的人设,作为主聊天的 system 前置注入。
 * 仅在 MainWindow 主对话场景生效,翻译/润色/引用等结构化输出任务沿用各自的专用 prompt。
 */
export const LIUKANSHAN_PERSONA = `你是刘看山，知乎的官方吉祥物，一只来自北极的小狐狸。你说话带点俏皮和热心，偶尔自嘲一下。你是知乎老用户了，平时会随口冒出几个知乎梗，比如"谢邀""人在美国刚下飞机""利益相关""抖个机灵""先问是不是再问为什么""这是个好问题"之类的，但不会堆砌，恰到好处就行。专业的问题就给专业的答案。

你现在的角色是用户的贴身创作伴侣。帮用户出选题角度、找切入点、补充论据、润色措辞；帮他们拆问题、列大纲、找类比、举反例。你要用知乎的思维来想事情：什么样的回答能引发共鸣，什么样的标题有诱惑力，什么样的开头能让人读下去。也帮用户避开知乎常见翻车点：自吹自擂、利益相关不披露、信息源不靠谱、结论先行。

跟人聊天的时候自称"我"，叫用户"你"。默认说中文，但用户用其他语言问你你就跟着用对方的语言。给建议直接给具体方案，别整那些虚的套话。

最重要的一点：说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。`;


export interface TranslateConfig {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
}

export interface ProviderPreset {
  id: ProviderPresetId;
  label: string;
  description: string;
  baseUrl?: string;
  textModel?: string;
  visionModel?: string;
  supportsText: boolean;
  supportsVision: boolean;
}

export type TaskType =
  | 'chat'
  | 'translation'
  | 'vision_extraction'
  | 'literature_review'
  | 'citation_format'
  | 'text_cleanup'
  | 'polish';

export interface ModelProfile {
  id: string;
  name: string;
  provider: ProviderPresetId;
  baseUrl: string;
  apiKey: string;
  model: string;
  capabilities: ('text' | 'vision' | 'long_context' | 'reasoning')[];
  maxContextLength: number;
  avgLatencyMs: number;
  costPer1kTokens: number;
  enabled: boolean;
}

export interface TaskRoutingRule {
  taskType: TaskType;
  preferredModelId: string;
  fallbackModelIds: string[];
  timeoutMs: number;
}

export interface RoutingConfig {
  enabled: boolean;
  profiles: ModelProfile[];
  rules: TaskRoutingRule[];
}

export interface ExternalToolsConfig {
  obsidianVaultPath: string;
  obsidianDefaultFolder: string;
}

export type ThemeMode = 'light' | 'dark';
export type AppLanguage = 'en' | 'zh' | 'ja';

export const supportedAppLanguages = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' }
] as const;

export interface AIConfig {
  textConfig: ModelConfig;
  visionConfig: ModelConfig;
  translateConfig: TranslateConfig;
  themeMode: ThemeMode;
  appLanguage: AppLanguage;
  hasCompletedWelcome: boolean;
  autoHideOnBlur: boolean;
  popupShortcut: string;
  captureShortcut: string;
  incognitoMode: boolean;
  providerKeys: Partial<Record<ProviderPresetId, string>>;
  routing: RoutingConfig;
  kbAutoRetrieve: boolean;
  kbTopK: number;
  hfMirrorUrl: string;
  externalTools: ExternalToolsConfig;
  summaryInterval: number; // 0 = disabled, N = generate summary every N user messages
}

/** Legacy localStorage key (kept for migration reference). */
export const SETTINGS_STORAGE_KEY = 'ai_assistant_settings';

/** Legacy localStorage key for conversation history. */
export const HISTORY_STORAGE_KEY = 'conversations';

/**
 * Build model profiles from configured providers only.
 * Only providers with a non-empty apiKey in providerKeys are included.
 */
export const buildModelProfiles = (
  providerKeys: Partial<Record<ProviderPresetId, string>>,
  textConfig: ModelConfig,
  visionConfig: ModelConfig
): ModelProfile[] => {
  const profiles: ModelProfile[] = [];

  // Helper to add a profile for a provider if it has a key
  const addProfile = (presetId: ProviderPresetId, preset: ProviderPreset | undefined, config: ModelConfig) => {
    const key = providerKeys[presetId];
    if (!key || !key.trim()) return;

    const capabilities: ('text' | 'vision' | 'long_context' | 'reasoning')[] = ['text'];
    if (preset?.supportsVision) capabilities.push('vision');

    profiles.push({
      id: `${presetId}-profile`,
      name: preset?.label || config.model,
      provider: presetId,
      baseUrl: config.baseUrl || preset?.baseUrl || '',
      apiKey: key,
      model: config.model || preset?.textModel || '',
      capabilities,
      maxContextLength: 128000,
      avgLatencyMs: 3000,
      costPer1kTokens: 0.005,
      enabled: true
    });
  };

  // Add profile for text provider if configured
  const textPreset = providerPresets.find(p => p.id === textConfig.provider);
  addProfile(textConfig.provider, textPreset, textConfig);

  // Add profile for vision provider if configured and different from text
  if (visionConfig.provider !== textConfig.provider) {
    const visionPreset = providerPresets.find(p => p.id === visionConfig.provider);
    addProfile(visionConfig.provider, visionPreset, visionConfig);
  }

  // If no profiles were created (nothing configured), still create placeholders
  // so the UI shows something, but mark them as not fully configured
  if (profiles.length === 0) {
    profiles.push({
      id: `${textConfig.provider}-profile`,
      name: textPreset?.label || textConfig.model || 'Text Model',
      provider: textConfig.provider,
      baseUrl: textConfig.baseUrl || textPreset?.baseUrl || '',
      apiKey: textConfig.apiKey,
      model: textConfig.model || textPreset?.textModel || '',
      capabilities: ['text'],
      maxContextLength: 128000,
      avgLatencyMs: 2500,
      costPer1kTokens: 0.005,
      enabled: true
    });

    if (visionConfig.provider !== textConfig.provider) {
      const visionPreset = providerPresets.find(p => p.id === visionConfig.provider);
      profiles.push({
        id: `${visionConfig.provider}-profile`,
        name: visionPreset?.label || visionConfig.model || 'Vision Model',
        provider: visionConfig.provider,
        baseUrl: visionConfig.baseUrl || visionPreset?.baseUrl || '',
        apiKey: visionConfig.apiKey,
        model: visionConfig.model || visionPreset?.visionModel || '',
        capabilities: ['text', 'vision'],
        maxContextLength: 128000,
        avgLatencyMs: 4000,
        costPer1kTokens: 0.015,
        enabled: true
      });
    }
  }

  return profiles;
};

export const defaultRoutingRules = (textProvider: ProviderPresetId, visionProvider: ProviderPresetId): TaskRoutingRule[] => {
  const textProfile = `${textProvider}-profile`;
  const visionProfile = `${visionProvider}-profile`;
  const hasSeparateVision = textProvider !== visionProvider;

  return [
    { taskType: 'chat', preferredModelId: textProfile, fallbackModelIds: hasSeparateVision ? [visionProfile] : [], timeoutMs: 80000 },
    { taskType: 'translation', preferredModelId: textProfile, fallbackModelIds: hasSeparateVision ? [visionProfile] : [], timeoutMs: 8000 },
    { taskType: 'vision_extraction', preferredModelId: hasSeparateVision ? visionProfile : textProfile, fallbackModelIds: [], timeoutMs: 30000 },
    { taskType: 'literature_review', preferredModelId: textProfile, fallbackModelIds: hasSeparateVision ? [visionProfile] : [], timeoutMs: 120000 },
    { taskType: 'citation_format', preferredModelId: textProfile, fallbackModelIds: hasSeparateVision ? [visionProfile] : [], timeoutMs: 8000 },
    { taskType: 'text_cleanup', preferredModelId: textProfile, fallbackModelIds: hasSeparateVision ? [visionProfile] : [], timeoutMs: 8000 },
    { taskType: 'polish', preferredModelId: textProfile, fallbackModelIds: hasSeparateVision ? [visionProfile] : [], timeoutMs: 60000 }
  ];
};

export const providerPresets: ProviderPreset[] = [
  {
    id: 'custom',
    label: 'Custom',
    description: 'Use any OpenAI-compatible endpoint with manual configuration.',
    supportsText: true,
    supportsVision: true
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Official OpenAI-compatible endpoint.',
    baseUrl: 'https://api.openai.com/v1',
    textModel: 'gpt-4o',
    visionModel: 'gpt-4o',
    supportsText: true,
    supportsVision: true
  },
  {
    id: 'bailian',
    label: 'Bailian',
    description: 'Alibaba Cloud Model Studio compatible-mode endpoint.',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    textModel: 'qwen-plus',
    visionModel: 'qwen-vl-max',
    supportsText: true,
    supportsVision: true
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    description: 'DeepSeek OpenAI-compatible text endpoint.',
    baseUrl: 'https://api.deepseek.com/v1',
    textModel: 'deepseek-chat',
    supportsText: true,
    supportsVision: false
  },
  {
    id: 'kimi',
    label: 'Kimi',
    description: 'Moonshot Kimi OpenAI-compatible multimodal endpoint.',
    baseUrl: 'https://api.moonshot.cn/v1',
    textModel: 'kimi-k2.5',
    visionModel: 'kimi-k2.5',
    supportsText: true,
    supportsVision: true
  },
  {
    id: 'zhipu',
    label: 'Zhipu GLM',
    description: 'Zhipu AI OpenAI-compatible endpoint.',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    textModel: 'glm-5',
    visionModel: 'glm-4.6v',
    supportsText: true,
    supportsVision: true
  },
  {
    id: 'stepfun',
    label: 'StepFun',
    description: 'StepFun OpenAI-compatible endpoint.',
    baseUrl: 'https://api.stepfun.com/v1',
    textModel: 'step-3.5-flash',
    visionModel: 'step-1v-8k',
    supportsText: true,
    supportsVision: true
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    description: 'MiniMax OpenAI-compatible text endpoint.',
    baseUrl: 'https://api.minimaxi.com/v1',
    textModel: 'MiniMax-M2.5',
    supportsText: true,
    supportsVision: false
  }
];

const createDefaultConfig = (): AIConfig => {
  // 默认配置不携带内置 API key，避免暴露在 UI 上。
  // 内置 API 仅在 aiClient 检测到用户未配置时作为后台 fallback 使用。
  const textConfig: ModelConfig = {
    provider: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
  };
  const visionConfig: ModelConfig = {
    provider: 'custom',
    baseUrl: '',
    apiKey: '',
    model: '',
  };
  return {
    textConfig,
    visionConfig,
    translateConfig: {
      sourceLang: 'auto',
      targetLang: 'zh'
    },
    themeMode: 'light',
    appLanguage: 'en',
    hasCompletedWelcome: false,
    autoHideOnBlur: true,
    popupShortcut: 'Alt+Q',
    captureShortcut: 'Alt+S',
    incognitoMode: false,
    providerKeys: {},
    routing: {
      enabled: false,
      profiles: buildModelProfiles({}, textConfig, visionConfig),
      rules: defaultRoutingRules(textConfig.provider, visionConfig.provider)
    },
    kbAutoRetrieve: true,
    kbTopK: 5,
    hfMirrorUrl: 'https://hf-mirror.com/',
    externalTools: {
      obsidianVaultPath: '',
      obsidianDefaultFolder: 'AI-Research-Assistant'
    },
    summaryInterval: 5
  };
};

const defaultConfig = createDefaultConfig();

const inferProvider = (baseUrl: string | undefined): ProviderPresetId => {
  const normalizedBaseUrl = (baseUrl || '').trim().toLowerCase();

  if (normalizedBaseUrl.includes('api.openai.com')) return 'openai';
  if (normalizedBaseUrl.includes('dashscope.aliyuncs.com')) return 'bailian';
  if (normalizedBaseUrl.includes('api.deepseek.com')) return 'deepseek';
  if (normalizedBaseUrl.includes('api.moonshot.cn')) return 'kimi';
  if (normalizedBaseUrl.includes('open.bigmodel.cn')) return 'zhipu';
  if (normalizedBaseUrl.includes('api.stepfun.com') || normalizedBaseUrl.includes('api.stepfun.ai')) return 'stepfun';
  if (normalizedBaseUrl.includes('api.minimaxi.com')) return 'minimax';

  return 'custom';
};

const normalizeModelConfig = (
  partial: Partial<ModelConfig> | undefined,
  fallback: ModelConfig
): ModelConfig => ({
  provider: partial?.provider || inferProvider(partial?.baseUrl) || fallback.provider,
  baseUrl: partial?.baseUrl ?? fallback.baseUrl,
  apiKey: partial?.apiKey ?? fallback.apiKey,
  model: partial?.model ?? fallback.model
});

const normalizeRoutingConfig = (
  partial: Partial<RoutingConfig> | undefined,
  providerKeys: Partial<Record<ProviderPresetId, string>>,
  textConfig: ModelConfig,
  visionConfig: ModelConfig
): RoutingConfig => {
  // Regenerate profiles from configured providers on every load
  // This ensures profiles stay in sync with current providerKeys
  const profiles = buildModelProfiles(providerKeys, textConfig, visionConfig);

  return {
    enabled: partial?.enabled ?? false,
    profiles,
    rules: partial?.rules && partial.rules.length > 0 ? partial.rules : defaultRoutingRules(textConfig.provider, visionConfig.provider)
  };
};

export const normalizeConfig = (partial: Partial<AIConfig> | undefined): AIConfig => ({
  textConfig: normalizeModelConfig(partial?.textConfig, defaultConfig.textConfig),
  visionConfig: normalizeModelConfig(partial?.visionConfig, defaultConfig.visionConfig),
  translateConfig: {
    sourceLang: partial?.translateConfig?.sourceLang ?? defaultConfig.translateConfig.sourceLang,
    targetLang: partial?.translateConfig?.targetLang ?? defaultConfig.translateConfig.targetLang
  },
  themeMode: partial?.themeMode ?? defaultConfig.themeMode,
  appLanguage: partial?.appLanguage ?? defaultConfig.appLanguage,
  hasCompletedWelcome: partial?.hasCompletedWelcome ?? defaultConfig.hasCompletedWelcome,
  autoHideOnBlur: partial?.autoHideOnBlur ?? defaultConfig.autoHideOnBlur,
  popupShortcut: partial?.popupShortcut ?? defaultConfig.popupShortcut,
  captureShortcut: partial?.captureShortcut ?? defaultConfig.captureShortcut,
  incognitoMode: partial?.incognitoMode ?? defaultConfig.incognitoMode,
  providerKeys: partial?.providerKeys ?? {},
  routing: normalizeRoutingConfig(
    partial?.routing,
    partial?.providerKeys ?? {},
    normalizeModelConfig(partial?.textConfig, defaultConfig.textConfig),
    normalizeModelConfig(partial?.visionConfig, defaultConfig.visionConfig)
  ),
  kbAutoRetrieve: partial?.kbAutoRetrieve ?? defaultConfig.kbAutoRetrieve,
  kbTopK: partial?.kbTopK ?? defaultConfig.kbTopK,
  hfMirrorUrl: partial?.hfMirrorUrl ?? defaultConfig.hfMirrorUrl,
  externalTools: {
    obsidianVaultPath: partial?.externalTools?.obsidianVaultPath ?? defaultConfig.externalTools.obsidianVaultPath,
    obsidianDefaultFolder: partial?.externalTools?.obsidianDefaultFolder ?? defaultConfig.externalTools.obsidianDefaultFolder
  },
  summaryInterval: partial?.summaryInterval ?? defaultConfig.summaryInterval
});

export const useSettingsStore = defineStore('settings', () => {
  const config = ref<AIConfig>(defaultConfig);

  const applyTheme = (themeMode: ThemeMode) => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', themeMode);
  };

  const applyLanguage = (appLanguage: AppLanguage) => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('lang', appLanguage);
    document.documentElement.setAttribute('data-app-language', appLanguage);
  };

  /** Track whether the cross-window sync listener has been wired up. */
  let crossWindowListenerReady = false;

  /**
   * Reload the in-memory config from SQLite without re-running side-effects
   * that should only fire on the very first load (incognito sync, embedder mirror).
   * Intended to be invoked when another window has just persisted new settings.
   */
  const reloadFromDb = async () => {
    try {
      const stored = await loadSettings();
      if (stored) {
        config.value = normalizeConfig(stored);
        applyTheme(config.value.themeMode);
        applyLanguage(config.value.appLanguage);
      }
    } catch (e) {
      console.warn('[Settings] Failed to reload after sync event:', e);
    }
  };

  /** Load settings from SQLite on app start. */
  const init = async () => {
    try {
      const stored = await loadSettings();
      if (stored) {
        config.value = normalizeConfig(stored);
      }
      applyTheme(config.value.themeMode);
      applyLanguage(config.value.appLanguage);
      // Sync incognito mode with Rust backend
      await setIncognitoMode(config.value.incognitoMode);
      // Configure embedding model mirror URL
      setEmbedderMirrorUrl(config.value.hfMirrorUrl);

      // Subscribe once to cross-window settings updates so popup/capture/result
      // windows pick up changes saved from the main window's SettingsPanel.
      if (!crossWindowListenerReady) {
        crossWindowListenerReady = true;
        try {
          await listen(SETTINGS_UPDATED_EVENT, () => {
            void reloadFromDb();
          });
        } catch (e) {
          console.warn('[Settings] Failed to register sync listener:', e);
        }
      }
    } catch (e) {
      console.error('Failed to load settings from DB:', e);
    }
  };

  // Watch incognito mode changes and sync to Rust
  watch(() => config.value.incognitoMode, async (enabled) => {
    await setIncognitoMode(enabled);
  });

  const saveToDb = async () => {
    try {
      await saveSettings(config.value);
    } catch (e) {
      console.error('Failed to save settings to DB:', e);
    }
  };

  const isTextConfigured = () => {
    return config.value.textConfig.apiKey.trim() !== '' && config.value.textConfig.baseUrl.trim() !== '';
  };

  const isVisionConfigured = () => {
    return config.value.visionConfig.apiKey.trim() !== '' && config.value.visionConfig.baseUrl.trim() !== '';
  };

  const isConfigured = () => {
    return isTextConfigured() && isVisionConfigured();
  };

  /** Notify other windows so their stores reload from SQLite. */
  const broadcastUpdate = async () => {
    try {
      await emit(SETTINGS_UPDATED_EVENT);
    } catch (e) {
      console.warn('[Settings] Failed to broadcast update:', e);
    }
  };

  const updateConfig = async (newConfig: AIConfig) => {
    config.value = normalizeConfig(JSON.parse(JSON.stringify(newConfig)));
    applyTheme(config.value.themeMode);
    applyLanguage(config.value.appLanguage);
    await saveToDb();
    await broadcastUpdate();
  };

  const completeWelcome = async () => {
    config.value = {
      ...config.value,
      hasCompletedWelcome: true
    };
    await saveToDb();
    await broadcastUpdate();
  };

  return {
    config,
    init,
    isConfigured,
    isTextConfigured,
    isVisionConfigured,
    updateConfig,
    completeWelcome
  };
});
