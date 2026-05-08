<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useProjectStore } from '../stores/projects';
import {
  getSentinelTopics,
  getSentinelPapers,
  markSentinelPaper,
  type SentinelTopic,
  type SentinelPaper
} from '../composables/useDatabase';

const appWindow = getCurrentWebviewWindow();
const projectStore = useProjectStore();

const topics = ref<SentinelTopic[]>([]);
const papersByTopic = ref<Map<string, SentinelPaper[]>>(new Map());
const loading = ref(true);

const totalUnread = computed(() => {
  let count = 0;
  for (const papers of papersByTopic.value.values()) {
    count += papers.filter(p => !p.isRead && !p.isIgnored).length;
  }
  return count;
});

const loadData = async () => {
  loading.value = true;
  try {
    topics.value = await getSentinelTopics(projectStore.currentProjectId);
    papersByTopic.value = new Map();
    for (const topic of topics.value) {
      if (!topic.id) continue;
      const papers = await getSentinelPapers(topic.id, false, false, 20);
      papersByTopic.value.set(topic.id, papers);
    }
  } catch (e) {
    console.error('[SentinelBrief] Failed to load:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(loadData);

const markAsRead = async (paper: SentinelPaper) => {
  if (!paper.id) return;
  await markSentinelPaper(paper.id, { isRead: true });
  await loadData();
};

const ignorePaper = async (paper: SentinelPaper) => {
  if (!paper.id) return;
  await markSentinelPaper(paper.id, { isIgnored: true });
  await loadData();
};

const openUrl = (url?: string) => {
  if (!url) return;
  window.open(url, '_blank');
};

const closeWindow = () => {
  appWindow.hide();
};
</script>

<template>
  <div class="sentinel-brief">
    <div class="brief-header" @mousedown="appWindow.startDragging()">
      <div class="header-title">
        <span class="bell">📡</span>
        <span>文献简报</span>
        <span v-if="totalUnread > 0" class="header-badge">{{ totalUnread }}</span>
      </div>
      <button class="close-btn" @click="closeWindow">×</button>
    </div>

    <div class="brief-content">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else-if="totalUnread === 0" class="empty">
        暂无新文献
        <span class="empty-hint">哨兵会在发现新论文时通知你</span>
      </div>

      <div v-else class="topic-groups">
        <div v-for="topic in topics" :key="topic.id" class="topic-group">
          <div v-if="(papersByTopic.get(topic.id || '') || []).filter(p => !p.isRead && !p.isIgnored).length > 0"
            class="group-header">
            <span class="group-name">{{ topic.name }}</span>
            <span class="group-count">
              {{ (papersByTopic.get(topic.id || '') || []).filter(p => !p.isRead && !p.isIgnored).length }} 篇新文献
            </span>
          </div>

          <div v-for="paper in (papersByTopic.get(topic.id || '') || []).filter(p => !p.isRead && !p.isIgnored)"
            :key="paper.id" class="paper-card">
            <div class="paper-title">{{ paper.title }}</div>
            <div class="paper-authors">{{ paper.authors }}</div>
            <div v-if="paper.abstract" class="paper-abstract">
              {{ paper.abstract.slice(0, 120) }}{{ paper.abstract.length > 120 ? '...' : '' }}
            </div>
            <div class="paper-meta">
              <span v-if="paper.publishedDate" class="paper-date">{{ paper.publishedDate }}</span>
              <span class="paper-source">{{ paper.source }}</span>
            </div>
            <div class="paper-actions">
              <button class="action-btn view" @click="openUrl(paper.url)">查看原文</button>
              <button class="action-btn read" @click="markAsRead(paper)">已读</button>
              <button class="action-btn ignore" @click="ignorePaper(paper)">忽略</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sentinel-brief {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--text-primary);
}

.brief-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  cursor: move;
  user-select: none;
  -webkit-app-region: drag;
}

.header-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  font-weight: 600;
}

.bell {
  font-size: 1rem;
}

.header-badge {
  background: var(--error);
  color: var(--text-on-accent);
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 8px;
  min-width: 16px;
  text-align: center;
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
  -webkit-app-region: no-drag;
}

.close-btn:hover {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.brief-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
}

.loading,
.empty {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--text-muted);
  font-size: 0.85rem;
}

.empty-hint {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-dim);
}

.topic-groups {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 0;
  border-bottom: 1px solid var(--border-subtle);
}

.group-name {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--accent);
}

.group-count {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.paper-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  transition: all 0.15s ease;
}

.paper-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
}

.paper-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 0.3rem;
}

.paper-authors {
  font-size: 0.72rem;
  color: var(--text-secondary);
  margin-bottom: 0.4rem;
}

.paper-abstract {
  font-size: 0.72rem;
  color: var(--text-secondary);
  line-height: 1.4;
  margin-bottom: 0.4rem;
}

.paper-meta {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.paper-date {
  font-size: 0.65rem;
  color: var(--text-muted);
  font-family: 'JetBrains Mono', monospace;
}

.paper-source {
  font-size: 0.65rem;
  color: var(--accent);
  text-transform: uppercase;
}

.paper-actions {
  display: flex;
  gap: 0.4rem;
}

.action-btn {
  padding: 0.3rem 0.6rem;
  border-radius: 5px;
  font-size: 0.7rem;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.action-btn.view {
  background: var(--accent-subtle);
  color: var(--accent);
}

.action-btn.view:hover {
  background: var(--accent-border);
}

.action-btn.read {
  background: var(--bg-card-hover);
  color: var(--text-secondary);
}

.action-btn.read:hover {
  background: var(--border-light);
}

.action-btn.ignore {
  background: transparent;
  color: var(--text-muted);
}

.action-btn.ignore:hover {
  color: var(--error);
}
</style>
