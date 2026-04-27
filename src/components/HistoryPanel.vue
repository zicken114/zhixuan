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
</style>
