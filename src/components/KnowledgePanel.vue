<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useKnowledgeBaseStore } from '../stores/knowledgeBase';
import { useProjectStore } from '../stores/projects';

const appWindow = getCurrentWebviewWindow();
const kbStore = useKnowledgeBaseStore();
const projectStore = useProjectStore();

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
    case 'completed': return '已索引';
    case 'indexing': return '索引中...';
    case 'error': return '错误';
    default: return '待处理';
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
  <div class="knowledge-panel">
    <div class="drag-handle" @mousedown="handleDragStart"></div>
    <div class="panel-header">
      <div class="header-left">
        <button class="back-btn" @click="emit('close')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          返回
        </button>
        <span class="header-title">知乎知识库</span>
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
          placeholder="搜索知乎素材..."
          @keydown.enter="handleSearch"
        />
        <button
          class="search-btn"
          :disabled="kbStore.isSearching || !kbStore.searchQuery.trim()"
          @click="handleSearch"
        >
          {{ kbStore.isSearching ? '搜索中...' : '搜索' }}
        </button>
      </div>
    </div>

    <!-- Actions -->
    <div class="actions-section">
      <div class="action-row">
        <button
          class="add-folder-btn"
          :disabled="kbStore.isIndexing || kbStore.embedderLoading || kbStore.zhihuFetching"
          @click="kbStore.addFolder"
        >
          <span class="btn-icon">+</span>
          <span>{{ kbStore.isIndexing ? '索引中...' : '导入本地文档/PDF' }}</span>
        </button>
        <button
          class="zhihu-fetch-btn"
          :disabled="kbStore.zhihuFetching || kbStore.isIndexing"
          @click="kbStore.fetchZhihuFavorites"
        >
          <span class="btn-icon">➕</span>
          <span>{{ kbStore.zhihuFetching ? '抓取中...' : '抓取知乎收藏夹/回答' }}</span>
        </button>
      </div>
    </div>

    <!-- Download model modal -->
    <div v-if="kbStore.showDownloadModal" class="modal-overlay" @click.self="kbStore.showDownloadModal = false">
      <div class="modal-content">
        <div v-if="kbStore.embedderLoading">
          <h3 class="modal-title">正在下载嵌入模型</h3>
          <p class="modal-desc">Xenova/all-MiniLM-L6-v2 (~22 MB)</p>
          <div class="progress-track" style="margin: 1rem 0;">
            <div class="progress-fill" :style="{ width: `${kbStore.embedderProgress}%` }" />
          </div>
          <div class="modal-desc" style="text-align: center;">{{ kbStore.embedderProgress }}%</div>
        </div>
        <div v-else-if="kbStore.embedderStatus === 'error'">
          <h3 class="modal-title" style="color: var(--error);">下载失败</h3>
          <p class="modal-desc">{{ kbStore.lastError }}</p>
          <div class="modal-actions">
            <button class="modal-btn primary" @click="kbStore.downloadEmbedder">重试</button>
            <button class="modal-btn secondary" @click="kbStore.showDownloadModal = false">取消</button>
          </div>
        </div>
        <div v-else>
          <h3 class="modal-title">需要下载模型</h3>
          <p class="modal-desc">
            知乎知识库需要一个嵌入模型 (Xenova/all-MiniLM-L6-v2, ~22 MB) 来进行语义搜索。
            模型在首次下载后会缓存在本地。
          </p>
          <div class="modal-actions">
            <button class="modal-btn primary" @click="kbStore.downloadEmbedder">下载</button>
            <button class="modal-btn secondary" @click="kbStore.showDownloadModal = false">取消</button>
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
        {{ kbStore.indexProgress.current }} / {{ kbStore.indexProgress.total }} 个文档
      </div>
    </div>

    <!-- Error message -->
    <div v-if="kbStore.lastError" class="error-message">
      {{ kbStore.lastError }}
    </div>

    <!-- Search results -->
    <div v-if="kbStore.searchResults.length > 0" class="results-section">
      <div class="section-title">搜索结果</div>
      <div
        v-for="(result, idx) in kbStore.searchResults"
        :key="`${result.docId}-${result.chunk.chunkIndex}`"
        class="result-item"
      >
        <div class="result-meta">
          <span class="result-rank">#{{ idx + 1 }}</span>
          <span class="result-score">{{ (result.score * 100).toFixed(1) }}%</span>
          <span v-if="result.chunk.pageNumber" class="result-page">
            第 {{ result.chunk.pageNumber }} 页
          </span>
        </div>
        <div class="result-content">{{ result.chunk.content.slice(0, 200) }}...</div>
      </div>
    </div>

    <!-- Document list -->
    <div class="documents-section">
      <div class="section-title">
        知乎素材
        <span class="doc-count">({{ kbStore.projectDocuments.length }})</span>
      </div>

      <div v-if="kbStore.projectDocuments.length === 0" class="empty-state">
        暂无素材。导入本地文档或抓取知乎收藏夹。
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
            <span v-if="doc.totalPages">{{ doc.totalPages }} 页</span>
            <button
              v-if="doc.indexStatus === 'error'"
              class="doc-action"
              @click="kbStore.reindexDocument(doc)"
            >
              重试
            </button>
            <button class="doc-action delete" @click="kbStore.deleteDocument(doc.id)">
              移除
            </button>
          </div>
          <div v-if="doc.errorMessage" class="doc-error">
            {{ doc.errorMessage }}
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

.action-row {
  display: flex;
  gap: var(--space-sm);
}

.add-folder-btn {
  flex: 1;
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

.zhihu-fetch-btn {
  flex: 1;
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

.zhihu-fetch-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
  border-color: var(--accent);
}

.zhihu-fetch-btn:disabled {
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
</style>
