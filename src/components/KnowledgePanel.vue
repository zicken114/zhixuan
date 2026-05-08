<script setup lang="ts">
import { onMounted, watch, ref, computed } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { useProjectStore } from '../stores/projects';
import { useSettingsStore } from '../stores/settings';
import {
  syncZoteroLibrary,
  searchZoteroCache,
  formatCitation,
  fetchCollections,
  getCachedCollections,
  type ZoteroSyncResult
} from '../utils/zoteroBridge';
import { useClipboard } from '../composables/useClipboard';
import { useWindow } from '../composables/useWindow';
import { recordEvent } from '../composables/useEvents';
import type { ZoteroItem, ZoteroCollection } from '../composables/useDatabase';

const appWindow = getCurrentWebviewWindow();
const kbStore = useKnowledgeBaseStore();
const projectStore = useProjectStore();
const settingsStore = useSettingsStore();
const { show: showWindow } = useWindow();

const emit = defineEmits<{
  close: [];
}>();

const handleDragStart = async (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, input, .knowledge-panel')) return;
  await appWindow.startDragging();
};

onMounted(() => {
  kbStore.loadDocuments();
});

// Reload documents when project changes
watch(() => projectStore.currentProjectId, () => {
  kbStore.loadDocuments();
  kbStore.searchResults = [];
  kbStore.searchQuery = '';
});

const handleSearch = async () => {
  await kbStore.search(kbStore.searchQuery, 5);
};

