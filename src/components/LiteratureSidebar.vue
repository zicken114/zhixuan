<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { fetchStoryLibrary, type StoryItem } from '../composables/useStoryLibrary';

const emit = defineEmits<{
  'open-knowledge-panel': [];
}>();

const stories = ref<StoryItem[]>([]);
const loading = ref(false);

const loadStories = async () => {
  loading.value = true;
  try {
    const result = await fetchStoryLibrary();
    stories.value = result.items;
  } catch (e) {
    console.error('[LiteratureSidebar] failed to load stories:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(() => loadStories());
</script>

<template>
  <div class="literature-sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">知乎故事素材库</span>
      <button class="open-kb-btn" @click="emit('open-knowledge-panel')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
        故事库
      </button>
    </div>

    <!-- Story list section -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">故事素材</span>
        <span class="section-count">{{ stories.length }}</span>
      </div>
      <div v-if="loading" class="empty-state">
        加载中...
      </div>
      <div v-else-if="stories.length === 0" class="empty-state">
        暂无故事素材
      </div>
      <div v-else class="story-list">
        <div
          v-for="story in stories.slice(0, 8)"
          :key="story.work_id"
          class="story-row"
        >
          <span class="story-name" :title="story.title">{{ story.title }}</span>
        </div>
        <div v-if="stories.length > 8" class="more-hint">
          +{{ stories.length - 8 }} 更多故事素材
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.literature-sidebar {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border-subtle);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
}

.sidebar-title {
  font-family: 'Syne', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.open-kb-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.7rem;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  color: var(--accent);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.open-kb-btn:hover {
  background: var(--accent-border);
}

.section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-count {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.empty-state {
  font-size: 0.78rem;
  color: var(--text-dim);
  padding: 0.5rem 0;
  text-align: center;
}

.story-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.story-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  transition: background 0.15s ease;
  cursor: default;
}

.story-row:hover {
  background: var(--bg-card-hover);
}

.story-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more-hint {
  font-size: 0.7rem;
  color: var(--text-dim);
  text-align: center;
  padding: 0.25rem 0;
}
</style>
