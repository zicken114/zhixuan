<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient } from '../utils/aiClient';
import { marked } from 'marked';

const appWindow = getCurrentWebviewWindow();
const clipboardText = ref('');
const isProcessing = ref(false);

interface ClipboardPayload {
  text: string;
  x: number;
  y: number;
}

const menuItems = [
  { icon: '🌍', label: 'Translate', action: 'translate' },
  { icon: '🧹', label: 'Clean to Word', action: 'clean' },
  { icon: '📚', label: 'Format Citation', action: 'citation' },
  { icon: '⚙️', label: 'Settings', action: 'settings' },
  { icon: '⏻', label: 'Exit', action: 'exit' }
];

let blurTimeout: number | null = null;

const handleBlur = () => {
  // Hide immediately when the popup loses focus.
  blurTimeout = window.setTimeout(async () => {
    await closeWindow();
  }, 0);
};

const handleFocus = () => {
  // Cancel the blur timer if window regains focus
  if (blurTimeout) {
    clearTimeout(blurTimeout);
    blurTimeout = null;
  }
};

onMounted(async () => {
  // Listen for clipboard data from Rust
  await listen<ClipboardPayload>('clipboard-data', (event) => {
    clipboardText.value = event.payload.text;
  });

  // Add blur/focus listeners for auto-hide
  window.addEventListener('blur', handleBlur);
  window.addEventListener('focus', handleFocus);
});

const handleAction = async (action: string) => {
  if (action === 'settings') {
    // Open settings in main window
    await invoke('show_window', { label: 'main' });
    await invoke('show_window_with_settings');
    await closeWindow();
    return;
  }

  if (action === 'exit') {
    await invoke('quit_app');
    return;
  }

  if (isProcessing.value) return;

  // Allow actions to proceed even with empty clipboard (for testing)
  // but show error after if API call fails
  if (!clipboardText.value.trim()) {
    console.log('Clipboard is empty, showing settings');
    await invoke('show_window', { label: 'main' });
    await invoke('show_window_with_settings');
    await closeWindow();
    return;
  }

  isProcessing.value = true;

  try {
    switch (action) {
      case 'translate':
        await handleTranslate();
        break;
      case 'clean':
        await handleCleanToWord();
        break;
      case 'citation':
        await handleFormatCitation();
        break;
    }
  } catch (error: any) {
    console.error('Action failed:', error);
    // Show error to user by opening main window with settings
    await invoke('show_window', { label: 'main' });
    await invoke('show_window_with_settings');
    // Close popup after showing settings
    await closeWindow();
    return;
  } finally {
    isProcessing.value = false;
  }
  await closeWindow();
};

const handleTranslate = async () => {
  const messages = [
    {
      role: 'system' as const,
      content: 'You are a professional translator. Translate the given text to English if it is in another language, or to Chinese if it is in English. Only output the translation, no explanations.'
    },
    {
      role: 'user' as const,
      content: clipboardText.value
    }
  ];

  const result = await aiClient.chatOnce(messages);
  await invoke('set_clipboard_text', { text: result });
};

const handleCleanToWord = async () => {
  const hasMarkdown = /[#*`\[\]]/g.test(clipboardText.value);

  if (hasMarkdown) {
    const html = await marked(clipboardText.value);
    await invoke('set_clipboard_html', { html });
  } else {
    const messages = [
      {
        role: 'system' as const,
        content: 'Clean up the given text by removing extra whitespace, fixing formatting issues, and making it suitable for pasting into Word. Return the cleaned text only.'
      },
      {
        role: 'user' as const,
        content: clipboardText.value
      }
    ];

    const result = await aiClient.chatOnce(messages);
    await invoke('set_clipboard_text', { text: result });
  }
};

const handleFormatCitation = async () => {
  const messages = [
    {
      role: 'system' as const,
      content: 'Convert the given citation or reference into proper BibTeX format. Only output the BibTeX entry, no explanations.'
    },
    {
      role: 'user' as const,
      content: clipboardText.value
    }
  ];

  const result = await aiClient.chatOnce(messages);
  await invoke('set_clipboard_text', { text: result });
};

const closeWindow = async () => {
  await appWindow.hide();
};
</script>

<template>
  <div class="popup-window">
    <div
      v-for="item in menuItems"
      :key="item.action"
      class="menu-item"
      :class="{ 'processing': isProcessing }"
      @click="handleAction(item.action)"
    >
      <span class="icon">{{ item.icon }}</span>
      <span class="label">{{ item.label }}</span>
    </div>

    <div v-if="isProcessing" class="processing-overlay">
      <div class="spinner"></div>
    </div>
  </div>
</template>

<style scoped>
.popup-window {
  width: 100%;
  height: 100%;
  background: rgba(13, 13, 20, 0.95);
  backdrop-filter: blur(20px);
  border-radius: 12px;
  padding: 0.5rem;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
  position: relative;
  overflow-x: hidden;
  overflow-y: auto;
}

/* Subtle glow effect at top */
.popup-window::before {
  content: '';
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 60%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 229, 204, 0.5), transparent);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: rgba(240, 240, 245, 0.8);
  position: relative;
  overflow: hidden;
}

.menu-item::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #00e5cc;
  transform: scaleY(0);
  transition: transform 0.2s ease;
  border-radius: 0 2px 2px 0;
}

.menu-item:hover:not(.processing) {
  background: rgba(0, 229, 204, 0.08);
  color: #f0f0f5;
}

.menu-item:hover:not(.processing)::before {
  transform: scaleY(1);
}

.menu-item.processing {
  opacity: 0.5;
  cursor: not-allowed;
}

.icon {
  font-size: 1.25rem;
  width: 28px;
  text-align: center;
}

.label {
  font-size: 0.875rem;
  font-weight: 500;
  letter-spacing: 0.01em;
}

.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(7, 7, 13, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  backdrop-filter: blur(8px);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(0, 229, 204, 0.15);
  border-top-color: #00e5cc;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  box-shadow: 0 0 15px rgba(0, 229, 204, 0.3);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