const statusIcon = (status: string) => {
  switch (status) {
    case 'completed': return 'indexed';
    case 'indexing': return 'indexing...';
    case 'error': return 'error';
    default: return 'pending';
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

/* ── Zotero state ── */
const activeTab = ref<'docs' | 'zotero'>('docs');
const zoteroSyncing = ref(false);
const zoteroSyncResult = ref<ZoteroSyncResult | null>(null);
const zoteroItems = ref<ZoteroItem[]>([]);
const zoteroSearchQuery = ref('');
const zoteroSearching = ref(false);

// Collection selection
const zoteroCollections = ref<ZoteroCollection[]>([]);
const loadingCollections = ref(false);
const showCollectionSelector = ref(false);
const selectedCollections = ref<string[]>([...settingsStore.config.externalTools.zoteroSelectedCollections]);

// Collection hierarchy navigation
const currentParentKey = ref<string | null>(null);
const parentChain = ref<{ key: string | null; name: string }[]>([{ key: null, name: 'Root' }]);

const visibleCollections = computed(() => {
  return zoteroCollections.value.filter((c) => (c.parentKey ?? null) === currentParentKey.value);
});

const hasChildren = (key: string) => {
  return zoteroCollections.value.some((c) => c.parentKey === key);
};

const enterCollection = (key: string, name: string) => {
  currentParentKey.value = key;
  parentChain.value.push({ key, name });
};

const goUp = () => {
  if (parentChain.value.length > 1) {
    parentChain.value.pop();
    currentParentKey.value = parentChain.value[parentChain.value.length - 1].key;
  }
};

const goToBreadcrumb = (index: number) => {
  parentChain.value = parentChain.value.slice(0, index + 1);
  currentParentKey.value = parentChain.value[parentChain.value.length - 1].key;
};

const loadZoteroCollections = async () => {
  loadingCollections.value = true;
  try {
    // Always fetch fresh from Zotero API so we see the full library tree
    const userId = settingsStore.config.externalTools.zoteroUserId || '0';
    const apiCollections = await fetchCollections(userId);
    console.log('[KnowledgePanel] Fetched collections:', apiCollections.length, apiCollections);
    zoteroCollections.value = apiCollections.map((c) => {
      const d = c.data || {};
      return {
        id: 0,
        key: c.key || d.key || '',
        name: d.name?.trim() || '(Unnamed Collection)',
        parentKey: d.parentCollection && typeof d.parentCollection === 'string' ? d.parentCollection : undefined,
        version: c.version || d.version || 0,
        syncedAt: Date.now()
      };
    });
    // Reset hierarchy when opening selector
    currentParentKey.value = null;
    parentChain.value = [{ key: null, name: 'Root' }];
    showCollectionSelector.value = true;
  } catch (e: any) {
    console.error('[KnowledgePanel] Failed to fetch collections from API:', e);
    // Fallback to cache if API fails
    try {
      const cached = await getCachedCollections();
      if (cached.length > 0) {
        zoteroCollections.value = cached;
        currentParentKey.value = null;
        parentChain.value = [{ key: null, name: 'Root' }];
        showCollectionSelector.value = true;
      }
    } catch (_) {
      // ignore
    }
    zoteroSyncResult.value = { itemsSynced: 0, collectionsSynced: 0, success: false, error: e?.message || 'Failed to load collections' };
  } finally {
    loadingCollections.value = false;
  }
};

const toggleCollection = (key: string) => {
  const idx = selectedCollections.value.indexOf(key);
  if (idx >= 0) {
    selectedCollections.value.splice(idx, 1);
  } else {
    selectedCollections.value.push(key);
  }
};

const saveCollectionSelection = async () => {
  const newConfig = {
    ...settingsStore.config,
    externalTools: {
      ...settingsStore.config.externalTools,
      zoteroSelectedCollections: [...selectedCollections.value]
    }
  };
  await settingsStore.updateConfig(newConfig);
};

const handleZoteroSync = async (forceFullSync = true) => {
  const userId = settingsStore.config.externalTools.zoteroUserId || '0';
  const collectionKeys = settingsStore.config.externalTools.zoteroSelectedCollections;
  zoteroSyncing.value = true;
  zoteroSyncResult.value = null;
  const startTime = Date.now();
  let result: ZoteroSyncResult | null = null;
  try {
    result = await syncZoteroLibrary(userId, collectionKeys.length > 0 ? collectionKeys : undefined, forceFullSync);
    zoteroSyncResult.value = result;
    if (result.success) {
      await handleZoteroSearch();
    }
  } catch (e: any) {
    result = { itemsSynced: 0, collectionsSynced: 0, success: false, error: e?.message || 'Unknown error' };
    zoteroSyncResult.value = result;
  } finally {
    zoteroSyncing.value = false;
    await recordEvent({
      event_type: 'zotero_sync',
      project_id: projectStore.currentProjectId ?? undefined,
      duration_ms: Date.now() - startTime,
      metadata: {
        items_synced: result?.itemsSynced ?? 0,
        collections_synced: result?.collectionsSynced ?? 0,
        success: result?.success ?? false,
        force_full_sync: forceFullSync,
        error: result?.error ?? undefined,
      },
    });
  }
};

const handleZoteroSearch = async () => {
  zoteroSearching.value = true;
  try {
    zoteroItems.value = await searchZoteroCache(zoteroSearchQuery.value, 50);
  } finally {
    zoteroSearching.value = false;
  }
};

const { writeText } = useClipboard();

const copyCitation = async (item: ZoteroItem) => {
  const citation = formatCitation(item, 'gb7714');
  try {
    await writeText(citation);
  } catch {
    // fallback
    navigator.clipboard.writeText(citation);
  }
};
</script>

<template>
  <div class="knowledge-panel">
    <div class="drag-handle" @mousedown="handleDragStart"></div>
    <div class="panel-header">
      <div class="header-left">
        <button class="back-btn" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <span class="header-title">Knowledge Base</span>
      </div>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>

    <!-- Search -->
    <div class="search-section">
      <div class="search-input-wrapper">
        <input
          v-model="kbStore.searchQuery"
          type="text"
          class="search-input"
          placeholder="Search documents..."
          @keydown.enter="handleSearch"
        />
        <button
          class="search-btn"
          :disabled="kbStore.isSearching || !kbStore.searchQuery.trim()"
          @click="handleSearch"
        >
          {{ kbStore.isSearching ? '...' : 'Search' }}
        </button>
      </div>
    </div>

    <!-- Tab switcher + actions -->
    <div class="actions-section">
      <div class="tab-bar">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'docs' }"
          @click="activeTab = 'docs'"
        >
          Local Docs
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'zotero' }"
          @click="activeTab = 'zotero'"
        >
          Zotero
        </button>
      </div>
      <button class="review-btn" @click="showWindow('review_wizard')">
        📚 生成综述
      </button>

      <div v-if="activeTab === 'docs'" class="tab-actions">
        <button
          class="add-folder-btn"
          :disabled="kbStore.isIndexing || kbStore.embedderLoading"
          @click="kbStore.addFolder"
        >
          <span class="btn-icon">+</span>
          <span>{{ kbStore.isIndexing ? 'Indexing...' : 'Add Folder' }}</span>
        </button>
      </div>

      <div v-else class="tab-actions">
        <div class="zotero-action-row">
          <button
            class="add-folder-btn zotero-btn"
            :disabled="zoteroSyncing"
            @click="handleZoteroSync()"
          >
            <span>{{ zoteroSyncing ? 'Syncing...' : 'Sync Zotero' }}</span>
          </button>
          <button
            class="collection-select-btn"
            :disabled="loadingCollections"
            @click="loadZoteroCollections"
          >
            {{ loadingCollections ? '...' : 'Select Folders' }}
          </button>
        </div>
        <div v-if="settingsStore.config.externalTools.zoteroSelectedCollections.length > 0" class="sync-hint">
          Syncing {{ settingsStore.config.externalTools.zoteroSelectedCollections.length }} folder(s)
        </div>
        <div v-else class="sync-hint">
          Syncing all folders
        </div>
        <div v-if="zoteroSyncResult" class="sync-status">
          <span v-if="zoteroSyncResult.success" class="sync-ok">
            Synced {{ zoteroSyncResult.itemsSynced }} items
          </span>
          <span v-else class="sync-error">{{ zoteroSyncResult.error }}</span>
        </div>
      </div>

      <!-- Collection selector dropdown -->
      <div v-if="showCollectionSelector" class="collection-selector">
        <div class="selector-header">
          <span class="selector-title">Select folders to sync</span>
          <button class="selector-close" @click="showCollectionSelector = false">x</button>
        </div>

        <!-- Breadcrumb -->
        <div class="breadcrumb">
          <span
            v-for="(crumb, idx) in parentChain"
            :key="idx"
            class="breadcrumb-item"
            :class="{ active: idx === parentChain.length - 1 }"
            @click="goToBreadcrumb(idx)"
          >
            {{ crumb.name }}
            <span v-if="idx < parentChain.length - 1" class="breadcrumb-sep">/</span>
          </span>
        </div>

        <!-- Go up button -->
        <div v-if="parentChain.length > 1" class="go-up-row">
          <button class="go-up-btn" @click="goUp">
            ↑ Back to parent
          </button>
        </div>

        <div class="collection-list">
          <div
            v-for="coll in visibleCollections"
            :key="coll.key"
            class="collection-item"
          >
            <input
              type="checkbox"
              :checked="selectedCollections.includes(coll.key)"
              @click.stop
              @change="toggleCollection(coll.key)"
            />
            <span class="collection-name" @click="toggleCollection(coll.key)">{{ coll.name }}</span>
            <button
              v-if="hasChildren(coll.key)"
              class="enter-folder-btn"
              @click.stop="enterCollection(coll.key, coll.name)"
            >
              Open ▶
            </button>
          </div>
          <div v-if="visibleCollections.length === 0" class="empty-state" style="padding: 1rem;">
            No folders at this level.
          </div>
        </div>
        <div class="selector-actions">
          <button class="selector-btn secondary" @click="showCollectionSelector = false">Cancel</button>
          <button class="selector-btn primary" @click="saveCollectionSelection(); showCollectionSelector = false">Save</button>
        </div>
      </div>
    </div>

    <!-- Download model modal -->
    <div v-if="kbStore.showDownloadModal" class="modal-overlay" @click.self="kbStore.showDownloadModal = false">
      <div class="modal-content">
        <div v-if="kbStore.embedderLoading">
          <h3 class="modal-title">Downloading Embedding Model</h3>
          <p class="modal-desc">Xenova/all-MiniLM-L6-v2 (~22 MB)</p>
          <div class="progress-track" style="margin: 1rem 0;">
            <div class="progress-fill" :style="{ width: `${kbStore.embedderProgress}%` }" />
          </div>
          <div class="modal-desc" style="text-align: center;">{{ kbStore.embedderProgress }}%</div>
        </div>
        <div v-else-if="kbStore.embedderStatus === 'error'">
          <h3 class="modal-title" style="color: var(--error);">Download Failed</h3>
          <p class="modal-desc">{{ kbStore.lastError }}</p>
          <div class="modal-actions">
            <button class="modal-btn primary" @click="kbStore.downloadEmbedder">Retry</button>
            <button class="modal-btn secondary" @click="kbStore.showDownloadModal = false">Cancel</button>
          </div>
        </div>
        <div v-else>
          <h3 class="modal-title">Download Required</h3>
          <p class="modal-desc">
            Knowledge Base needs an embedding model (Xenova/all-MiniLM-L6-v2, ~22 MB) for semantic search.
            The model will be cached locally after first download.
          </p>
          <div class="modal-actions">
            <button class="modal-btn primary" @click="kbStore.downloadEmbedder">Download</button>
            <button class="modal-btn secondary" @click="kbStore.showDownloadModal = false">Cancel</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Indexing progress -->
    <div v-if="kbStore.isIndexing && kbStore.indexProgress.total > 0" class="progress-bar">
      <div class="progress-track">
        <div
          class="progress-fill"
          :style="{ width: `${(kbStore.indexProgress.current / kbStore.indexProgress.total) * 100}%` }"
        />
      </div>
      <div class="progress-text">
        {{ kbStore.indexProgress.current }} / {{ kbStore.indexProgress.total }} documents
      </div>
    </div>

    <!-- Error message -->
    <div v-if="kbStore.lastError" class="error-message">
      {{ kbStore.lastError }}
    </div>

    <!-- Search results -->
    <div v-if="kbStore.searchResults.length > 0" class="results-section">
      <div class="section-title">Search Results</div>
      <div
        v-for="(result, idx) in kbStore.searchResults"
        :key="`${result.docId}-${result.chunk.chunkIndex}`"
        class="result-item"
      >
        <div class="result-meta">
          <span class="result-rank">#{{ idx + 1 }}</span>
          <span class="result-score">{{ (result.score * 100).toFixed(1) }}%</span>
          <span v-if="result.chunk.pageNumber" class="result-page">
            Page {{ result.chunk.pageNumber }}
          </span>
        </div>
        <div class="result-content">{{ result.chunk.content.slice(0, 200) }}...</div>
      </div>
    </div>

    <!-- Document list -->
    <div v-if="activeTab === 'docs'" class="documents-section">
      <div class="section-title">
        Documents
        <span class="doc-count">({{ kbStore.projectDocuments.length }})</span>
      </div>

      <div v-if="kbStore.projectDocuments.length === 0" class="empty-state">
        No documents yet. Add a folder to get started.
      </div>

      <div class="doc-list">
        <div
          v-for="doc in kbStore.projectDocuments"
          :key="doc.id"
          class="doc-item"
        >
          <div class="doc-info">
            <span class="doc-name" :title="doc.fileName">{{ doc.fileName }}</span>
            <span :class="['doc-status', statusClass(doc.indexStatus)]">
              {{ statusIcon(doc.indexStatus) }}
            </span>
          </div>
          <div class="doc-meta">
            <span v-if="doc.totalPages">{{ doc.totalPages }} pages</span>
            <button
              v-if="doc.indexStatus === 'error'"
              class="doc-action"
              @click="kbStore.reindexDocument(doc)"
            >
              retry
            </button>
            <button class="doc-action delete" @click="kbStore.deleteDocument(doc.id)">
              remove
            </button>
          </div>
          <div v-if="doc.errorMessage" class="doc-error">
            {{ doc.errorMessage }}
          </div>
        </div>
      </div>
    </div>

    <!-- Zotero library -->
    <div v-else class="documents-section">
      <div class="section-title">
        Zotero Library
        <span class="doc-count">({{ zoteroItems.length }})</span>
      </div>

      <div class="search-input-wrapper" style="margin-bottom: 0.75rem;">
        <input
          v-model="zoteroSearchQuery"
          type="text"
          class="search-input"
          placeholder="Search Zotero items..."
          @keydown.enter="handleZoteroSearch"
        />
        <button
          class="search-btn"
          :disabled="zoteroSearching"
          @click="handleZoteroSearch"
        >
          {{ zoteroSearching ? '...' : 'Search' }}
        </button>
      </div>

      <div v-if="zoteroItems.length === 0" class="empty-state">
        No Zotero items cached. Click "Sync Zotero" to import your library.
      </div>

      <div class="doc-list">
        <div
          v-for="item in zoteroItems"
          :key="item.key"
          class="doc-item"
        >
          <div class="doc-info">
            <span class="doc-name" :title="item.title || 'Untitled'">
              {{ item.title || 'Untitled' }}
            </span>
            <span class="doc-status status-completed">{{ item.itemType }}</span>
          </div>
          <div class="doc-meta">
            <span v-if="item.creators">{{ item.creators }}</span>
            <span v-if="item.date">{{ item.date.split('-')[0] }}</span>
            <button class="doc-action" @click="copyCitation(item)">
              cite
            </button>
          </div>
          <div v-if="item.abstract" class="doc-abstract">
            {{ item.abstract.slice(0, 120) }}...
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.knowledge-panel {
  width: 100%;
  height: 100%;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.drag-handle {
  width: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: col-resize;
  color: var(--text-dim);
  font-size: 0.75rem;
}

.panel-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  -webkit-app-region: no-drag;
}

