<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useI18n } from '../composables/useI18n';

const appWindow = getCurrentWebviewWindow();
const { t } = useI18n();

const emit = defineEmits<{
  newChat: [];
  toggleHistory: [];
  toggleKnowledge: [];
  toggleTodos: [];
  toggleSentinel: [];
  toggleExperiment: [];
  toggleDashboard: [];
  togglePlugin: [];
  toggleTeam: [];
  openSettings: [];
  saveToObsidian: [];
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
      <button class="action-btn" @click="emit('newChat')" :title="t('chatHeader.newChat')">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleHistory')" :title="t('chatHeader.history')">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleKnowledge')" :title="t('chatHeader.knowledge')">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleSentinel')" :title="t('chatHeader.sentinel')">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleExperiment')" :title="t('chatHeader.experiment')">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </button>
      <button class="action-btn" @click="emit('toggleDashboard')" :title="t('chatHeader.dashboard')">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </button>
    </div>
    <div class="header-actions" @mousedown.stop>
      <button class="icon-btn" @click="emit('openSettings')" :title="t('common.settings')">⚙️</button>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>
  </div>
</template>

<style scoped>
.header {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
  background: var(--bg-surface);
}

.header-left {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 0.1rem;
  -webkit-app-region: no-drag;
}

.header-left::-webkit-scrollbar {
  display: none;
}

.action-btn {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
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
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
}

.header-actions {
  display: flex;
  gap: 0.35rem;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
  -webkit-app-region: no-drag;
}

.icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0.25rem;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.icon-btn:hover {
  background: var(--accent-subtle);
  color: var(--accent);
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.35rem;
  cursor: pointer;
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}
</style>
