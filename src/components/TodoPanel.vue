<script setup lang="ts">
import { ref } from 'vue';
import type { ProjectTodo } from '../stores/projects';

defineProps<{
  todos: ProjectTodo[];
}>();

const emit = defineEmits<{
  toggle: [todo: ProjectTodo];
  delete: [id: number];
  add: [content: string];
  close: [];
}>();

const newTodoText = ref('');

const handleAdd = () => {
  const text = newTodoText.value.trim();
  if (!text) return;
  emit('add', text);
  newTodoText.value = '';
};

const priorityColor = (priority: string): string => {
  switch (priority) {
    case 'high': return '#ef4444';
    case 'medium': return '#f59e0b';
    case 'low': return '#10b981';
    default: return '#6b7280';
  }
};
</script>

<template>
  <div class="todo-panel">
    <div class="todo-header">
      <span>Todos</span>
      <button class="close-todo" @click="emit('close')">×</button>
    </div>

    <div class="todo-input-row">
      <input
        v-model="newTodoText"
        class="todo-input"
        placeholder="Add a todo..."
        @keydown.enter="handleAdd"
      />
      <button class="todo-add-btn" @click="handleAdd">+</button>
    </div>

    <div class="todo-list">
      <div
        v-for="todo in todos"
        :key="todo.id"
        class="todo-item"
        :class="{ completed: todo.status === 'completed' }"
      >
        <button
          class="todo-check"
          :class="{ checked: todo.status === 'completed' }"
          @click="emit('toggle', todo)"
        >
          <span v-if="todo.status === 'completed'">✓</span>
        </button>
        <span class="todo-priority-dot" :style="{ background: priorityColor(todo.priority) }" />
        <span class="todo-content">{{ todo.content }}</span>
        <button class="todo-delete" @click="emit('delete', todo.id!)">×</button>
      </div>
      <div v-if="todos.length === 0" class="todo-empty">
        No todos yet. Add one above or let AI suggest them during chat.
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo-panel {
  background: rgba(13, 13, 20, 0.98);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  max-height: 320px;
  overflow-y: auto;
}

.todo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.close-todo {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.4);
  font-size: 1.25rem;
  cursor: pointer;
  line-height: 1;
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.close-todo:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.todo-input-row {
  display: flex;
  gap: 0.4rem;
  padding: 0.6rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.todo-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 0.45rem 0.7rem;
  color: #f0f0f5;
  font-size: 0.82rem;
  outline: none;
  transition: all 0.2s ease;
}

.todo-input::placeholder {
  color: rgba(240, 240, 245, 0.3);
}

.todo-input:focus {
  border-color: rgba(0, 229, 204, 0.3);
  background: rgba(255, 255, 255, 0.06);
}

.todo-add-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 229, 204, 0.12);
  border: 1px solid rgba(0, 229, 204, 0.2);
  border-radius: 8px;
  color: #00e5cc;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.todo-add-btn:hover {
  background: rgba(0, 229, 204, 0.2);
}

.todo-list {
  padding: 0.5rem 0;
}

.todo-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1.25rem;
  cursor: pointer;
  transition: background 0.15s ease;
  min-height: 40px;
}

.todo-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.todo-item.completed .todo-content {
  text-decoration: line-through;
  color: rgba(240, 240, 245, 0.35);
}

.todo-check {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  color: #00e5cc;
  font-size: 0.7rem;
  padding: 0;
  transition: all 0.15s ease;
}

.todo-check.checked {
  background: rgba(0, 229, 204, 0.15);
  border-color: rgba(0, 229, 204, 0.4);
}

.todo-priority-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.todo-content {
  flex: 1;
  font-size: 0.82rem;
  color: rgba(240, 240, 245, 0.8);
  line-height: 1.4;
  word-break: break-word;
}

.todo-delete {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.25);
  font-size: 1rem;
  cursor: pointer;
  padding: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  opacity: 0;
  transition: all 0.15s ease;
}

.todo-item:hover .todo-delete {
  opacity: 1;
}

.todo-delete:hover {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.todo-empty {
  padding: 1.5rem;
  text-align: center;
  color: rgba(240, 240, 245, 0.3);
  font-size: 0.8rem;
}
</style>