.header-title {
  font-family: var(--font-display);
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
}

.back-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: transparent;
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.back-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.close-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background: transparent;
  border: none;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.close-btn:hover {
  background: var(--error-bg);
  color: var(--error);
}

/* Search */
.search-section {
  padding: var(--space-md) var(--space-lg);
}

.search-input-wrapper {
  display: flex;
  gap: var(--space-sm);
}

.search-input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  color: var(--text-primary);
  font-size: 0.8125rem;
  font-family: var(--font-body);
  outline: none;
  transition: border-color var(--transition-base), box-shadow var(--transition-base);
}

.search-input:focus {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--accent-subtle);
}

.search-input::placeholder {
  color: var(--text-dim);
}

.search-btn {
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  padding: var(--space-sm) var(--space-md);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  white-space: nowrap;
}

.search-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

.search-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Actions */
.actions-section {
  padding: var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.add-folder-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm);
  color: var(--accent-text);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.add-folder-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

.add-folder-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-icon {
  font-size: 1rem;
  line-height: 1;
}

/* Progress */
.progress-bar {
  padding: var(--space-sm) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.progress-track {
  height: 4px;
  background: var(--border-subtle);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-top: 0.35rem;
  text-align: center;
}

/* Error */
.error-message {
  padding: var(--space-sm) var(--space-lg);
  background: var(--error-bg);
  border-bottom: 1px solid rgba(234, 67, 53, 0.1);
  color: var(--error);
  font-size: 0.78rem;
}

/* Results */
.results-section {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
  max-height: 200px;
  overflow-y: auto;
}

.result-item {
  padding: var(--space-sm) var(--space-xs);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-xs);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
}

