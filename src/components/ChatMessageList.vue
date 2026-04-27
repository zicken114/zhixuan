<script setup lang="ts">
import { ref, nextTick } from 'vue';
import type { ChatMessage, CallMetadata, MessageContent } from '../utils/aiClient';
import type { SearchResult } from '../utils/knowledgeBase';

defineProps<{
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  metadata?: Map<number, CallMetadata>;
  kbCitations?: Map<number, SearchResult[]>;
}>();

const container = ref<HTMLElement | null>(null);

const scrollToBottom = async () => {
  await nextTick();
  if (container.value) {
    container.value.scrollTop = container.value.scrollHeight;
  }
};

const formatLatency = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const extractText = (content: MessageContent): string => {
  if (typeof content === 'string') return content;
  return content
    .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
    .map((c) => c.text)
    .join('');
};

const processedTodos = ref<Set<number>>(new Set());

const emit = defineEmits<{
  'save-to-obsidian': [content: string];
  'add-todo': [content: string];
}>();

defineExpose({ scrollToBottom });

/** Parse [TODOS] blocks from assistant message content. */
const parseTodos = (content: MessageContent): string[] => {
  const text = extractText(content);
  const match = text.match(/\[TODOS\]([\s\S]*?)\[\/TODOS\]/);
  if (!match) return [];
  return match[1]
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
};

/** Strip [TODOS] block for display. */
const stripTodos = (content: MessageContent): string => {
  const text = extractText(content);
  return text.replace(/\[TODOS\][\s\S]*?\[\/TODOS\]\n?/, '').trim();
};

const handleAddTodo = (msgIdx: number, todo: string) => {
  emit('add-todo', todo);
  processedTodos.value.add(msgIdx);
};

const handleDismissTodos = (msgIdx: number) => {
  processedTodos.value.add(msgIdx);
};
</script>

