import { defineStore } from 'pinia';
import { ref } from 'vue';

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

export interface AIConfig {
  textConfig: ModelConfig;
  visionConfig: ModelConfig;
  translateConfig: TranslateConfig;
  hasCompletedWelcome: boolean;
  autoHideOnBlur: boolean;
  popupShortcut: string;
  captureShortcut: string;
}

const STORAGE_KEY = 'ai_assistant_settings';

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

const defaultConfig: AIConfig = {
  textConfig: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  },
  visionConfig: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  },
  translateConfig: {
    sourceLang: 'auto',
    targetLang: 'zh'
  },
  hasCompletedWelcome: false,
  autoHideOnBlur: true,
  popupShortcut: 'Alt+Q',
  captureShortcut: 'Alt+S'
};

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

const normalizeConfig = (partial: Partial<AIConfig> | undefined): AIConfig => ({
  textConfig: normalizeModelConfig(partial?.textConfig, defaultConfig.textConfig),
  visionConfig: normalizeModelConfig(partial?.visionConfig, defaultConfig.visionConfig),
  translateConfig: {
    sourceLang: partial?.translateConfig?.sourceLang ?? defaultConfig.translateConfig.sourceLang,
    targetLang: partial?.translateConfig?.targetLang ?? defaultConfig.translateConfig.targetLang
  },
  hasCompletedWelcome: partial?.hasCompletedWelcome ?? defaultConfig.hasCompletedWelcome,
  autoHideOnBlur: partial?.autoHideOnBlur ?? defaultConfig.autoHideOnBlur,
  popupShortcut: partial?.popupShortcut ?? defaultConfig.popupShortcut,
  captureShortcut: partial?.captureShortcut ?? defaultConfig.captureShortcut
});

export const useSettingsStore = defineStore('settings', () => {
  const config = ref<AIConfig>(defaultConfig);

  // Load from localStorage on init
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    console.log('[Settings] Raw localStorage:', stored);
    if (stored) {
      const parsed = JSON.parse(stored);
      console.log('[Settings] Parsed config:', JSON.stringify(parsed, null, 2));
      if (parsed.textConfig && parsed.visionConfig) {
        config.value = normalizeConfig(parsed);
        console.log('[Settings] Loaded config into store');
      }
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }

  const saveToStorage = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config.value));
      console.log('[Settings] Saved to localStorage:', JSON.stringify(config.value, null, 2));
    } catch (e) {
      console.error('Failed to save settings:', e);
    }
  };

  const isTextConfigured = () => {
    return config.value.textConfig.apiKey.trim() !== '' && config.value.textConfig.baseUrl.trim() !== '';
  };

  const isVisionConfigured = () => {
    console.log('[Settings] isVisionConfigured check:', {
      visionApiKey: config.value.visionConfig.apiKey,
      visionBaseUrl: config.value.visionConfig.baseUrl,
      result: config.value.visionConfig.apiKey.trim() !== '' && config.value.visionConfig.baseUrl.trim() !== ''
    });
    return config.value.visionConfig.apiKey.trim() !== '' && config.value.visionConfig.baseUrl.trim() !== '';
  };

  const isConfigured = () => {
    return isTextConfigured() && isVisionConfigured();
  };

  const updateConfig = (newConfig: AIConfig) => {
    config.value = normalizeConfig(JSON.parse(JSON.stringify(newConfig)));
    saveToStorage();
  };

  const completeWelcome = () => {
    config.value = {
      ...config.value,
      hasCompletedWelcome: true
    };
    saveToStorage();
  };

  return {
    config,
    isConfigured,
    isTextConfigured,
    isVisionConfigured,
    updateConfig,
    completeWelcome
  };
});
