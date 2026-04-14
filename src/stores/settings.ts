import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AIConfig {
  textConfig: ModelConfig;
  visionConfig: ModelConfig;
  autoHideOnBlur: boolean;
  popupShortcut: string;
  captureShortcut: string;
}

const STORAGE_KEY = 'ai_assistant_settings';

const defaultConfig: AIConfig = {
  textConfig: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  },
  visionConfig: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o'
  },
  autoHideOnBlur: true,
  popupShortcut: 'Alt+Q',
  captureShortcut: 'Alt+S'
};

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
        config.value = parsed;
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
    config.value = JSON.parse(JSON.stringify(newConfig));
    saveToStorage();
  };

  return {
    config,
    isConfigured,
    isTextConfigured,
    isVisionConfigured,
    updateConfig
  };
});