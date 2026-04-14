<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { aiClient, type ChatMessage } from '../utils/aiClient';
import { useSettingsStore } from '../stores/settings';
import { useHistoryStore } from '../stores/history';
import SettingsPanel from '../components/SettingsPanel.vue';

const appWindow = getCurrentWebviewWindow();
const settingsStore = useSettingsStore();
const historyStore = useHistoryStore();

const messages = ref<ChatMessage[]>([]);
const inputText = ref('');
const isStreaming = ref(false);
const streamingText = ref('');
const showSettings = ref(false);
const showHistory = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);

const scrollToBottom = async () => {
  await nextTick();
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
  }
};

// Save messages to history when they change
watch(messages, (newMessages) => {
  if (newMessages.length > 0) {
    historyStore.updateCurrentMessages(newMessages);
  }
}, { deep: true });

// Listen for show-settings event from Rust
onMounted(async () => {
  await listen('show-settings', () => {
    showSettings.value = true;
  });
});

const sendMessage = async () => {
  console.log('sendMessage called, input:', inputText.value, 'streaming:', isStreaming.value);

  if (!inputText.value.trim() || isStreaming.value) {
    console.log('Early return: empty input or streaming');
    return;
  }

  if (!settingsStore.isTextConfigured()) {
    console.log('Not configured, showing settings');
    showSettings.value = true;
    return;
  }

  // Create new conversation if none exists
  if (!historyStore.currentConversationId) {
    historyStore.createConversation();
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: inputText.value
  };

  messages.value.push(userMessage);
  inputText.value = '';
  isStreaming.value = true;
  streamingText.value = '';

  await scrollToBottom();

  try {
    await aiClient.chatStream(messages.value, {
      onStart: () => {
        streamingText.value = '';
      },
      onToken: (token) => {
        streamingText.value += token;
        scrollToBottom();
      },
      onComplete: (fullText) => {
        messages.value.push({
          role: 'assistant',
          content: fullText
        });
        streamingText.value = '';
        isStreaming.value = false;
        scrollToBottom();
      },
      onError: (error) => {
        console.error('AI Error:', error);
        messages.value.push({
          role: 'assistant',
          content: `Error: ${error.message}`
        });
        streamingText.value = '';
        isStreaming.value = false;
        scrollToBottom();
      }
    });
  } catch (error: any) {
    console.error('Failed to send message:', error);
    messages.value.push({
      role: 'assistant',
      content: `Failed to send: ${error.message || 'Unknown error'}`
    });
    isStreaming.value = false;
    streamingText.value = '';
    scrollToBottom();
  }
};

const closeWindow = async () => {
  await appWindow.hide();
};

const openSettings = () => {
  showSettings.value = true;
};

// New chat - clear current conversation
const newChat = () => {
  messages.value = [];
  historyStore.createConversation();
  showHistory.value = false;
};

// Toggle history panel
const toggleHistory = () => {
  showHistory.value = !showHistory.value;
};

// Load a conversation from history
const loadFromHistory = (id: string) => {
  const conv = historyStore.loadConversation(id);
  if (conv) {
    messages.value = [...conv.messages];
    showHistory.value = false;
  }
};

// Delete a conversation
const deleteFromHistory = (id: string, event: Event) => {
  event.stopPropagation();
  historyStore.deleteConversation(id);
};

// Header drag functionality
const handleHeaderMouseDown = async (e: MouseEvent) => {
  // Don't start dragging if clicking on buttons
  if ((e.target as HTMLElement).closest('.header-actions')) return;
  if ((e.target as HTMLElement).closest('.header-left')) return;
  await appWindow.startDragging();
};
</script>

