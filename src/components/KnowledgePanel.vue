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
          <h3 class="modal-title" style="color: #ef4444;">Download Failed</h3>
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
  background: rgba(7, 7, 13, 0.96);
  backdrop-filter: blur(20px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.knowledge-panel::before {
  content: '';
  position: absolute;
  top: -50%;
  left: -50%;
  width: 200%;
  height: 200%;
  background: radial-gradient(ellipse at 30% 20%, rgba(0, 229, 204, 0.03) 0%, transparent 50%);
  pointer-events: none;
}

.drag-handle {
  height: 32px;
  cursor: move;
  -webkit-app-region: drag;
  flex-shrink: 0;
}

.panel-header {
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
  background: rgba(13, 13, 20, 0.5);
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  -webkit-app-region: no-drag;
}

.header-title {
  font-family: 'Syne', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  color: #f0f0f5;
}

.back-btn {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.7);
  cursor: pointer;
  padding: 0.4rem 0.7rem;
  border-radius: 8px;
  font-size: 0.78rem;
  font-weight: 600;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(0, 229, 204, 0.1);
  border-color: rgba(0, 229, 204, 0.3);
  color: #00e5cc;
}

.close-btn {
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
  -webkit-app-region: no-drag;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.8);
}

/* Search */
.search-section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.search-input-wrapper {
  display: flex;
  gap: 0.5rem;
}

.search-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 0.5rem 0.75rem;
  color: rgba(240, 240, 245, 0.85);
  font-size: 0.82rem;
  outline: none;
  transition: all 0.2s ease;
}

.search-input:focus {
  border-color: rgba(0, 229, 204, 0.4);
}

.search-input::placeholder {
  color: rgba(240, 240, 245, 0.3);
}

.search-btn {
  background: rgba(0, 229, 204, 0.12);
  border: 1px solid rgba(0, 229, 204, 0.2);
  border-radius: 8px;
  padding: 0.5rem 0.9rem;
  color: #00e5cc;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.search-btn:hover:not(:disabled) {
  background: rgba(0, 229, 204, 0.2);
}

.search-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Actions */
.actions-section {
  padding: 0.5rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.add-folder-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  background: rgba(61, 116, 231, 0.12);
  border: 1px solid rgba(61, 116, 231, 0.25);
  border-radius: 8px;
  padding: 0.6rem;
  color: #3d74e7;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.add-folder-btn:hover:not(:disabled) {
  background: rgba(61, 116, 231, 0.2);
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
  padding: 0.5rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.progress-track {
  height: 4px;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #00e5cc, #3d74e7);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.progress-text {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.4);
  margin-top: 0.35rem;
  text-align: center;
}

/* Error */
.error-message {
  padding: 0.6rem 1rem;
  background: rgba(239, 68, 68, 0.08);
  border-bottom: 1px solid rgba(239, 68, 68, 0.1);
  color: #ef4444;
  font-size: 0.78rem;
}

/* Results */
.results-section {
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  max-height: 200px;
  overflow-y: auto;
}

.result-item {
  padding: 0.6rem 0.5rem;
  border-radius: 6px;
  margin-bottom: 0.4rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.result-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.3rem;
}

.result-rank {
  font-size: 0.7rem;
  font-weight: 700;
  color: #00e5cc;
}

.result-score {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.5);
  font-family: 'JetBrains Mono', monospace;
}

.result-page {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.35);
  margin-left: auto;
}

.result-content {
  font-size: 0.78rem;
  color: rgba(240, 240, 245, 0.6);
  line-height: 1.5;
}

