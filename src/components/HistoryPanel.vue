<script setup lang="ts">
import type { Conversation } from '../stores/history';

defineProps<{
  conversations: Conversation[];
}>();

const emit = defineEmits<{
  load: [id: string];
  delete: [id: string];
  close: [];
}>();

const handleDelete = (id: string, event: Event) => {
  event.stopPropagation();
  emit('delete', id);
};
</script>

<template>
  <div class="history-panel">
    <div class="history-header">
      <span>History</span>
      <button class="close-history" @click="emit('close')">×</button>
    </div>
    <div class="history-list">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        class="history-item"
        @click="emit('load', conv.id)"
      >
        <span class="history-title">{{ conv.title || 'New Chat' }}</span>
        <button class="delete-btn" @click="handleDelete(conv.id, $event)">×</button>
      </div>
      <div v-if="conversations.length === 0" class="history-empty">
        No history yet
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-panel {
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-subtle);
  max-height: 280px;
  overflow-y: auto;
}

.history-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.close-history {
  background: none;
  border: none;
  color: var(--text-muted);
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
  background: var(--bg-card-hover);
  color: var(--text-secondary);
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
  background: var(--accent-subtle);
  border-color: var(--accent-border);
}

.history-title {
  color: var(--text-primary);
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.delete-btn {
  background: none;
  border: none;
  color: var(--text-muted);
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
  background: rgba(234, 67, 53, 0.2);
  color: var(--error);
}

.history-empty {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}
</style>
