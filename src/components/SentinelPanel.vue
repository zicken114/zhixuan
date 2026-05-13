<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { openUrl } from '@tauri-apps/plugin-opener';
import { aiClient } from '../utils/aiClient';
import { recordEvent } from '../composables/useEvents';
import { fetchHotList, formatCacheAge, type HotItem } from '../composables/useHotList';
import {
  loadHotTopicMaterials,
  addHotTopicMaterial,
  deleteHotTopicMaterial,
  type HotTopicMaterial,
} from '../composables/useDatabase';

const emit = defineEmits<{
  close: [];
}>();

// ── 热榜列表 ────────────────────────────────────────────────
const hotList = ref<HotItem[]>([]);
const loading = ref(false);
const isMockData = ref(false);
const cachedAt = ref(0);

const searchQuery = ref('');
const expandedId = ref<string | null>(null);
const ideationCache = ref<Map<string, string>>(new Map());
const ideationLoading = ref<Set<string>>(new Set());
const ideationError = ref<Map<string, string>>(new Map());

const filteredHotList = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return hotList.value;
  return hotList.value.filter(
    (h) =>
      h.title.toLowerCase().includes(q) ||
      (h.excerpt || '').toLowerCase().includes(q)
  );
});

const loadHotList = async (forceRefresh = false) => {
  loading.value = true;
  try {
    const { items, isMock, cachedAt: ts } = await fetchHotList(forceRefresh);
    hotList.value = items;
    isMockData.value = isMock;
    cachedAt.value = ts;
  } catch (e) {
    console.error('[SentinelPanel] failed:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(() => loadHotList());

const toggleItem = (item: HotItem) => {
  const id = item.id;
  if (expandedId.value === id) {
    expandedId.value = null;
    return;
  }
  expandedId.value = id;
};

// ── 拆解角度 ────────────────────────────────────────────────
const analyzeAngles = async (item: HotItem) => {
  const id = item.id;
  if (ideationCache.value.has(id) || ideationLoading.value.has(id)) return;

  ideationLoading.value.add(id);
  ideationError.value.delete(id);
  const startTime = Date.now();

  try {
    const { text } = await aiClient.chatOnce([
      {
        role: 'system',
        content: `你是刘看山，知乎的官方吉祥物，一只来自北极的小狐狸。说话带点俏皮和热心，偶尔自嘲一下，会随口冒出几个知乎梗，比如"谢邀""利益相关""抖个机灵""先问是不是再问为什么""这是个好问题"之类的，恰到好处就行。

现在我来帮你拆解这个热点的创作角度。从创作者视角出发，找出 3-5 个最有价值的回答方向，每个方向说清楚标题方向、核心切入点、目标受众、预期效果。给建议直接给具体方案，别整虚的套话。

自称"我"，叫用户"你"。说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。`
      },
      {
        role: 'user',
        content: `话题：${item.title}\n摘要：${item.excerpt || '无'}\n链接：${item.url || ''}\n\n请帮我拆解这个热点的创作角度。`
      }
    ], false, 'chat');
    ideationCache.value.set(id, text.trim());
    recordEvent({
      event_type: 'hot_list_ideation',
      duration_ms: Date.now() - startTime,
      metadata: { title: item.title, success: true, isMock: isMockData.value },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ideationError.value.set(id, msg);
    recordEvent({
      event_type: 'hot_list_ideation',
      duration_ms: Date.now() - startTime,
      metadata: { title: item.title, success: false, error: msg },
    });
  } finally {
    ideationLoading.value.delete(id);
  }
};

// ── 加入素材库 ──────────────────────────────────────────────
const quickAddToMaterial = async (item: HotItem) => {
  await addHotTopicMaterial({
    title: item.title,
    url: item.url,
    thumbnail: item.thumbnail,
    summary: item.excerpt,
  });
  await loadMaterials();
};

const addIdeationToMaterial = async (item: HotItem) => {
  const text = ideationCache.value.get(item.id);
  const angles = text ? text.split(/\n{2,}/).filter(s => s.trim().length > 10) : undefined;
  await addHotTopicMaterial({
    title: item.title,
    url: item.url,
    thumbnail: item.thumbnail,
    summary: item.excerpt,
    angles,
  });
  await loadMaterials();
};

/** 实时检查素材库中是否已收录同名热点 */
const isInMaterials = (title: string): boolean => {
  return materials.value.some(m => m.title === title);
};

// ── 素材库 ──────────────────────────────────────────────────
const showMaterialPanel = ref(false);
const materials = ref<HotTopicMaterial[]>([]);
const selectedMaterialIds = ref<Set<number>>(new Set());
const materialSummary = ref('');
const materialInspiration = ref('');
const aiResultLoading = ref(false);
const aiResultType = ref<'summary' | 'inspiration' | null>(null);

const loadMaterials = async () => {
  try {
    materials.value = await loadHotTopicMaterials();
  } catch (e) {
    console.error('[SentinelPanel] Failed to load materials:', e);
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
  await deleteHotTopicMaterial(id);
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

现在我来帮你做热点总结。把多个热点串起来看，提炼共性趋势、核心矛盾、用户到底在关注什么。用知乎的眼光去分析，给出干货。

自称"我"，叫用户"你"。说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。`
      },
      {
        role: 'user',
        content: `以下是我收集的知乎热点素材，请帮我做一份热点总结：\n\n${context}`
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
        `${i + 1}. ${m.title}${m.angles ? '\n拆解角度：\n' + m.angles.join('\n') : ''}${m.summary ? '\n摘要：' + m.summary : ''}`
      )
      .join('\n\n---\n\n');
    const { text } = await aiClient.chatOnce([
      {
        role: 'system',
        content: `你是刘看山，知乎的官方吉祥物，一只来自北极的小狐狸。说话带点俏皮和热心，偶尔自嘲一下，会随口冒出几个知乎梗，比如"谢邀""利益相关""抖个机灵""先问是不是再问为什么""这是个好问题"之类的，恰到好处就行。

现在我来帮你找创作灵感。基于这些热点素材，想想有哪些能切入的角度、标题怎么起、内容怎么搭、读者会在哪里互动。用知乎的思维来想事情：什么样的回答能引发共鸣，什么样的标题有诱惑力。

自称"我"，叫用户"你"。说话要像真人，自然流畅，不要出现星号、井号、列表编号这些 markdown 符号，直接输出纯文字。`
      },
      {
        role: 'user',
        content: `以下是我收集的知乎热点素材，请帮我生成创作灵感：\n\n${context}`
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
    console.warn('[SentinelPanel] copy failed:', e);
  }
};
</script>

<template>
  <div class="sentinel-panel">
    <!-- Header -->
    <div class="sidebar-header">
      <span class="sidebar-title">🔥 热榜灵感雷达</span>
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
          placeholder="搜索热榜话题..."
        />
      </div>
      <button class="tool-btn primary" :disabled="loading" @click="loadHotList(true)">
        {{ loading ? '抓取中...' : '🔄 刷新热榜' }}
      </button>
      <span class="status-tag" :class="{ mock: isMockData }">
        {{ isMockData ? '兜底数据' : '实时数据' }}
      </span>
    </div>

    <div v-if="isMockData" class="mock-notice">
      接口不通或被 CORS 拦截，已切换到本地兜底数据。点击仍可生成破题灵感。
    </div>

    <div v-if="loading && hotList.length === 0" class="empty-state">加载中...</div>
    <div v-else-if="hotList.length === 0" class="empty-state">
      暂无热榜数据
      <span class="empty-hint">点击「刷新热榜」试试</span>
    </div>
    <div v-else-if="filteredHotList.length === 0" class="empty-state">
      未找到匹配的热点话题
    </div>

    <!-- Hot List -->
    <div v-else class="hot-list">
      <div
        v-for="(item, idx) in filteredHotList"
        :key="item.id"
        class="hot-card"
        :class="{ expanded: expandedId === item.id }"
      >
        <div class="hot-header" @click="toggleItem(item)">
          <div class="hot-thumb-wrap">
            <img
              v-if="item.thumbnail"
              :src="item.thumbnail"
              class="hot-thumb"
              alt=""
              loading="lazy"
              @error="(e) => { const t = e.target as HTMLImageElement | null; if (t) t.style.display = 'none'; }"
            />
            <div v-else class="hot-thumb-placeholder">📰</div>
          </div>
          <div class="hot-body">
            <div class="hot-title-line">
              <span class="hot-rank" :class="{ 'top-three': idx < 3 }">{{ idx + 1 }}</span>
              <span class="hot-title">{{ item.title }}</span>
            </div>
            <div v-if="item.excerpt" class="hot-excerpt">{{ item.excerpt }}</div>
            <div class="hot-meta">
              <span class="hot-heat">{{ item.heat }}</span>
            </div>
          </div>
          <span class="expand-indicator">{{ expandedId === item.id ? '−' : '+' }}</span>
        </div>

        <!-- Expanded Actions -->
        <div v-if="expandedId === item.id" class="hot-actions">
          <div class="action-row">
            <button
              class="action-main-btn"
              :disabled="ideationLoading.has(item.id)"
              @click.stop="analyzeAngles(item)"
            >
              {{ ideationLoading.has(item.id) ? '拆解中...' : '🔍 拆解角度' }}
            </button>
            <button
              class="action-main-btn secondary"
              :disabled="isInMaterials(item.title)"
              @click.stop="quickAddToMaterial(item)"
            >
              {{ isInMaterials(item.title) ? '✓ 已加入' : '📚 加入素材库' }}
            </button>
            <button v-if="item.url" class="action-link-btn" @click.stop="openUrl(item.url)">🔗 打开</button>
            <button v-if="item.url" class="action-link-btn" @click.stop="copyText(item.url)">📋 复制链接</button>
          </div>

          <!-- Ideation Result -->
          <div v-if="ideationLoading.has(item.id)" class="ideation-loading">
            <span class="spinner"></span>
            <span>正在为你拆解创作角度...</span>
          </div>

          <div v-else-if="ideationError.has(item.id)" class="ideation-error">
            生成失败：{{ ideationError.get(item.id) }}
            <button class="retry-btn" @click.stop="analyzeAngles(item)">重试</button>
          </div>

          <div v-else-if="ideationCache.has(item.id)" class="ideation-content">
            <pre class="ideation-text">{{ ideationCache.get(item.id) }}</pre>
            <div class="ideation-footer">
              <button class="action-link-btn" @click.stop="copyText(ideationCache.get(item.id) || '')">📋 复制</button>
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
          <h3>📚 热点素材库</h3>
          <button class="close-btn" @click="closeMaterialPanel">×</button>
        </div>

        <div v-if="materials.length === 0" class="panel-empty">
          暂无素材，在热榜中点击「加入素材库」即可收录。
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
              {{ aiResultLoading && aiResultType === 'summary' ? '生成中...' : '🔥 热点总结' }}
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
          <h4 v-if="materialSummary">🔥 热点总结</h4>
          <pre v-if="materialSummary">{{ materialSummary }}</pre>
          <h4 v-if="materialInspiration">💡 创作灵感</h4>
          <pre v-if="materialInspiration">{{ materialInspiration }}</pre>
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
  position: relative;
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

.status-tag {
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(52, 168, 83, 0.15);
  color: #2e7d32;
  font-weight: 600;
}

.status-tag.mock {
  background: rgba(251, 188, 5, 0.18);
  color: #b45309;
}

.mock-notice {
  padding: 0.55rem 1rem;
  background: rgba(251, 188, 5, 0.08);
  color: #b45309;
  font-size: 0.72rem;
  border-bottom: 1px solid var(--border-subtle);
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

/* Hot List */
.hot-list {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
}

.hot-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  margin-bottom: 0.5rem;
  overflow: hidden;
  transition: all 0.15s ease;
}

.hot-card:hover {
  border-color: var(--border-light);
}

.hot-card.expanded {
  border-color: var(--accent-border);
  background: var(--bg-elevated);
}

.hot-header {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.6rem 0.7rem;
  cursor: pointer;
  transition: background 0.15s ease;
}

.hot-header:hover {
  background: var(--bg-card-hover);
}

.hot-thumb-wrap {
  flex-shrink: 0;
}

.hot-thumb {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
  background: var(--bg-surface);
}

.hot-thumb-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
}

.hot-body {
  flex: 1;
  min-width: 0;
}

.hot-title-line {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 0.15rem;
}

.hot-rank {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-muted);
  background: var(--bg-card-hover);
  border-radius: 4px;
}

.hot-rank.top-three {
  background: linear-gradient(135deg, #ff6b35 0%, #f72585 100%);
  color: #fff;
}

.hot-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.hot-excerpt {
  font-size: 0.72rem;
  color: var(--text-secondary);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  margin-bottom: 0.1rem;
}

.hot-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.hot-heat {
  font-size: 0.7rem;
  color: #ff6b35;
  font-weight: 600;
  font-family: 'JetBrains Mono', monospace;
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
.hot-actions {
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

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border-light);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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
