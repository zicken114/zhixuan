<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl } from '@tauri-apps/plugin-opener';
import { aiClient } from '../utils/aiClient';
import { recordEvent } from '../composables/useEvents';
import { fetchStoryLibrary, formatCacheAge, type StoryItem } from '../composables/useStoryLibrary';
import {
  loadStoryMaterials,
  addStoryMaterial,
  deleteStoryMaterial,
  type StoryMaterial,
} from '../composables/useDatabase';

const appWindow = getCurrentWebviewWindow();

const emit = defineEmits<{
  close: [];
}>();

// ── 故事列表 ──────────────────────────────────────────────
const stories = ref<StoryItem[]>([]);
const loading = ref(false);
const cachedAt = ref(0);
const fromCache = ref(false);
const errorMsg = ref<string | null>(null);

const searchQuery = ref('');
const expandedId = ref<string | null>(null);

const loadStories = async (forceRefresh = false) => {
  if (forceRefresh) {
    loading.value = true;
  } else {
    loading.value = stories.value.length === 0;
  }
  errorMsg.value = null;

  try {
    const result = await fetchStoryLibrary();
    stories.value = result.items;
    cachedAt.value = result.cachedAt;
    fromCache.value = result.fromCache;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    errorMsg.value = `抓取失败：${msg}`;
    console.error('[StoryLibrary] failed:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(() => loadStories());

const toggleItem = (item: StoryItem) => {
  const id = item.work_id;
  if (expandedId.value === id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = id;
};

// ── 搜索过滤 ──────────────────────────────────────────────
const filteredStories = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return stories.value;
  return stories.value.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      (s.labels || []).some((l) => l.toLowerCase().includes(q))
  );
});

// ── 拆解创作角度 ──────────────────────────────────────────
const ideationCache = ref<Map<string, string>>(new Map());
const ideationLoading = ref<Set<string>>(new Set());
const ideationError = ref<Map<string, string>>(new Map());

const analyzeAngles = async (item: StoryItem) => {
  const id = item.work_id;
  if (ideationCache.value.has(id) || ideationLoading.value.has(id)) return;

  ideationLoading.value.add(id);
  ideationError.value.delete(id);
  const startTime = Date.now();

  try {
    const { text } = await aiClient.chatOnce([
      {
        role: 'system',
        content: `你是刘看山，知乎的官方吉祥物，一只来自北极的小狐狸。说话带点俏皮和热心，偶尔自嘲一下，会随口冒出几个知乎梗，比如"谢邀""利益相关""抖个机灵""先问是不是再问为什么""这是个好问题"之类的，恰到好处就行。

现在我来帮你拆解这个故事的创作角度。从创作者视角出发，看看有哪些改编、续写、同人的方向，每个方向说清楚标题方向、核心切入点、目标受众、预期效果。给建议直接给具体方案，别整虚的套话。

自称"我"，叫用户"你"。说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。`
      },
      {
        role: 'user',
        content: `故事标题：${item.title}\n简介：${item.description || '无'}\n标签：${(item.labels || []).join(', ')}\n\n请帮我拆解这个故事的创作角度。`
      }
    ], false, 'chat');
    ideationCache.value.set(id, text.trim());
    recordEvent({
      event_type: 'story_ideation',
      duration_ms: Date.now() - startTime,
      metadata: { title: item.title, success: true },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ideationError.value.set(id, msg);
    recordEvent({
      event_type: 'story_ideation',
      duration_ms: Date.now() - startTime,
      metadata: { title: item.title, success: false, error: msg },
    });
  } finally {
    ideationLoading.value.delete(id);
  }
};

// ── 加入素材库 ──────────────────────────────────────────────
const quickAddToMaterial = async (item: StoryItem) => {
  await addStoryMaterial({
    title: item.title,
    url: `https://www.zhihu.com/xen/market/remix/paid_column/${item.work_id}`,
    thumbnail: item.tab_artwork || item.artwork,
    summary: item.description,
  });
  await loadMaterials();
};

const addIdeationToMaterial = async (item: StoryItem) => {
  const text = ideationCache.value.get(item.work_id);
  const angles = text ? text.split(/\n{2,}/).filter(s => s.trim().length > 10) : undefined;
  await addStoryMaterial({
    title: item.title,
    url: `https://www.zhihu.com/xen/market/remix/paid_column/${item.work_id}`,
    thumbnail: item.tab_artwork || item.artwork,
    summary: item.description,
    angles,
  });
  await loadMaterials();
};

const isInMaterials = (title: string): boolean => {
  return materials.value.some(m => m.title === title);
};

// ── 素材库 ──────────────────────────────────────────────────
const showMaterialPanel = ref(false);
const materials = ref<StoryMaterial[]>([]);
const selectedMaterialIds = ref<Set<number>>(new Set());
const materialSummary = ref('');
const materialInspiration = ref('');
const aiResultLoading = ref(false);
const aiResultType = ref<'summary' | 'inspiration' | null>(null);

const loadMaterials = async () => {
  try {
    materials.value = await loadStoryMaterials();
  } catch (e) {
    console.error('[KnowledgePanel] Failed to load materials:', e);
  }
};

const toggleMaterialSelection = (id: number) => {
  const next = new Set(selectedMaterialIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  selectedMaterialIds.value = next;
};

const selectedMaterials = computed(() =>
  materials.value.filter(m => selectedMaterialIds.value.has(m.id))
);

const removeMaterial = async (id: number) => {
  await deleteStoryMaterial(id);
  selectedMaterialIds.value.delete(id);
  await loadMaterials();
};

const generateSummary = async () => {
  if (selectedMaterials.value.length === 0) return;
  aiResultLoading.value = true;
  aiResultType.value = 'summary';
  materialSummary.value = '';
  try {
    const context = selectedMaterials.value
      .map((m, i) => `${i + 1}. ${m.title}${m.summary ? '\n' + m.summary : ''}`)
      .join('\n\n');
    const { text } = await aiClient.chatOnce([
      {
        role: 'system',
        content: `你是刘看山，知乎的官方吉祥物，一只来自北极的小狐狸。说话带点俏皮和热心，偶尔自嘲一下，会随口冒出几个知乎梗，比如"谢邀""利益相关""抖个机灵""先问是不是再问为什么""这是个好问题"之类的，恰到好处就行。

现在我来帮你做故事总结。把几个故事串起来看，提炼共性主题、情感基调、叙事手法、有哪些创作技巧可以借鉴。用知乎的眼光去分析，给出干货。

自称"我"，叫用户"你"。说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。`
      },
      {
        role: 'user',
        content: `以下是我收集的知乎故事素材，请帮我做一份故事总结：\n\n${context}`
      }
    ], false, 'chat');
    materialSummary.value = text.trim();
  } catch (e: any) {
    materialSummary.value = `生成失败：${e?.message || '请重试'}`;
  } finally {
    aiResultLoading.value = false;
  }
};

const generateInspiration = async () => {
  if (selectedMaterials.value.length === 0) return;
  aiResultLoading.value = true;
  aiResultType.value = 'inspiration';
  materialInspiration.value = '';
  try {
    const context = selectedMaterials.value
      .map((m, i) =>
        `${i + 1}. ${m.title}${m.angles ? '\n拆解角度：\n' + m.angles.join('\n') : ''}${m.summary ? '\n简介：' + m.summary : ''}`
      )
      .join('\n\n---\n\n');
    const { text } = await aiClient.chatOnce([
      {
        role: 'system',
        content: `你是刘看山，知乎的官方吉祥物，一只来自北极的小狐狸。说话带点俏皮和热心，偶尔自嘲一下，会随口冒出几个知乎梗，比如"谢邀""利益相关""抖个机灵""先问是不是再问为什么""这是个好问题"之类的，恰到好处就行。

现在我来帮你找创作灵感。基于这些故事素材，想想有哪些能切入的角度、标题怎么起、内容怎么搭、读者会在哪里互动。用知乎的思维来想事情：什么样的回答能引发共鸣，什么样的标题有诱惑力。

自称"我"，叫用户"你"。说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。`
      },
      {
        role: 'user',
        content: `以下是我收集的知乎故事素材，请帮我生成创作灵感：\n\n${context}`
      }
    ], false, 'chat');
    materialInspiration.value = text.trim();
  } catch (e: any) {
    materialInspiration.value = `生成失败：${e?.message || '请重试'}`;
  } finally {
    aiResultLoading.value = false;
  }
};

const openMaterialPanel = async () => {
  showMaterialPanel.value = true;
  await loadMaterials();
};

const closeMaterialPanel = () => {
  showMaterialPanel.value = false;
  selectedMaterialIds.value = new Set();
  materialSummary.value = '';
  materialInspiration.value = '';
  aiResultType.value = null;
};

const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
  } catch (e) {
    console.warn('[KnowledgePanel] copy failed:', e);
  }
};

const handleDragStart = async (e: MouseEvent) => {
  if ((e.target as HTMLElement).closest('button, input, .story-panel')) return;
  await appWindow.startDragging();
};
</script>

<template>
  <div class="story-panel">
    <div class="drag-handle" @mousedown="handleDragStart"></div>

    <!-- Header -->
    <div class="sidebar-header">
      <span class="sidebar-title">📖 知乎故事素材库</span>
      <div class="header-actions">
        <span v-if="cachedAt && !loading" class="cache-age">{{ formatCacheAge(cachedAt) }}</span>
        <button class="header-btn" @click="openMaterialPanel">
          📚 素材库 ({{ materials.length }})
        </button>
        <button class="close-btn" @click="emit('close')">×</button>
      </div>
    </div>

    <!-- Toolbar -->
    <div class="toolbar">
      <div class="search-input-wrapper">
        <input
          v-model="searchQuery"
          type="text"
          class="search-input"
          placeholder="搜索故事素材..."
        />
      </div>
      <button class="tool-btn primary" :disabled="loading" @click="loadStories(true)">
        {{ loading ? '抓取中...' : '🔄 刷新' }}
      </button>
    </div>

    <!-- Error -->
    <div v-if="errorMsg" class="error-message">
      {{ errorMsg }}
    </div>

    <!-- Story List -->
    <div class="story-list">
      <div v-if="loading && stories.length === 0" class="empty-state">
        <span class="spinner"></span>
        正在抓取故事素材...
      </div>
      <div v-else-if="filteredStories.length === 0" class="empty-state">
        {{ stories.length === 0 ? '暂无故事素材，点击「刷新」试试' : '未找到匹配的故事素材' }}
      </div>

      <div
        v-for="item in filteredStories"
        :key="item.work_id"
        class="story-card"
        :class="{ expanded: expandedId === item.work_id }"
      >
        <!-- Card Header -->
        <div class="story-header" @click="toggleItem(item)">
          <div class="story-cover-wrap">
            <img
              v-if="item.tab_artwork || item.artwork"
              :src="item.tab_artwork || item.artwork"
              class="story-cover"
              alt=""
              loading="lazy"
              @error="(e) => { const t = e.target as HTMLImageElement | null; if (t) t.style.display = 'none'; }"
            />
            <div v-else class="story-cover-placeholder">📖</div>
          </div>
          <div class="story-body">
            <div class="story-title">{{ item.title }}</div>
            <div v-if="item.description" class="story-desc">{{ item.description }}</div>
            <div v-if="item.labels && item.labels.length" class="story-tags">
              <span v-for="(tag, idx) in item.labels" :key="idx" class="story-tag">{{ tag }}</span>
            </div>
          </div>
          <span class="expand-indicator">{{ expandedId === item.work_id ? '−' : '+' }}</span>
        </div>

        <!-- Expanded Actions -->
        <div v-if="expandedId === item.work_id" class="story-actions">
          <div class="action-row">
            <button
              class="action-main-btn"
              :disabled="ideationLoading.has(item.work_id)"
              @click.stop="analyzeAngles(item)"
            >
              {{ ideationLoading.has(item.work_id) ? '拆解中...' : '🔍 拆解创作角度' }}
            </button>
            <button
              class="action-main-btn secondary"
              :disabled="isInMaterials(item.title)"
              @click.stop="quickAddToMaterial(item)"
            >
              {{ isInMaterials(item.title) ? '✓ 已加入' : '📚 加入素材库' }}
            </button>
            <button
              class="action-link-btn"
              @click.stop="openUrl(`https://www.zhihu.com/xen/market/remix/paid_column/${item.work_id}`)"
            >
              🔗 打开
            </button>
          </div>

          <!-- Ideation Result -->
          <div v-if="ideationLoading.has(item.work_id)" class="ideation-loading">
            <span class="spinner"></span>
            <span>正在为你拆解创作角度...</span>
          </div>

          <div v-else-if="ideationError.has(item.work_id)" class="ideation-error">
            生成失败：{{ ideationError.get(item.work_id) }}
            <button class="retry-btn" @click.stop="analyzeAngles(item)">重试</button>
          </div>

          <div v-else-if="ideationCache.has(item.work_id)" class="ideation-content">
            <pre class="ideation-text">{{ ideationCache.get(item.work_id) }}</pre>
            <div class="ideation-footer">
              <button class="action-link-btn" @click.stop="copyText(ideationCache.get(item.work_id) || '')">📋 复制</button>
              <button
                class="action-link-btn"
                :disabled="isInMaterials(item.title)"
                @click.stop="addIdeationToMaterial(item)"
              >
                {{ isInMaterials(item.title) ? '✓ 已加入素材库' : '📚 将拆解加入素材库' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Material Panel Overlay -->
    <div v-if="showMaterialPanel" class="panel-overlay" @click.self="closeMaterialPanel">
      <div class="material-panel">
        <div class="panel-header">
          <h3>📚 故事素材库</h3>
          <button class="close-btn" @click="closeMaterialPanel">×</button>
        </div>

        <div v-if="materials.length === 0" class="panel-empty">
          暂无素材，在故事库中点击「加入素材库」即可收录。
        </div>

        <div v-else class="material-list">
          <div
            v-for="m in materials"
            :key="m.id"
            class="material-row"
            :class="{ selected: selectedMaterialIds.has(m.id) }"
            @click="toggleMaterialSelection(m.id)"
          >
            <div class="material-check">
              <span v-if="selectedMaterialIds.has(m.id)">☑</span>
              <span v-else>☐</span>
            </div>
            <div class="material-info">
              <div class="material-title">{{ m.title }}</div>
              <div v-if="m.summary" class="material-desc">{{ m.summary }}</div>
              <div v-if="m.angles" class="material-tags">
                <span v-for="(angle, idx) in m.angles.slice(0, 2)" :key="idx" class="tag">{{ angle.slice(0, 24) }}...</span>
              </div>
            </div>
            <button class="material-del" @click.stop="removeMaterial(m.id)">×</button>
          </div>
        </div>

        <div v-if="materials.length > 0" class="panel-toolbar">
          <span class="panel-count">已选 {{ selectedMaterials.length }} / {{ materials.length }} 条</span>
          <div class="panel-actions">
            <button
              class="toolbar-btn"
              :disabled="selectedMaterials.length === 0 || aiResultLoading"
              @click="generateSummary"
            >
              {{ aiResultLoading && aiResultType === 'summary' ? '生成中...' : '🔥 故事总结' }}
            </button>
            <button
              class="toolbar-btn"
              :disabled="selectedMaterials.length === 0 || aiResultLoading"
              @click="generateInspiration"
            >
              {{ aiResultLoading && aiResultType === 'inspiration' ? '生成中...' : '💡 创作灵感' }}
            </button>
          </div>
        </div>

        <div v-if="materialSummary || materialInspiration" class="ai-result">
          <h4 v-if="materialSummary">🔥 故事总结</h4>
          <pre v-if="materialSummary">{{ materialSummary }}</pre>
          <h4 v-if="materialInspiration">💡 创作灵感</h4>
          <pre v-if="materialInspiration">{{ materialInspiration }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.story-panel {
  width: 100%;
  height: 100%;
  background: var(--bg-base);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid var(--border-subtle);
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

/* Header */
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.cache-age {
  font-size: 0.65rem;
  color: var(--text-dim);
}

.header-btn {
  font-size: 0.7rem;
  padding: 0.25rem 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--border-light);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}

.header-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
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

/* Toolbar */
.toolbar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border-subtle);
}

.search-input-wrapper {
  flex: 1;
  min-width: 0;
}

.search-input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
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

.tool-btn {
  padding: 0.4rem 0.75rem;
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 0.78rem;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
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

/* Error */
.error-message {
  padding: var(--space-sm) var(--space-lg);
  background: var(--error-bg);
  border-bottom: 1px solid rgba(234, 67, 53, 0.1);
  color: var(--error);
  font-size: 0.78rem;
}

/* Story List */
.story-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted);
  font-size: 0.82rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.story-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  margin-bottom: 0.5rem;
  overflow: hidden;
  transition: all 0.15s ease;
}

.story-card:hover {
  border-color: var(--border-light);
}

.story-card.expanded {
  border-color: var(--accent-border);
  background: var(--bg-elevated);
}

.story-header {
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
  padding: 0.75rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.story-header:hover {
  background: var(--bg-card-hover);
}

.story-cover-wrap {
  width: 56px;
  height: 75px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: center;
}

.story-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.story-cover-placeholder {
  font-size: 1.5rem;
}

.story-body {
  flex: 1;
  min-width: 0;
}

.story-title {
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.story-desc {
  font-size: 0.72rem;
  color: var(--text-secondary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin-top: 0.2rem;
}

.story-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.3rem;
}

.story-tag {
  font-size: 0.65rem;
  padding: 2px 8px;
  border-radius: 10px;
  background: var(--accent-subtle);
  color: var(--accent-text);
  font-weight: 500;
}

.expand-indicator {
  flex-shrink: 0;
  font-size: 1.1rem;
  color: var(--text-muted);
  width: 18px;
  text-align: center;
  user-select: none;
  margin-top: 0.1rem;
}

/* Expanded actions */
.story-actions {
  padding: 0.6rem 0.75rem;
  border-top: 1px solid var(--border-subtle);
  background: var(--bg-base);
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.5rem;
}

.action-main-btn {
  font-size: 0.72rem;
  padding: 0.35rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--accent-border);
  background: var(--accent-subtle);
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-main-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
}

.action-main-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-main-btn.secondary {
  background: var(--bg-surface);
  border-color: var(--border-light);
  color: var(--text-secondary);
}

.action-main-btn.secondary:hover:not(:disabled) {
  background: var(--bg-card-hover);
  border-color: var(--border-medium);
  color: var(--text-primary);
}

.action-link-btn {
  font-size: 0.68rem;
  padding: 0.3rem 0.5rem;
  border-radius: 4px;
  border: 1px solid var(--border-light);
  background: var(--bg-surface);
  color: var(--text-dim);
  cursor: pointer;
  transition: all 0.15s ease;
}

.action-link-btn:hover {
  background: var(--accent-subtle);
  border-color: var(--accent-border);
  color: var(--accent);
}

/* Ideation */
.ideation-loading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.78rem;
  padding: 0.5rem 0;
}

.ideation-error {
  color: var(--error);
  font-size: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.5rem 0;
}

.retry-btn {
  align-self: flex-start;
  padding: 0.3rem 0.7rem;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 6px;
  color: var(--accent);
  font-size: 0.72rem;
  cursor: pointer;
}

.retry-btn:hover {
  background: var(--accent-border);
}

.ideation-content {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.ideation-text {
  margin: 0;
  padding: 0.65rem 0.8rem;
  background: var(--bg-surface);
  border-radius: 8px;
  border: 1px solid var(--border-subtle);
  font-size: 0.76rem;
  line-height: 1.65;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 240px;
  overflow-y: auto;
}

.ideation-footer {
  display: flex;
  gap: 0.5rem;
}

/* Material Panel */
.panel-overlay {
  position: absolute;
  inset: 0;
  background: var(--bg-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}

.material-panel {
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 1rem;
  width: 380px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-xl);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.75rem;
}

.panel-header h3 {
  margin: 0;
  font-size: 0.95rem;
}

.panel-empty {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.material-list {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  max-height: 280px;
  overflow-y: auto;
}

.material-row {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.55rem 0.5rem;
  border-radius: 8px;
  background: var(--bg-surface);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.material-row:hover {
  border-color: var(--border-light);
}

.material-row.selected {
  border-color: var(--accent-border);
  background: var(--accent-subtle);
}

.material-check {
  font-size: 1rem;
  line-height: 1;
  margin-top: 0.1rem;
  flex-shrink: 0;
}

.material-info {
  flex: 1;
  min-width: 0;
}

.material-title {
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-desc {
  font-size: 0.68rem;
  color: var(--text-secondary);
  margin-top: 0.1rem;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
}

.material-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  margin-top: 0.2rem;
}

.tag {
  font-size: 0.6rem;
  padding: 0.08rem 0.3rem;
  background: var(--bg-card-hover);
  border-radius: 4px;
  color: var(--text-dim);
}

.material-del {
  background: none;
  border: none;
  color: var(--text-dim);
  font-size: 1rem;
  cursor: pointer;
  padding: 0 0.2rem;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s ease;
}

.material-del:hover {
  color: var(--error);
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border-subtle);
}

.panel-count {
  font-size: 0.68rem;
  color: var(--text-muted);
}

.panel-actions {
  display: flex;
  gap: 0.4rem;
}

.toolbar-btn {
  font-size: 0.72rem;
  padding: 0.35rem 0.7rem;
  border-radius: 6px;
  border: 1px solid var(--accent-border);
  background: var(--accent-subtle);
  color: var(--accent);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--accent);
  color: var(--text-on-accent);
}

.toolbar-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-result {
  margin-top: 0.6rem;
  padding-top: 0.6rem;
  border-top: 1px solid var(--border-subtle);
}

.ai-result h4 {
  margin: 0 0 0.4rem;
  font-size: 0.82rem;
  color: var(--text-primary);
}

.ai-result pre {
  margin: 0 0 0.6rem;
  padding: 0.6rem;
  background: var(--bg-surface);
  border-radius: 8px;
  font-size: 0.76rem;
  line-height: 1.65;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}
</style>
