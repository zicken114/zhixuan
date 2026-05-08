<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useProjectStore } from '../stores/projects';
import {
  getExperimentSnapshots,
  searchExperimentSnapshots,
  deleteExperimentSnapshot,
  type ExperimentSnapshot
} from '../composables/useDatabase';
import { useWindow } from '../composables/useWindow';

const projectStore = useProjectStore();
const { show: showWindow } = useWindow();

const snapshots = ref<ExperimentSnapshot[]>([]);
const loading = ref(false);
const searchQuery = ref('');
const expandedId = ref<number | null>(null);

const emit = defineEmits<{
  close: [];
}>();

const loadSnapshots = async () => {
  loading.value = true;
  try {
    if (searchQuery.value.trim()) {
      snapshots.value = await searchExperimentSnapshots(
        searchQuery.value.trim(),
        projectStore.currentProjectId,
        50
      );
    } else {
      snapshots.value = await getExperimentSnapshots(projectStore.currentProjectId, 100);
    }
  } catch (e) {
    console.error('[Experiment] Failed to load snapshots:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(loadSnapshots);
watch(() => projectStore.currentProjectId, loadSnapshots);

const toggleExpand = (id?: number) => {
  if (!id) return;
  expandedId.value = expandedId.value === id ? null : id;
};

const handleDelete = async (id?: number) => {
  if (!id) return;
  if (!confirm('确定要删除这条实验记录吗？')) return;
  try {
    await deleteExperimentSnapshot(id);
    await loadSnapshots();
  } catch (e) {
    console.error('[Experiment] Failed to delete snapshot:', e);
  }
};

const typeIcon = (type: string): string => {
  switch (type) {
    case 'screenshot': return '📸';
    case 'terminal': return '💻';
    case 'code': return '📝';
    case 'voice': return '🎙️';
    default: return '📄';
  }
};

const typeLabel = (type: string): string => {
  switch (type) {
    case 'screenshot': return '截屏';
    case 'terminal': return '终端';
    case 'code': return '代码';
    case 'voice': return '语音';
    default: return type;
  }
};

const formatDate = (timestamp?: number): string => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};
</script>

<template>
  <div class="experiment-panel">
    <div class="sidebar-header">
      <span class="sidebar-title">⚡ 实验记录</span>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>

    <div class="search-bar">
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索实验记录..."
        @input="loadSnapshots"
      />
      <button class="quick-record-btn" @click="showWindow('experiment_snapshot')">
        + 快速记录
      </button>
    </div>

    <div v-if="loading && snapshots.length === 0" class="empty-state">加载中...</div>
    <div v-else-if="snapshots.length === 0" class="empty-state">
      暂无实验记录
      <span class="empty-hint">按 Alt+E 快速记录实验快照</span>
    </div>

    <div class="snapshot-list">
      <div
        v-for="snap in snapshots"
        :key="snap.id"
        class="snapshot-card"
        :class="{ expanded: expandedId === snap.id }"
        @click="toggleExpand(snap.id)"
      >
        <div class="snapshot-header-row">
          <span class="snapshot-type-icon">{{ typeIcon(snap.type) }}</span>
          <div class="snapshot-info">
            <div class="snapshot-title">{{ snap.title }}</div>
            <div class="snapshot-meta">
              <span class="snapshot-type-label">{{ typeLabel(snap.type) }}</span>
              <span class="snapshot-date">{{ formatDate(snap.timestamp) }}</span>
            </div>
          </div>
          <button
            class="delete-btn"
            @click.stop="handleDelete(snap.id)"
            title="删除"
          >
            🗑️
          </button>
        </div>

        <div v-if="expandedId === snap.id" class="snapshot-detail">
          <div v-if="snap.parameters" class="detail-section">
            <div class="detail-label">参数</div>
            <div class="param-grid">
              <div
                v-for="(val, key) in snap.parameters"
                :key="key"
                class="param-item"
              >
                <span class="param-key">{{ key }}</span>
                <span class="param-val">{{ val }}</span>
              </div>
            </div>
          </div>

          <div v-if="snap.notes" class="detail-section">
            <div class="detail-label">备注</div>
            <div class="detail-text">{{ snap.notes }}</div>
          </div>

          <div v-if="snap.screenshotPath" class="detail-section">
            <div class="detail-label">截图</div>
            <div class="screenshot-placeholder">{{ snap.screenshotPath }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.experiment-panel {
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

.close-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1.25rem;
  cursor: pointer;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  transition: all 0.2s ease;
}

.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.search-bar {
  display: flex;
  gap: 0.4rem;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border-subtle);
}

.search-bar input {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.45rem 0.65rem;
  color: var(--text-primary);
  font-size: 0.8rem;
  outline: none;
}

.search-bar input:focus {
  border-color: var(--accent);
}

.quick-record-btn {
  padding: 0.4rem 0.7rem;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  color: var(--accent);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.quick-record-btn:hover {
  background: var(--accent-border);
}

.empty-state {
  text-align: center;
  padding: 2.5rem 1rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.empty-hint {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-dim);
}

.snapshot-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.snapshot-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 0.65rem;
  margin-bottom: 0.4rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.snapshot-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
}

.snapshot-card.expanded {
  border-color: var(--accent-border);
}

.snapshot-header-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.snapshot-type-icon {
  font-size: 1.1rem;
  flex-shrink: 0;
}

.snapshot-info {
  flex: 1;
  min-width: 0;
}

.snapshot-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
  margin-bottom: 0.15rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.snapshot-meta {
  display: flex;
  gap: 0.4rem;
  font-size: 0.68rem;
  color: var(--text-muted);
}

.snapshot-type-label {
  color: var(--accent);
}

.delete-btn {
  background: none;
  border: none;
  font-size: 0.85rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
  padding: 0.2rem;
}

.snapshot-card:hover .delete-btn {
  opacity: 0.5;
}

.delete-btn:hover {
  opacity: 1 !important;
}

.snapshot-detail {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border-subtle);
}

.detail-section {
  margin-bottom: 0.5rem;
}

.detail-label {
  font-size: 0.68rem;
  color: var(--text-muted);
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.detail-text {
  font-size: 0.78rem;
  color: var(--text-secondary);
  line-height: 1.4;
}

.param-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 0.35rem;
}

.param-item {
  background: var(--bg-surface);
  border-radius: 5px;
  padding: 0.3rem 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}

.param-key {
  font-size: 0.65rem;
  color: var(--text-muted);
}

.param-val {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: 'JetBrains Mono', monospace;
}

.screenshot-placeholder {
  font-size: 0.75rem;
  color: var(--text-muted);
  padding: 0.5rem;
  background: var(--bg-surface);
  border-radius: 6px;
}
</style>