/* Documents */
.documents-section {
  padding: 0.75rem 1rem;
  flex: 1;
  overflow-y: auto;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.doc-count {
  color: rgba(240, 240, 245, 0.25);
  font-size: 0.7rem;
}

.empty-state {
  padding: 1.5rem;
  text-align: center;
  color: rgba(240, 240, 245, 0.3);
  font-size: 0.82rem;
}

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.doc-item {
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  transition: all 0.15s ease;
}

.doc-item:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.doc-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.doc-name {
  flex: 1;
  font-size: 0.82rem;
  color: rgba(240, 240, 245, 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-status {
  font-size: 0.65rem;
  font-weight: 600;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-completed {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.status-indexing {
  background: rgba(0, 229, 204, 0.12);
  color: #00e5cc;
}

.status-pending {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.status-error {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.doc-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.3rem;
  font-size: 0.72rem;
  color: rgba(240, 240, 245, 0.35);
}

.doc-action {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.35);
  font-size: 0.7rem;
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  transition: all 0.15s ease;
}

.doc-action:hover {
  background: rgba(255, 255, 255, 0.06);
  color: rgba(240, 240, 245, 0.6);
}

.doc-action.delete:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.doc-error {
  margin-top: 0.3rem;
  font-size: 0.72rem;
  color: #ef4444;
  line-height: 1.4;
}

.doc-abstract {
  margin-top: 0.3rem;
  font-size: 0.72rem;
  color: rgba(240, 240, 245, 0.4);
  line-height: 1.4;
}

/* Tab bar */
.tab-bar {
  display: flex;
  gap: 0.3rem;
  margin-bottom: 0.5rem;
}

.review-btn {
  width: 100%;
  padding: 0.5rem;
  background: rgba(139, 92, 246, 0.12);
  border: 1px solid rgba(139, 92, 246, 0.25);
  border-radius: 8px;
  color: #8b5cf6;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 0.5rem;
}

.review-btn:hover {
  background: rgba(139, 92, 246, 0.2);
}

.tab-btn {
  flex: 1;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(240, 240, 245, 0.7);
}

.tab-btn.active {
  background: rgba(0, 229, 204, 0.12);
  border-color: rgba(0, 229, 204, 0.25);
  color: #00e5cc;
}

.tab-actions {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.zotero-btn {
  background: rgba(205, 90, 40, 0.12);
  border-color: rgba(205, 90, 40, 0.25);
  color: #cd5a28;
}

.zotero-btn:hover:not(:disabled) {
  background: rgba(205, 90, 40, 0.2);
}

.sync-status {
  font-size: 0.72rem;
  text-align: center;
}

.sync-ok {
  color: #10b981;
}

.sync-error {
  color: #ef4444;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 300;
  backdrop-filter: blur(4px);
}

.modal-content {
  background: rgba(18, 18, 28, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 1.5rem;
  width: 360px;
  max-width: 90vw;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6);
}

.modal-title {
  margin: 0 0 0.6rem;
  color: #f0f0f5;
  font-size: 1rem;
  font-weight: 700;
}

.modal-desc {
  margin: 0 0 1.2rem;
  color: rgba(240, 240, 245, 0.6);
  font-size: 0.85rem;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
}

.modal-btn {
  padding: 0.55rem 1.1rem;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.modal-btn.primary {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  color: #06211f;
}

.modal-btn.primary:hover {
  opacity: 0.9;
}

.modal-btn.secondary {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(240, 240, 245, 0.7);
}

.modal-btn.secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

/* Collection selector */
.zotero-action-row {
  display: flex;
  gap: 0.5rem;
}

.collection-select-btn {
  flex-shrink: 0;
  padding: 0.6rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(240, 240, 245, 0.6);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.collection-select-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.85);
}

.sync-hint {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.35);
  text-align: center;
}

.collection-selector {
  margin-top: 0.5rem;
  background: rgba(13, 13, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 0.75rem;
  max-height: 260px;
  display: flex;
  flex-direction: column;
}

.selector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.selector-title {
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.6);
}

.selector-close {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.4);
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
  margin-bottom: 0.5rem;
}

.collection-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.collection-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.collection-item input[type="checkbox"] {
  accent-color: #00e5cc;
  cursor: pointer;
}

.collection-name {
  flex: 1;
  font-size: 0.78rem;
  color: rgba(240, 240, 245, 0.7);
}

.collection-count {
  font-size: 0.65rem;
  color: rgba(240, 240, 245, 0.25);
  font-family: 'JetBrains Mono', monospace;
}

/* Breadcrumb navigation */
.breadcrumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin-bottom: 0.4rem;
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.35);
}

.breadcrumb-item {
  cursor: pointer;
  transition: color 0.15s ease;
}

.breadcrumb-item:hover {
  color: rgba(240, 240, 245, 0.7);
}

.breadcrumb-item.active {
  color: #00e5cc;
  font-weight: 600;
  cursor: default;
}

.breadcrumb-sep {
  margin: 0 0.2rem;
  color: rgba(240, 240, 245, 0.2);
}

/* Go up button */
.go-up-row {
  margin-bottom: 0.3rem;
}

.go-up-btn {
  background: rgba(255, 255, 255, 0.04);
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.6rem;
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.go-up-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.8);
}

/* Enter folder button */
.enter-folder-btn {
  background: rgba(0, 229, 204, 0.1);
  border: none;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  color: #00e5cc;
  font-size: 0.65rem;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.enter-folder-btn:hover {
  background: rgba(0, 229, 204, 0.2);
}

.selector-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
}

.selector-btn {
  padding: 0.4rem 0.8rem;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  border: none;
}

.selector-btn.primary {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  color: #06211f;
}

.selector-btn.secondary {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: rgba(240, 240, 245, 0.7);
}
</style>
