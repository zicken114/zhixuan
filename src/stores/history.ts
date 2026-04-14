import { defineStore } from 'pinia';
import { ref } from 'vue';

export interface Conversation {
  id: string;
  title: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

export const useHistoryStore = defineStore('history', () => {
  const conversations = ref<Conversation[]>([]);
  const currentConversationId = ref<string | null>(null);

  // Load from localStorage on init
  const loadFromStorage = () => {
    try {
      const stored = localStorage.getItem('conversations');
      if (stored) {
        conversations.value = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load conversations:', e);
    }
  };

  // Save to localStorage
  const saveToStorage = () => {
    try {
      localStorage.setItem('conversations', JSON.stringify(conversations.value));
    } catch (e) {
      console.error('Failed to save conversations:', e);
    }
  };

  // Create new conversation
  const createConversation = (): Conversation => {
    const conv: Conversation = {
      id: Date.now().toString(),
      title: 'New Chat',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    conversations.value.unshift(conv);
    currentConversationId.value = conv.id;
    saveToStorage();
    return conv;
  };

  // Get current conversation
  const getCurrentConversation = (): Conversation | null => {
    if (!currentConversationId.value) return null;
    return conversations.value.find(c => c.id === currentConversationId.value) || null;
  };

  // Update current conversation messages
  const updateCurrentMessages = (messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>) => {
    if (!currentConversationId.value) return;
    const conv = conversations.value.find(c => c.id === currentConversationId.value);
    if (conv) {
      conv.messages = messages;
      conv.updatedAt = Date.now();
      // Update title from first user message
      if (messages.length > 0 && messages[0].role === 'user') {
        conv.title = messages[0].content.slice(0, 30) + (messages[0].content.length > 30 ? '...' : '');
      }
      saveToStorage();
    }
  };

  // Load a conversation
  const loadConversation = (id: string): Conversation | null => {
    const conv = conversations.value.find(c => c.id === id);
    if (conv) {
      currentConversationId.value = id;
      return conv;
    }
    return null;
  };

  // Delete a conversation
  const deleteConversation = (id: string) => {
    const index = conversations.value.findIndex(c => c.id === id);
    if (index !== -1) {
      conversations.value.splice(index, 1);
      if (currentConversationId.value === id) {
        currentConversationId.value = conversations.value[0]?.id || null;
      }
      saveToStorage();
    }
  };

  // Initialize
  loadFromStorage();

  return {
    conversations,
    currentConversationId,
    createConversation,
    getCurrentConversation,
    updateCurrentMessages,
    loadConversation,
    deleteConversation
  };
});
