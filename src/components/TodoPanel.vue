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
    case 'high': return 'var(--error)';
    case 'medium': return 'var(--warning)';
    case 'low': return 'var(--success)';
    default: return 'var(--text-muted)';
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
  background: var(--bg-elevated);
  border-bottom: 1px solid var(--border-subtle);
  max-height: 320px;
  overflow-y: auto;
}

.todo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.875rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.close-todo {
  background: none;
  border: none;
  color: var(--text-muted);
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
  background: var(--error-bg);
  color: var(--error);
}

.todo-input-row {
  display: flex;
  gap: 0.4rem;
  padding: 0.6rem 1.25rem;
  border-bottom: 1px solid var(--border-subtle);
}

.todo-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.45rem 0.7rem;
  color: var(--text-primary);
  font-size: 0.82rem;
  outline: none;
  transition: all 0.2s ease;
}

.todo-input::placeholder {
  color: var(--text-muted);
}

.todo-input:focus {
  border-color: var(--accent-border);
  background: var(--bg-input-hover);
}

.todo-add-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  color: var(--accent);
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.todo-add-btn:hover {
  background: var(--accent-border);
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
  background: var(--bg-card-hover);
}

.todo-item.completed .todo-content {
  text-decoration: line-through;
  color: var(--text-muted);
}

.todo-check {
  width: 18px;
  height: 18px;
  border-radius: 5px;
  border: 1.5px solid var(--border-medium);
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  color: var(--accent);
  font-size: 0.7rem;
  padding: 0;
  transition: all 0.15s ease;
}

.todo-check.checked {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
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
  color: var(--text-primary);
  line-height: 1.4;
  word-break: break-word;
}

.todo-delete {
  background: none;
  border: none;
  color: var(--text-dim);
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
  background: var(--error-bg);
  color: var(--error);
}

.todo-empty {
  padding: 1.5rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.8rem;
}
</style>
