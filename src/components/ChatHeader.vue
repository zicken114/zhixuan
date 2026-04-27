<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const appWindow = getCurrentWebviewWindow();

const emit = defineEmits<{
  newChat: [];
  toggleHistory: [];
  toggleKnowledge: [];
  toggleTodos: [];
  openSettings: [];
  close: [];
}>();

const handleMouseDown = async (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('.header-actions')) return;
  if ((e.target as HTMLElement).closest('.header-left')) return;
  await appWindow.startDragging();
};
</script>

<template>
  <div class="header" @mousedown="handleMouseDown">
    <div class="header-left" @mousedown.stop>
      <button class="action-btn" @click="emit('newChat')" title="New Chat">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleHistory')" title="History">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleKnowledge')" title="Knowledge Base">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleTodos')" title="Todos">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      </button>
    </div>
    <h2 class="header-title">AI Research Assistant</h2>
    <div class="header-actions" @mousedown.stop>
      <button class="icon-btn" @click="emit('openSettings')" title="Settings">⚙️</button>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>
  </div>
</template>

<style scoped>
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
</style>
