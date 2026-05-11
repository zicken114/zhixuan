<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useProjectStore } from '../stores/projects';
import {
  getSentinelTopics,
  createSentinelTopic,
  updateSentinelTopic,
  deleteSentinelTopic,
  getSentinelPapers,
  markSentinelPaper,
  createSentinelPaper,
  createSentinelCheck,
  loadRecentMessages,
  loadKnowledgeDocs,
  type SentinelTopic,
  type SentinelPaper
} from '../composables/useDatabase';
import { invoke } from '@tauri-apps/api/core';
import { emit as tauriEmit } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { recordEvent } from '../composables/useEvents';
import { useWindow } from '../composables/useWindow';
import { aiClient } from '../utils/aiClient';

const projectStore = useProjectStore();
const { showSentinelBrief } = useWindow();

const topics = ref<SentinelTopic[]>([]);
const papers = ref<Map<string, SentinelPaper[]>>(new Map());
const loading = ref(false);
const inferring = ref(false);
const showCreateModal = ref(false);
const expandedTopic = ref<string | null>(null);

// Create form
const newTopicName = ref('');
const newTopicKeywords = ref('');
const newTopicSources = ref('arxiv,semantic_scholar');
const newTopicFrequency = ref('6h');

const emit = defineEmits<{
  close: [];
}>();