.result-meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: 0.3rem;
}

.result-rank {
  font-size: 0.7rem;
  font-weight: 700;
  color: var(--accent-text);
}

.result-score {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.result-page {
  font-size: 0.7rem;
  color: var(--text-dim);
  margin-left: auto;
}

.result-content {
  font-size: 0.78rem;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* Documents */
.documents-section {
  padding: var(--space-md) var(--space-lg);
  flex: 1;
  overflow-y: auto;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--space-sm);
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.doc-count {
  color: var(--text-dim);
  font-size: 0.7rem;
}

.empty-state {
  padding: 1.5rem;
  text-align: center;
  color: var(--text-dim);
  font-size: 0.82rem;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.doc-item {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  transition: all var(--transition-fast);
  margin: 0 var(--space-md);
  margin-bottom: var(--space-xs);
}

.doc-item:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
}

.doc-info {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.doc-name {
  flex: 1;
  font-size: 0.8125rem;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-status {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  text-transform: uppercase;
}

.status-completed {
  background: var(--success-bg);
  color: var(--success);
}

.status-indexing {
  background: var(--accent-subtle);
  color: var(--accent-text);
}

.status-pending {
  background: var(--warning-bg);
  color: var(--warning);
}

.status-error {
  background: var(--error-bg);
  color: var(--error);
}

.doc-meta {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-top: var(--space-xs);
  font-size: 0.72rem;
  color: var(--text-muted);
}

.doc-action {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.7rem;
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: var(--space-xs);
  transition: all var(--transition-fast);
}

.doc-action:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.doc-action.delete:hover {
  background: var(--error-bg);
  color: var(--error);
}

.doc-error {
  margin-top: var(--space-xs);
  font-size: 0.72rem;
  color: var(--error);
  line-height: 1.4;
}

.doc-abstract {
  margin-top: var(--space-xs);
  font-size: 0.72rem;
  color: var(--text-muted);
  line-height: 1.4;
}

/* Tab bar */
.tab-bar {
  display: flex;
  gap: var(--space-xs);
  padding: 0 var(--space-lg);
  margin-bottom: var(--space-sm);
}

.review-btn {
  width: 100%;
  padding: var(--space-sm) var(--space-md);
  margin: 0 var(--space-lg) var(--space-sm);
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: var(--radius-sm);
  color: var(--accent-text);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
}

.review-btn:hover {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

.tab-btn {
  flex: 1;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  background: var(--bg-card);
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tab-btn:hover {
  border-color: var(--border-medium);
  color: var(--text-secondary);
}

.tab-btn.active {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.tab-actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.zotero-btn {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent-text);
}

.zotero-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

.sync-status {
  font-size: 0.72rem;
  text-align: center;
}

.sync-ok {
  color: var(--success);
}

.sync-error {
  color: var(--error);
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xl);
  padding: var(--space-2xl);
  width: 360px;
  max-width: 90vw;
  box-shadow: var(--shadow-xl);
}

.modal-title {
  margin: 0 0 0.6rem;
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 700;
}

.modal-desc {
  margin: 0 0 1.2rem;
  color: var(--text-secondary);
  font-size: 0.85rem;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}

.modal-btn {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.modal-btn.primary {
  background: var(--accent);
  color: var(--text-on-accent);
}

.modal-btn.primary:hover {
  background: var(--accent-hover);
}

.modal-btn.secondary {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}

.modal-btn.secondary:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

/* Collection selector */
.zotero-action-row {
  display: flex;
  gap: var(--space-sm);
}

.collection-select-btn {
  flex-shrink: 0;
  padding: var(--space-sm);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.collection-select-btn:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-secondary);
}

.sync-hint {
  font-size: 0.7rem;
  color: var(--text-muted);
  text-align: center;
}

.collection-selector {
  margin-top: var(--space-sm);
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  max-height: 260px;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
}

.selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-sm);
}

.selector-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-muted);
}

.selector-close {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.85rem;
  cursor: pointer;
  padding: 0 0.3rem;
}

.collection-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-bottom: var(--space-sm);
}

