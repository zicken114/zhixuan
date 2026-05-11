<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { useProjectStore } from '../stores/projects';

const kbStore = useKnowledgeBaseStore();
const projectStore = useProjectStore();

const emit = defineEmits<{
  'open-knowledge-panel': [];
}>();

onMounted(() => {
  kbStore.loadDocuments();
});

watch(() => projectStore.currentProjectId, () => {
  kbStore.loadDocuments();
});

const statusIcon = (status: string) => {
  switch (status) {
    case 'completed': return '✓';
    case 'indexing': return '⟳';
    case 'error': return '✗';
    default: return '○';
  }
};

const statusClass = (status: string) => {
  switch (status) {
    case 'completed': return 'status-completed';
    case 'indexing': return 'status-indexing';
    case 'error': return 'status-error';
    default: return 'status-pending';
  }
};
</script>

<template>
  <div class="literature-sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">知乎素材</span>
      <button class="open-kb-btn" @click="emit('open-knowledge-panel')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
        知乎知识库
      </button>
    </div>

    <!-- Local docs section -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">知乎素材</span>
        <span class="section-count">{{ kbStore.projectDocuments.length }}</span>
      </div>
      <div v-if="kbStore.projectDocuments.length === 0" class="empty-state">
        暂无素材
      </div>
      <div class="doc-list">
        <div
          v-for="doc in kbStore.projectDocuments.slice(0, 10)"
          :key="doc.id"
          class="doc-row"
        >
          <span :class="['status-dot', statusClass(doc.indexStatus)]">
            {{ statusIcon(doc.indexStatus) }}
          </span>
          <span class="doc-name" :title="doc.fileName">{{ doc.fileName }}</span>
          <span v-if="doc.totalPages" class="doc-meta">{{ doc.totalPages }}页</span>
        </div>
        <div v-if="kbStore.projectDocuments.length > 10" class="more-hint">
          +{{ kbStore.projectDocuments.length - 10 }} 更多知乎素材
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

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.doc-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  font-size: 0.78rem;
  color: var(--text-secondary);
  transition: background 0.15s ease;
}

.doc-row:hover {
  background: var(--bg-card-hover);
}

.status-dot {
  font-size: 0.65rem;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.status-completed {
  color: var(--accent);
}

.status-indexing {
  color: var(--warning);
}

.status-error {
  color: var(--error);
}

.status-pending {
  color: var(--text-dim);
}

.doc-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-meta {
  font-size: 0.7rem;
  color: var(--text-muted);
  flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace;
}

.more-hint {
  font-size: 0.7rem;
  color: var(--text-dim);
  text-align: center;
  padding: 0.25rem 0;
}
</style>
