<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { useProjectStore } from '../stores/projects';
import { searchZoteroCache, type ZoteroItem } from '../utils/zoteroBridge';
import { ref } from 'vue';

const kbStore = useKnowledgeBaseStore();
const projectStore = useProjectStore();

const zoteroItems = ref<ZoteroItem[]>([]);
const zoteroLoading = ref(false);

const emit = defineEmits<{
  'open-knowledge-panel': [];
}>();

onMounted(() => {
  kbStore.loadDocuments();
  loadZoteroItems();
});

watch(() => projectStore.currentProjectId, () => {
  kbStore.loadDocuments();
  loadZoteroItems();
});

const loadZoteroItems = async () => {
  zoteroLoading.value = true;
  try {
    zoteroItems.value = await searchZoteroCache('', 20);
  } catch (e) {
    console.warn('[LiteratureSidebar] Failed to load Zotero items:', e);
    zoteroItems.value = [];
  } finally {
    zoteroLoading.value = false;
  }
};

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
      <span class="sidebar-title">Literature</span>
      <button class="open-kb-btn" @click="emit('open-knowledge-panel')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
        </svg>
        Knowledge Base
      </button>
    </div>

    <!-- Local docs section -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Local Documents</span>
        <span class="section-count">{{ kbStore.projectDocuments.length }}</span>
      </div>
      <div v-if="kbStore.projectDocuments.length === 0" class="empty-state">
        No documents indexed.
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
          <span v-if="doc.totalPages" class="doc-meta">{{ doc.totalPages }}p</span>
        </div>
        <div v-if="kbStore.projectDocuments.length > 10" class="more-hint">
          +{{ kbStore.projectDocuments.length - 10 }} more in Knowledge Base
        </div>
      </div>
    </div>

    <!-- Zotero section -->
    <div class="section">
      <div class="section-header">
        <span class="section-title">Zotero Library</span>
        <span class="section-count">{{ zoteroItems.length }}</span>
      </div>
      <div v-if="zoteroLoading" class="empty-state">Loading...</div>
      <div v-else-if="zoteroItems.length === 0" class="empty-state">
        No Zotero items cached.
      </div>
      <div class="doc-list">
        <div
          v-for="item in zoteroItems.slice(0, 8)"
          :key="item.key"
          class="doc-row"
        >
          <span class="doc-name" :title="item.title || 'Untitled'">
            {{ item.title || 'Untitled' }}
          </span>
          <span v-if="item.date" class="doc-meta">{{ item.date.split('-')[0] }}</span>
        </div>
        <div v-if="zoteroItems.length > 8" class="more-hint">
          +{{ zoteroItems.length - 8 }} more in Knowledge Base
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.literature-sidebar {
  width: 100%;
  height: 100%;
  background: rgba(7, 7, 13, 0.96);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.875rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(13, 13, 20, 0.5);
}

.sidebar-title {
  font-family: 'Syne', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  color: #f0f0f5;
}

.open-kb-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.7rem;
  background: rgba(0, 229, 204, 0.1);
  border: 1px solid rgba(0, 229, 204, 0.2);
  border-radius: 6px;
  color: #00e5cc;
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.open-kb-btn:hover {
  background: rgba(0, 229, 204, 0.2);
}

.section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
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
  color: rgba(240, 240, 245, 0.5);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-count {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.3);
  font-family: 'JetBrains Mono', monospace;
}

.empty-state {
  font-size: 0.78rem;
  color: rgba(240, 240, 245, 0.25);
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
  color: rgba(240, 240, 245, 0.7);
  transition: background 0.15s ease;
}

.doc-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.status-dot {
  font-size: 0.65rem;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.status-completed {
  color: #00e5cc;
}

.status-indexing {
  color: #f59e0b;
}

.status-error {
  color: #ef4444;
}

.status-pending {
  color: rgba(240, 240, 245, 0.25);
}

.doc-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-meta {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.3);
  flex-shrink: 0;
  font-family: 'JetBrains Mono', monospace;
}

.more-hint {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.25);
  text-align: center;
  padding: 0.25rem 0;
}
</style>
