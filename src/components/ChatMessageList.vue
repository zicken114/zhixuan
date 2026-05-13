<script setup lang="ts">
import { ref, nextTick } from 'vue';
import type { ChatMessage, CallMetadata, MessageContent } from '../utils/aiClient';
import type { SearchResult } from '../utils/knowledgeBase';
import { useI18n } from '../composables/useI18n';

const { t } = useI18n();

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

const emit = defineEmits<{
  'save-to-obsidian': [content: string];
  'add-todo': [content: string];
}>();

defineExpose({ scrollToBottom });

const stripTodos = (content: MessageContent): string => {
  const text = extractText(content);
  return text.replace(/\[TODOS\][\s\S]*?\[\/TODOS\]\n?/, '').trim();
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

      <div v-if="msg.role === 'assistant'" class="message-actions">
        <button
          class="action-btn"
          :title="t('chatHeader.saveToObsidian')"
          @click="emit('save-to-obsidian', extractText(msg.content))"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          {{ t('chatMessages.obsidian') }}
        </button>
      </div>

      <div
        v-if="msg.role === 'assistant' && kbCitations?.has(idx)"
        class="kb-citations"
      >
        <details class="citations-details">
          <summary class="citations-summary">
            <span class="citations-icon">📚</span>
            <span>{{ t('chatMessages.references') }}</span>
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

      <div
        v-if="msg.role === 'assistant' && metadata?.has(idx)"
        class="model-badge"
        :title="metadata.get(idx)?.fallbackReason || t('chatMessages.modelInfo')"
      >
        <span class="badge-model">{{ t('chatMessages.via') }} {{ metadata.get(idx)?.modelName }}</span>
        <span class="badge-sep">·</span>
        <span class="badge-latency">{{ formatLatency(metadata.get(idx)!.latencyMs) }}</span>
        <span v-if="metadata.get(idx)?.isFallback" class="badge-fallback">{{ t('chatMessages.fallback') }}</span>
      </div>
    </div>

    <div v-if="isStreaming && streamingText" class="message ai-message streaming">
      <div class="message-content">{{ streamingText }}</div>
      <div class="streaming-indicator">▋</div>
    </div>

    <div v-if="messages.length === 0 && !isStreaming" class="empty-state">
      <div class="empty-icon">💡</div>
      <p class="empty-text">{{ t('chatMessages.emptyTitle') }}</p>
      <p class="empty-hint">{{ t('chatMessages.emptyHint') }}</p>
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
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  margin-left: auto;
  color: var(--text-primary);
  border-bottom-right-radius: 4px;
}

.ai-message {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  color: var(--text-primary);
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
  color: var(--accent);
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

.model-badge {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid var(--border-subtle);
  font-size: 0.65rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.badge-model {
  color: var(--text-secondary);
}

.badge-sep {
  color: var(--text-dim);
}

.badge-latency {
  color: var(--accent);
}

.badge-fallback {
  background: rgba(234, 67, 53, 0.12);
  color: var(--error);
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
  color: var(--text-primary);
  font-size: 1.1rem;
  font-weight: 500;
  margin-bottom: 0.5rem;
  font-family: 'Syne', sans-serif;
}

.empty-hint {
  color: var(--text-muted);
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
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 0.2rem 0.45rem;
  color: var(--text-muted);
  font-size: 0.68rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
}

.todo-suggestions {
  margin-top: 0.75rem;
  padding: 0.75rem;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 10px;
}

.todo-suggestions-header {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
  font-size: 0.75rem;
  color: var(--accent);
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
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  margin-bottom: 0.4rem;
}

.todo-card:last-child {
  margin-bottom: 0;
}

.todo-text {
  font-size: 0.82rem;
  color: var(--text-primary);
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
  background: var(--accent-subtle);
  color: var(--accent);
}

.todo-btn.add:hover {
  background: var(--accent-border);
}

.todo-btn.dismiss {
  background: var(--bg-surface);
  color: var(--text-muted);
}

.todo-btn.dismiss:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.kb-citations {
  margin-top: 0.6rem;
  padding: 0.5rem 0.6rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
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
  color: var(--text-secondary);
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
  color: var(--accent);
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
  background: var(--bg-surface);
  border-radius: 6px;
  font-size: 0.72rem;
}

.citation-doc {
  color: var(--text-primary);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.citation-page {
  color: var(--accent);
  font-size: 0.68rem;
  flex-shrink: 0;
}

.citation-score {
  color: var(--text-muted);
  font-size: 0.65rem;
  flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace;
}
</style>