<template>
  <div ref="container" class="messages-container">
    <div
      v-for="(msg, idx) in messages"
      :key="idx"
      :class="['message', msg.role === 'user' ? 'user-message' : 'ai-message']"
    >
      <div class="message-content">{{ msg.role === 'assistant' ? stripTodos(msg.content) : msg.content }}</div>
      <!-- Suggested todo cards -->
      <div
        v-if="msg.role === 'assistant' && parseTodos(msg.content).length > 0 && !processedTodos.has(idx)"
        class="todo-suggestions"
      >
        <div class="todo-suggestions-header">
          <span class="todo-icon">📌</span>
          <span class="todo-label">Suggested todos from this reply</span>
        </div>
        <div
          v-for="(todo, tIdx) in parseTodos(msg.content)"
          :key="tIdx"
          class="todo-card"
        >
          <span class="todo-text">{{ todo }}</span>
          <div class="todo-actions">
            <button class="todo-btn add" @click="handleAddTodo(idx, todo)">Add</button>
            <button class="todo-btn dismiss" @click="handleDismissTodos(idx)">Ignore</button>
          </div>
        </div>
      </div>
      <!-- Message actions for AI messages -->
      <div v-if="msg.role === 'assistant'" class="message-actions">
        <button
          class="action-btn"
          title="Save to Obsidian"
          @click="emit('save-to-obsidian', extractText(msg.content))"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          Obsidian
        </button>
      </div>
      <!-- KB citations for AI messages -->
      <div
        v-if="msg.role === 'assistant' && kbCitations?.has(idx)"
        class="kb-citations"
      >
        <details class="citations-details">
          <summary class="citations-summary">
            <span class="citations-icon">📚</span>
            <span>References from knowledge base</span>
            <span class="citations-count">({{ kbCitations.get(idx)?.length }})</span>
          </summary>
          <div class="citations-list">
            <div
              v-for="(cite, cIdx) in kbCitations.get(idx)"
              :key="cIdx"
              class="citation-item"
            >
              <span class="citation-doc">{{ cite.docName }}</span>
              <span v-if="cite.chunk.pageNumber" class="citation-page">p.{{ cite.chunk.pageNumber }}</span>
              <span class="citation-score">{{ (cite.score * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </details>
      </div>
      <!-- Model metadata badge for AI messages -->
      <div
        v-if="msg.role === 'assistant' && metadata?.has(idx)"
        class="model-badge"
        :title="metadata.get(idx)?.fallbackReason || 'Model routing info'"
      >
        <span class="badge-model">via {{ metadata.get(idx)?.modelName }}</span>
        <span class="badge-sep">·</span>
        <span class="badge-latency">{{ formatLatency(metadata.get(idx)!.latencyMs) }}</span>
        <span v-if="metadata.get(idx)?.isFallback" class="badge-fallback">降级</span>
      </div>
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
</template>

<style scoped>
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
  position: relative;
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

/* Model metadata badge */
.model-badge {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 0.65rem;
  color: rgba(240, 240, 245, 0.35);
  font-family: 'JetBrains Mono', monospace;
}

.badge-model {
  color: rgba(240, 240, 245, 0.45);
}

.badge-sep {
  color: rgba(240, 240, 245, 0.2);
}

.badge-latency {
  color: rgba(0, 229, 204, 0.5);
}

.badge-fallback {
  background: rgba(239, 68, 68, 0.12);
  color: rgba(239, 68, 68, 0.7);
  padding: 0.05rem 0.3rem;
  border-radius: 4px;
  font-size: 0.6rem;
  margin-left: 0.2rem;
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

.message-actions {
  display: flex;
  gap: 0.4rem;
  margin-top: 0.4rem;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message:hover .message-actions {
  opacity: 1;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 4px;
  padding: 0.2rem 0.45rem;
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: rgba(0, 229, 204, 0.1);
  border-color: rgba(0, 229, 204, 0.2);
  color: #00e5cc;
}

/* Todo suggestion cards */
.todo-suggestions {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: rgba(0, 229, 204, 0.05);
  border: 1px solid rgba(0, 229, 204, 0.15);
  border-radius: 10px;
}

.todo-suggestions-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
  color: rgba(0, 229, 204, 0.7);
  font-weight: 600;
}

.todo-icon {
  font-size: 0.9rem;
}

.todo-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.6rem;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  margin-bottom: 0.4rem;
}

.todo-card:last-child {
  margin-bottom: 0;
}

.todo-text {
  font-size: 0.82rem;
  color: rgba(240, 240, 245, 0.8);
  flex: 1;
  line-height: 1.4;
}

.todo-actions {
  display: flex;
  gap: 0.35rem;
  flex-shrink: 0;
}

.todo-btn {
  padding: 0.3rem 0.6rem;
  border-radius: 6px;
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.todo-btn.add {
  background: rgba(0, 229, 204, 0.15);
  color: #00e5cc;
}

.todo-btn.add:hover {
  background: rgba(0, 229, 204, 0.25);
}

.todo-btn.dismiss {
  background: rgba(255, 255, 255, 0.04);
  color: rgba(240, 240, 245, 0.4);
}

.todo-btn.dismiss:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.6);
}

/* KB citation panel */
.kb-citations {
  margin-top: 0.6rem;
  padding: 0.5rem 0.6rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

.citations-details {
  cursor: pointer;
}

.citations-summary {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.75rem;
  color: rgba(240, 240, 245, 0.5);
  font-weight: 500;
  list-style: none;
}

.citations-summary::-webkit-details-marker {
  display: none;
}

.citations-icon {
  font-size: 0.85rem;
}

.citations-count {
  color: rgba(0, 229, 204, 0.6);
  font-size: 0.7rem;
}

.citations-list {
  margin-top: 0.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.citation-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.4rem;
  background: rgba(255, 255, 255, 0.02);
  border-radius: 6px;
  font-size: 0.72rem;
}

.citation-doc {
  color: rgba(240, 240, 245, 0.7);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.citation-page {
  color: rgba(0, 229, 204, 0.6);
  font-size: 0.68rem;
  flex-shrink: 0;
}

.citation-score {
  color: rgba(240, 240, 245, 0.3);
  font-size: 0.65rem;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace;
}
</style>
