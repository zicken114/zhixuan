import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ChatMessage } from '../utils/aiClient';
import {
  loadConversations,
  loadMessages,
  saveConversation,
  saveMessages,
  deleteConversation as dbDeleteConversation
} from '../composables/useDatabase';
import { useProjectStore } from './projects';

/**
 * A simplified message type for history storage.
 * History only persists text content (images are too large for localStorage).
 */
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  projectId?: string | null;
  messages: HistoryMessage[];
  createdAt: number;
  updatedAt: number;
}

export const useHistoryStore = defineStore('history', () => {
  const conversations = ref<Conversation[]>([]);
  const currentConversationId = ref<string | null>(null);
  const projectStore = useProjectStore();

  /** Conversations filtered by current project. */
  const projectConversations = computed(() => {
    const pid = projectStore.currentProjectId;
    return conversations.value.filter(c => c.projectId === pid);
  });

  /** Load all conversations (with messages) from SQLite on app start. */
  const init = async () => {
    try {
      const convs = await loadConversations();
      for (const conv of convs) {
        conv.messages = await loadMessages(conv.id);
      }
      conversations.value = convs;
      currentConversationId.value = convs[0]?.id || null;
    } catch (e) {
      console.error('Failed to load conversations from DB:', e);
    }
  };

  // Create new conversation (optionally under current project)
  const createConversation = (): Conversation => {
    const projectId = projectStore.currentProjectId;
    const conv: Conversation = {
      id: Date.now().toString(),
      title: 'New Chat',
      projectId: projectId || null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    conversations.value.unshift(conv);
    currentConversationId.value = conv.id;
    // Persist async — fire and forget, errors logged in composable
    saveConversation(conv).catch(() => {});
    return conv;
  };

  // Get current conversation
  const getCurrentConversation = (): Conversation | null => {
    if (!currentConversationId.value) return null;
    return conversations.value.find(c => c.id === currentConversationId.value) || null;
  };

  // Update current conversation messages
  const updateCurrentMessages = async (messages: HistoryMessage[]) => {
    if (!currentConversationId.value) return;
    const conv = conversations.value.find(c => c.id === currentConversationId.value);
    if (conv) {
      conv.messages = messages;
      conv.updatedAt = Date.now();
      // Update title from first user message
      if (messages.length > 0 && messages[0].role === 'user') {
        conv.title = messages[0].content.slice(0, 30) + (messages[0].content.length > 30 ? '...' : '');
      }
      await saveConversation(conv);
      await saveMessages(conv.id, messages);
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
  const deleteConversation = async (id: string) => {
    const index = conversations.value.findIndex(c => c.id === id);
    if (index !== -1) {
      conversations.value.splice(index, 1);
      if (currentConversationId.value === id) {
        currentConversationId.value = conversations.value[0]?.id || null;
      }
      await dbDeleteConversation(id);
    }
  };

  return {
    conversations,
    currentConversationId,
    projectConversations,
    init,
    createConversation,
    getCurrentConversation,
    updateCurrentMessages,
    loadConversation,
    deleteConversation
  };
});

/**
 * Convert ChatMessage[] to HistoryMessage[] by stripping non-text content.
 * Vision messages (with images) are reduced to their text parts only.
 */
export function toHistoryMessages(messages: ChatMessage[]): HistoryMessage[] {
  return messages.map(msg => {
    let text: string;
    if (typeof msg.content === 'string') {
      text = msg.content;
    } else if (Array.isArray(msg.content)) {
      text = msg.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map(c => c.text)
        .join('');
    } else {
      text = '';
    }
    return { role: msg.role, content: text };
  });
}