.collection-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.collection-item:hover {
  background: var(--bg-surface);
}

.collection-item input[type="checkbox"] {
  accent-color: var(--accent);
  cursor: pointer;
}

.collection-name {
  flex: 1;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.collection-count {
  font-size: 0.65rem;
  color: var(--text-dim);
  font-family: var(--font-mono);
}

/* Breadcrumb navigation */
.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.4rem;
  font-size: 0.7rem;
  color: var(--text-muted);
}

.breadcrumb-item {
  cursor: pointer;
  transition: color var(--transition-fast);
}

.breadcrumb-item:hover {
  color: var(--text-secondary);
}

.breadcrumb-item.active {
  color: var(--accent-text);
  font-weight: 600;
  cursor: default;
}

.breadcrumb-sep {
  margin: 0 0.2rem;
  color: var(--border-light);
}

/* Go up button */
.go-up-row {
  margin-bottom: 0.3rem;
}

.go-up-btn {
  background: var(--bg-card);
  border: none;
  border-radius: var(--radius-sm);
  padding: 0.35rem 0.6rem;
  color: var(--text-muted);
  font-size: 0.72rem;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.go-up-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

/* Enter folder button */
.enter-folder-btn {
  background: var(--accent-subtle);
  border: none;
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  color: var(--accent-text);
  font-size: 0.65rem;
  cursor: pointer;
  transition: background var(--transition-fast);
  flex-shrink: 0;
}

.enter-folder-btn:hover {
  background: var(--accent-border);
}

.selector-actions {
  display: flex;
  gap: var(--space-sm);
  justify-content: flex-end;
}

.selector-btn {
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--transition-fast);
  border: none;
}

.selector-btn.primary {
  background: var(--accent);
  color: var(--text-on-accent);
}

.selector-btn.secondary {
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
}
</style>