<template>
  <div class="main-window">
    <SettingsPanel v-if="showSettings" @close="showSettings = false" />

    <div v-else class="chat-view">
      <!-- Draggable Header -->
      <div
        class="header"
        @mousedown="handleHeaderMouseDown"
      >
        <div class="header-left" @mousedown.stop>
          <button class="action-btn" @click="newChat" title="New Chat">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button class="action-btn" @click="toggleHistory" title="History">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
        <h2 class="header-title">AI Research Assistant</h2>
        <div class="header-actions" @mousedown.stop>
          <button class="icon-btn" @click="openSettings" title="Settings">⚙️</button>
          <button class="close-btn" @click="closeWindow">×</button>
        </div>
      </div>

      <!-- History Panel -->
      <div v-if="showHistory" class="history-panel">
        <div class="history-header">
          <span>History</span>
          <button class="close-history" @click="showHistory = false">×</button>
        </div>
        <div class="history-list">
          <div
            v-for="conv in historyStore.conversations"
            :key="conv.id"
            class="history-item"
            @click="loadFromHistory(conv.id)"
          >
            <span class="history-title">{{ conv.title || 'New Chat' }}</span>
            <button class="delete-btn" @click="deleteFromHistory(conv.id, $event)">×</button>
          </div>
          <div v-if="historyStore.conversations.length === 0" class="history-empty">
            No history yet
          </div>
        </div>
      </div>

      <div ref="messagesContainer" class="messages-container">
        <div
          v-for="(msg, idx) in messages"
          :key="idx"
          :class="['message', msg.role === 'user' ? 'user-message' : 'ai-message']"
        >
          <div class="message-content">{{ msg.content }}</div>
        </div>

        <div v-if="isStreaming && streamingText" class="message ai-message streaming">
          <div class="message-content">{{ streamingText }}</div>
          <div class="streaming-indicator">▋</div>
        </div>

        <div v-if="messages.length === 0 && !isStreaming" class="empty-state">
          <div class="empty-icon">💡</div>
          <p class="empty-text">Ask me anything about your research</p>
          <p class="empty-hint">LaTeX, citations, translations, and more</p>
        </div>
      </div>

      <div class="input-container">
        <input
          v-model="inputText"
          type="text"
          placeholder="Ask me anything..."
          class="input-field"
          :disabled="isStreaming"
          @keyup.enter="sendMessage"
        />
        <button
          class="send-btn"
          :disabled="isStreaming || !inputText.trim()"
          @click="sendMessage"
        >
          {{ isStreaming ? '...' : 'Send' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.main-window {
  width: 100%;
  height: 100%;
  background: rgba(7, 7, 13, 0.96);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
  position: relative;
  overflow: hidden;
}

/* Subtle radial gradient for depth */
.main-window::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(ellipse at 30% 20%, rgba(0, 229, 204, 0.03) 0%, transparent 50%);
  pointer-events: none;
}

.chat-view {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1;
}

.header {
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
  background: rgba(13, 13, 20, 0.5);
}

.header-title {
  font-family: 'Syne', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: #f0f0f5;
  letter-spacing: -0.01em;
  text-shadow: 0 0 20px rgba(0, 229, 204, 0.2);
}

.header-left {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  -webkit-app-region: no-drag;
}

.action-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.7);
  cursor: pointer;
  padding: 0.5rem;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: rgba(0, 229, 204, 0.1);
  border-color: rgba(0, 229, 204, 0.3);
  color: #00e5cc;
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  -webkit-app-region: no-drag;
}

.icon-btn {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.5);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0.25rem;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: rgba(0, 229, 204, 0.1);
  color: #00e5cc;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.5);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.history-panel {
  background: rgba(13, 13, 20, 0.98);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  max-height: 280px;
  overflow-y: auto;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.close-history {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.4);
  font-size: 1.25rem;
  cursor: pointer;
  padding: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.close-history:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.8);
}

.history-list {
  padding: 0.5rem;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.history-item:hover {
  background: rgba(0, 229, 204, 0.06);
  border-color: rgba(0, 229, 204, 0.1);
}

.history-title {
  color: rgba(240, 240, 245, 0.8);
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.delete-btn {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.3);
  font-size: 1rem;
  cursor: pointer;
  padding: 0.25rem;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  opacity: 0;
  transition: all 0.2s ease;
}

.history-item:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.history-empty {
  padding: 2rem;
  text-align: center;
  color: rgba(240, 240, 245, 0.3);
  font-size: 0.875rem;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.message {
  padding: 0.875rem 1rem;
  border-radius: 12px;
  max-width: 85%;
  word-wrap: break-word;
  animation: messageIn 0.3s ease;
}

@keyframes messageIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.user-message {
  background: linear-gradient(135deg, rgba(0, 229, 204, 0.15) 0%, rgba(0, 229, 204, 0.08) 100%);
  border: 1px solid rgba(0, 229, 204, 0.2);
  margin-left: auto;
  color: #f0f0f5;
  border-bottom-right-radius: 4px;
}

.ai-message {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #f0f0f5;
  margin-right: auto;
  border-bottom-left-radius: 4px;
}

.streaming {
  position: relative;
}

.streaming-indicator {
  display: inline;
  animation: blink 0.8s ease-in-out infinite;
  margin-left: 2px;
  color: #00e5cc;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.message-content {
  white-space: pre-wrap;
  line-height: 1.6;
  font-size: 0.9rem;
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 2rem;
  animation: fadeIn 0.5s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.empty-icon {
  font-size: 3.5rem;
  margin-bottom: 1.25rem;
  filter: grayscale(0.3);
  animation: float 3s ease-in-out infinite;
}

@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}

.empty-text {
  color: #f0f0f5;
  font-size: 1.1rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  font-family: 'Syne', sans-serif;
}

.empty-hint {
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.8rem;
  letter-spacing: 0.02em;
}

.input-container {
  padding: 1rem 1.25rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  gap: 0.75rem;
  background: rgba(13, 13, 20, 0.5);
}

.input-field {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  color: #f0f0f5;
  outline: none;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.input-field:focus {
  border-color: rgba(0, 229, 204, 0.5);
  box-shadow: 0 0 0 3px rgba(0, 229, 204, 0.1);
}

.input-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-field::placeholder {
  color: rgba(240, 240, 245, 0.35);
}

.send-btn {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  border: none;
  border-radius: 10px;
  padding: 0.75rem 1.5rem;
  color: #07070d;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  min-width: 80px;
  box-shadow: 0 2px 10px rgba(0, 229, 204, 0.2);
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(0, 229, 204, 0.3);
}

.send-btn:active:not(:disabled) {
  transform: translateY(0);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}
</style>