const loadTopics = async () => {
  loading.value = true;
  try {
    topics.value = await getSentinelTopics(projectStore.currentProjectId);
    // Load papers for each topic
    for (const topic of topics.value) {
      if (!topic.id) continue;
      const topicPapers = await getSentinelPapers(topic.id, undefined, false, 20);
      papers.value.set(topic.id, topicPapers);
    }
  } catch (e) {
    console.error('[Sentinel] Failed to load topics:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(loadTopics);
watch(() => projectStore.currentProjectId, loadTopics);

const toggleTopic = (topicId: string) => {
  expandedTopic.value = expandedTopic.value === topicId ? null : topicId;
};

const handleCreateTopic = async () => {
  const name = newTopicName.value.trim();
  const keywords = newTopicKeywords.value
    .split(/[,，;；]/)
    .map((k) => k.trim())
    .filter(Boolean);

  if (!name || keywords.length === 0) return;

  try {
    await createSentinelTopic({
      projectId: projectStore.currentProjectId,
      name,
      keywords,
      sources: newTopicSources.value,
      frequency: newTopicFrequency.value,
      isActive: true
    });

    recordEvent({
      event_type: 'sentinel_topic_create',
      metadata: { name, keywords, sources: newTopicSources.value }
    });

    newTopicName.value = '';
    newTopicKeywords.value = '';
    showCreateModal.value = false;
    await loadTopics();
  } catch (e) {
    console.error('[Sentinel] Failed to create topic:', e);
  }
};

const toggleTopicActive = async (topic: SentinelTopic) => {
  if (!topic.id) return;
  try {
    await updateSentinelTopic({
      ...topic,
      isActive: !topic.isActive
    });
    await loadTopics();
  } catch (e) {
    console.error('[Sentinel] Failed to toggle topic:', e);
  }
};

const handleDeleteTopic = async (id: string) => {
  if (!confirm('确定要删除这个监控主题吗？')) return;
  try {
    await deleteSentinelTopic(id);
    await loadTopics();
  } catch (e) {
    console.error('[Sentinel] Failed to delete topic:', e);
  }
};

const handleInferDirections = async () => {
  inferring.value = true;
  try {
    // 1. Load recent messages and knowledge docs for context
    const [messages, docs] = await Promise.all([
      loadRecentMessages(30),
      loadKnowledgeDocs(projectStore.currentProjectId)
    ]);

    const userMessages = messages
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .slice(-20)
      .join('\n---\n');

    const docNames = docs.map(d => d.fileName).slice(0, 20).join(', ');

    if (!userMessages.trim() && !docNames) {
      alert('暂无足够数据推断研究方向。请先进行一些对话或上传文献。');
      return;
    }

    // 2. Call AI to infer research directions
    const prompt = `Based on the following research activities, infer 3-5 main research directions. Each direction should have a concise Chinese name and 3-5 English keywords suitable for arXiv search.

Recent conversation topics:
${userMessages.slice(0, 3000)}

知乎知识库素材：
${docNames}

Return STRICTLY in this JSON format without any other text:
[{"name":"Direction Name","keywords":["keyword1","keyword2","keyword3"]}]`;

    const { text } = await aiClient.chatOnce([
      { role: 'system', content: 'You are a research assistant that analyzes user activities to infer research interests. Output only valid JSON.' },
      { role: 'user', content: prompt }
    ], false, 'literature_review');

    // 3. Parse JSON response
    let directions: Array<{ name: string; keywords: string[] }> = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        directions = JSON.parse(jsonMatch[0]);
      } else {
        directions = JSON.parse(text);
      }
    } catch (parseErr) {
      console.error('[Sentinel] Failed to parse AI response:', text, parseErr);
      alert('AI 返回格式异常，请手动创建监控主题。');
      return;
    }

    if (!Array.isArray(directions) || directions.length === 0) {
      alert('未能自动推断出研究方向。请手动创建监控主题。');
      return;
    }

    for (const dir of directions) {
      if (!dir.name || !Array.isArray(dir.keywords)) continue;
      await createSentinelTopic({
        projectId: projectStore.currentProjectId,
        name: dir.name,
        keywords: dir.keywords,
        sources: 'arxiv,semantic_scholar',
        frequency: '6h',
        isActive: true
      });
    }

    await loadTopics();
  } catch (e) {
    console.error('[Sentinel] Failed to infer directions:', e);
    alert('推断失败: ' + (e as Error).message);
  } finally {
    inferring.value = false;
  }
};

const runManualCheck = async (topic: SentinelTopic) => {
  if (!topic.id) return;
  loading.value = true;
  const checkStartTime = Date.now();
  try {
    const arxivPapers: Array<{
      title: string;
      authors: string[];
      summary: string;
      id: string;
      pdf_url: string;
      published: string;
      doi?: string;
    }> = await invoke('search_arxiv_command', {
      keywords: topic.keywords,
      days: 7
    });

    // Fetch ALL existing papers for this topic (any status) for deduplication
    const existingPapers = await getSentinelPapers(topic.id, undefined, undefined, 10000);
    const existingTitles = new Set(existingPapers.map((p) => p.title.toLowerCase().trim()));

    let createdCount = 0;
    let duplicateCount = 0;
    for (const paper of arxivPapers.slice(0, 5)) {
      const titleKey = paper.title.toLowerCase().trim();
      if (existingTitles.has(titleKey)) {
        duplicateCount++;
        continue;
      }
      await createSentinelPaper({
        topicId: topic.id!,
        title: paper.title,
        authors: paper.authors.join(', '),
        abstract: paper.summary,
        url: paper.id,
        pdfUrl: paper.pdf_url,
        doi: paper.doi || undefined,
        publishedDate: paper.published,
        source: 'arxiv',
        isRead: false,
        isIgnored: false
      });
      existingTitles.add(titleKey);
      createdCount++;
    }

    // Update last check time
    await updateSentinelTopic({
      ...topic,
      lastCheckAt: Date.now()
    });

    // Record check history
    await createSentinelCheck({
      timestamp: Date.now(),
      topicsChecked: 1,
      papersFound: createdCount,
      durationMs: Date.now() - checkStartTime,
      metadata: {
        source: 'manual',
        topicId: topic.id,
        keywords: topic.keywords,
        totalReturned: arxivPapers.length,
        duplicates: duplicateCount,
        checkedSources: ['arxiv']
      }
    });

    // Record activity event for dashboard
    recordEvent({
      event_type: 'sentinel_check',
      project_id: projectStore.currentProjectId ?? undefined,
      duration_ms: Date.now() - checkStartTime,
      metadata: {
        topicId: topic.id,
        topicName: topic.name,
        papersFound: createdCount,
        totalReturned: arxivPapers.length,
        source: 'manual'
      }
    });

    if (createdCount > 0) {
      await tauriEmit('sentinel:new-papers', { count: createdCount });
      alert(`✅ 发现 ${createdCount} 篇新论文！（arXiv 返回 ${arxivPapers.length} 篇，跳过 ${duplicateCount} 篇已存在）`);
    } else {
      alert(`📭 本次检查完成。arXiv 返回 ${arxivPapers.length} 篇论文，全部已存在，未发现新论文。`);
    }

    await loadTopics();
  } catch (e) {
    console.error('[Sentinel] Manual check failed:', e);
    alert('❌ 检查失败：' + e);
  } finally {
    loading.value = false;
  }
};

const markPaper = async (paperId: number, updates: { isRead?: boolean; isIgnored?: boolean }) => {
  try {
    await markSentinelPaper(paperId, updates);
    await loadTopics();
  } catch (e) {
    console.error('[Sentinel] Failed to mark paper:', e);
  }
};

const unreadCount = (topicId: string): number => {
  const topicPapers = papers.value.get(topicId) || [];
  return topicPapers.filter((p) => !p.isRead && !p.isIgnored).length;
};

const frequencyLabel = (freq: string): string => {
  switch (freq) {
    case '6h': return '每6小时';
    case '1d': return '每天';
    case '3d': return '每3天';
    case '1w': return '每周';
    default: return freq;
  }
};

const formatDate = (timestamp?: number | null): string => {
  if (!timestamp) return '从未';
  const d = new Date(timestamp);
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
</script>

<template>
  <div class="sentinel-panel">
    <div class="sidebar-header">
      <span class="sidebar-title">📡 文献哨兵</span>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>

    <div class="toolbar">
      <button class="tool-btn primary" @click="showCreateModal = true">
        + 添加主题
      </button>
      <button class="tool-btn" :disabled="inferring" @click="handleInferDirections">
        {{ inferring ? '推断中...' : '🔮 推断方向' }}
      </button>
      <button class="tool-btn" @click="showSentinelBrief()">
        📰 简报
      </button>
    </div>

    <div v-if="loading && topics.length === 0" class="empty-state">加载中...</div>
    <div v-else-if="topics.length === 0" class="empty-state">
      暂无监控主题
      <br />
      <span class="empty-hint">点击"添加主题"或"推断方向"开始</span>
    </div>

    <div class="topic-list">
      <div
        v-for="topic in topics"
        :key="topic.id"
        class="topic-card"
        :class="{ inactive: !topic.isActive, expanded: expandedTopic === topic.id }"
      >
        <div class="topic-header" @click="toggleTopic(topic.id || '')">
          <div class="topic-main">
            <span class="topic-name">{{ topic.name }}</span>
            <span v-if="unreadCount(topic.id || '') > 0" class="unread-badge">
              {{ unreadCount(topic.id || '') }}
            </span>
          </div>
          <div class="topic-meta">
            <span class="topic-freq">{{ frequencyLabel(topic.frequency) }}</span>
            <span class="topic-sources">{{ topic.sources }}</span>
            <span class="topic-last-check">{{ formatDate(topic.lastCheckAt) }}</span>
          </div>
        </div>

        <div class="topic-keywords">
          <span v-for="kw in topic.keywords" :key="kw" class="keyword-tag">{{ kw }}</span>
        </div>

        <div class="topic-actions">
          <button class="action-link" @click.stop="toggleTopicActive(topic)">
            {{ topic.isActive ? '暂停' : '启用' }}
          </button>
          <button class="action-link" @click.stop="runManualCheck(topic)">
            手动检查
          </button>
          <button class="action-link danger" @click.stop="handleDeleteTopic(topic.id || '')">
            删除
          </button>
        </div>

        <!-- Expanded paper list -->
        <div v-if="expandedTopic === topic.id" class="paper-list">
          <div
            v-for="paper in papers.get(topic.id || '') || []"
            :key="paper.id"
            class="paper-item"
            :class="{ read: paper.isRead, ignored: paper.isIgnored }"
          >
            <div class="paper-title">{{ paper.title }}</div>
            <div class="paper-authors">{{ paper.authors }}</div>
            <div class="paper-actions">
              <button
                v-if="paper.url"
                class="paper-link"
                @click.stop="openUrl(paper.url)"
              >查看原文</button>
              <button
                v-if="!paper.isRead"
                class="paper-action"
                @click.stop="markPaper(paper.id || 0, { isRead: true })"
              >
                标记已读
              </button>
              <button
                class="paper-action ignore"
                @click.stop="markPaper(paper.id || 0, { isIgnored: true })"
              >
                忽略
              </button>
            </div>
          </div>
          <div
            v-if="(papers.get(topic.id || '') || []).length === 0"
            class="paper-empty"
          >
            暂无新论文
          </div>
        </div>
      </div>
    </div>

    <!-- Create topic modal -->
    <div v-if="showCreateModal" class="modal-overlay" @click="showCreateModal = false">
      <div class="modal-content" @click.stop>
        <h3>添加监控主题</h3>
        <div class="form-group">
          <label>主题名称</label>
          <input v-model="newTopicName" type="text" placeholder="例如：多模态大模型幻觉检测" />
        </div>
        <div class="form-group">
          <label>关键词（逗号分隔）</label>
          <input
            v-model="newTopicKeywords"
            type="text"
            placeholder="multimodal, hallucination, vision-language"
          />
        </div>
        <div class="form-group">
          <label>数据源</label>
          <select v-model="newTopicSources">
            <option value="arxiv">arXiv</option>
            <option value="semantic_scholar">Semantic Scholar</option>
            <option value="arxiv,semantic_scholar">arXiv + Semantic Scholar</option>
          </select>
        </div>
        <div class="form-group">
          <label>检查频率</label>
          <select v-model="newTopicFrequency">
            <option value="6h">每6小时</option>
            <option value="1d">每天</option>
            <option value="3d">每3天</option>
            <option value="1w">每周</option>
          </select>
        </div>
        <div class="modal-actions">
          <button class="btn-secondary" @click="showCreateModal = false">取消</button>
          <button class="btn-primary" :disabled="!newTopicName.trim() || !newTopicKeywords.trim()" @click="handleCreateTopic">
            创建
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sentinel-panel {
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
  padding: 0;
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
  color: var(--text-primary);
}

.toolbar {
  display: flex;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.tool-btn {
  padding: 0.4rem 0.75rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tool-btn:hover {
  background: var(--bg-card-hover);
}

.tool-btn.primary {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
}

.tool-btn.primary:hover {
  background: var(--accent-border);
}

.tool-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.empty-hint {
  font-size: 0.75rem;
  color: var(--text-dim);
  margin-top: 0.5rem;
  display: block;
}

.topic-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.topic-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  padding: 0.75rem;
  margin-bottom: 0.5rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.topic-card:hover {
  background: var(--bg-card-hover);
  border-color: var(--border-light);
}

.topic-card.inactive {
  opacity: 0.6;
}

.topic-card.expanded {
  border-color: var(--accent-border);
}

.topic-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.topic-main {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.topic-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
}

.unread-badge {
  background: var(--error);
  color: var(--text-on-accent);
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 10px;
  min-width: 16px;
  text-align: center;
}

.topic-meta {
  display: flex;
  gap: 0.5rem;
  font-size: 0.7rem;
  color: var(--text-dim);
}

.topic-freq {
  font-family: 'JetBrains Mono', monospace;
}

.topic-sources {
  color: var(--accent-text);
}

.topic-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.4rem;
}

.keyword-tag {
  font-size: 0.7rem;
  padding: 2px 8px;
  background: rgba(26, 115, 232, 0.15);
  border: 1px solid rgba(26, 115, 232, 0.2);
  border-radius: 4px;
  color: var(--accent);
}

.topic-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.action-link {
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.72rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease;
}

.action-link:hover {
  color: var(--accent);
}

.action-link.danger:hover {
  color: var(--error);
}

.paper-list {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--border-subtle);
}

.paper-item {
  padding: 0.6rem;
  background: var(--bg-surface);
  border-radius: 6px;
  margin-bottom: 0.4rem;
}

.paper-item.read {
  opacity: 0.6;
}

.paper-item.ignored {
  opacity: 0.3;
}

.paper-title {
  font-size: 0.78rem;
  color: var(--text-primary);
  line-height: 1.4;
  margin-bottom: 0.2rem;
}

.paper-authors {
  font-size: 0.7rem;
  color: var(--text-muted);
  margin-bottom: 0.3rem;
}

.paper-actions {
  display: flex;
  gap: 0.5rem;
}

.paper-link,
.paper-action {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-decoration: none;
  transition: all 0.15s ease;
}

.paper-link {
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  color: var(--accent);
}

.paper-link:hover {
  background: var(--accent-border);
}

.paper-action {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  color: var(--text-secondary);
  border: none;
}

.paper-action:hover {
  background: var(--bg-card-hover);
}

.paper-action.ignore:hover {
  background: rgba(234, 67, 53, 0.15);
  color: var(--error);
}

.paper-empty {
  text-align: center;
  padding: 1rem;
  color: var(--text-dim);
  font-size: 0.75rem;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal-content {
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: 16px;
  padding: 1.25rem;
  width: 320px;
  box-shadow: var(--shadow-xl);
}

.modal-content h3 {
  margin: 0 0 1rem;
  color: var(--text-primary);
  font-size: 0.95rem;
  font-weight: 700;
}

.form-group {
  margin-bottom: 0.75rem;
}

.form-group label {
  display: block;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  margin-bottom: 0.3rem;
}

.form-group input,
.form-group select {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  padding: 0.55rem 0.75rem;
  color: var(--text-primary);
  font-size: 0.82rem;
  outline: none;
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--border-focus);
}

.modal-actions {
  display: flex;
  gap: 0.75rem;
  justify-content: flex-end;
  margin-top: 1rem;
}

.btn-secondary {
  padding: 0.5rem 1rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.82rem;
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-secondary:hover {
  background: var(--bg-card-hover);
}

.btn-primary {
  padding: 0.5rem 1rem;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: var(--text-on-accent);
  font-size: 0.82rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
