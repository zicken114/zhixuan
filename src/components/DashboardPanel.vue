<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { useProjectStore } from '../stores/projects';
import {
  getEventStats,
  getDailyEventCounts,
  getUsageStats,
  getReadingStats,
  getProjectStats,
  loadProjects,
  type EventStats,
  type DailyEventCount
} from '../composables/useDatabase';

const projectStore = useProjectStore();
const emit = defineEmits<{
  close: [];
}>();

// Time range filter
const timeRange = ref<'week' | 'month' | 'quarter'>('week');
const selectedProjectId = ref<string | null | 'all'>(projectStore.currentProjectId ?? 'all');
const effectiveProjectId = computed(() => selectedProjectId.value === 'all' ? null : selectedProjectId.value);

const sinceTimestamp = computed(() => {
  const now = Date.now();
  switch (timeRange.value) {
    case 'week': return now - 7 * 24 * 60 * 60 * 1000;
    case 'month': return now - 30 * 24 * 60 * 60 * 1000;
    case 'quarter': return now - 90 * 24 * 60 * 60 * 1000;
  }
});
const daysInRange = computed(() => {
  switch (timeRange.value) {
    case 'week': return 7;
    case 'month': return 30;
    case 'quarter': return 90;
  }
});

// Loading states
const loading = ref(true);
const error = ref<string | null>(null);

// Data refs
const eventStats = ref<EventStats | null>(null);
const usageStats = ref<Awaited<ReturnType<typeof getUsageStats>> | null>(null);
const readingStats = ref<Awaited<ReturnType<typeof getReadingStats>> | null>(null);
const projectStats = ref<Awaited<ReturnType<typeof getProjectStats>> | null>(null);
const dailyEvents = ref<DailyEventCount[]>([]);
const dailyChatEvents = ref<DailyEventCount[]>([]);
const dailyReadingEvents = ref<DailyEventCount[]>([]);
const projects = ref<Awaited<ReturnType<typeof loadProjects>>>([]);

// Load all dashboard data
const loadDashboard = async () => {
  loading.value = true;
  error.value = null;
  try {
    const since = sinceTimestamp.value;
    const days = daysInRange.value;

    const pid = effectiveProjectId.value;
    const [
      evStats,
      usStats,
      rdStats,
      prStats,
      dayEvents,
      dayChats,
      dayReadings,
      projList
    ] = await Promise.all([
      getEventStats(since, pid),
      getUsageStats(since, pid),
      getReadingStats(pid),
      getProjectStats(pid),
      getDailyEventCounts(null, days, pid),
      getDailyEventCounts('chat_start', days, pid),
      getDailyEventCounts('reading_session_start', days, pid),
      loadProjects()
    ]);

    eventStats.value = evStats;
    usageStats.value = usStats;
    readingStats.value = rdStats;
    projectStats.value = prStats;
    dailyEvents.value = dayEvents;
    dailyChatEvents.value = dayChats;
    dailyReadingEvents.value = dayReadings;
    projects.value = projList;
  } catch (e) {
    console.error('[Dashboard] Failed to load:', e);
    error.value = '加载仪表盘数据失败';
  } finally {
    loading.value = false;
  }
};

onMounted(loadDashboard);
watch(() => projectStore.currentProjectId, () => {
  selectedProjectId.value = projectStore.currentProjectId ?? 'all';
  loadDashboard();
});
watch(timeRange, loadDashboard);
watch(selectedProjectId, loadDashboard);

// Computed stats for summary cards
const totalReadingSessions = computed(() => {
  return readingStats.value?.totalSessions ?? 0;
});

const totalChatEvents = computed(() => {
  return eventStats.value?.typeBreakdown.find(t => t.eventType === 'chat_start')?.count ?? 0;
});

const totalWritingEvents = computed(() => {
  const types = ['writing_polish', 'citation_insert', 'citation_recommend', 'writing_format_fix'];
  return eventStats.value?.typeBreakdown
    .filter(t => types.includes(t.eventType))
    .reduce((sum, t) => sum + t.count, 0) ?? 0;
});

const totalCost = computed(() => {
  return usageStats.value?.totalCost ?? 0;
});

// Chart helpers
const maxDailyCount = computed(() => {
  return Math.max(...dailyEvents.value.map(d => d.count), 1);
});

const getBarHeight = (count: number) => {
  if (maxDailyCount.value === 0) return '0%';
  return `${(count / maxDailyCount.value) * 100}%`;
};

const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

const formatCurrency = (cost: number) => {
  return `¥${cost.toFixed(2)}`;
};

// Heatmap data (last 12 weeks = 84 days)
const heatmapDays = computed(() => {
  const days: { date: string; count: number }[] = [];
  const today = new Date();
  for (let i = 83; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const dayData = dailyEvents.value.find(de => de.date === dateStr);
    days.push({ date: dateStr, count: dayData?.count ?? 0 });
  }
  return days;
});

const getHeatmapIntensity = (count: number) => {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
};

// Project time distribution (from event stats)
const projectDistribution = computed(() => {
  if (!eventStats.value?.projectBreakdown.length) return [];
  const total = eventStats.value.projectBreakdown.reduce((s, p) => s + p.count, 0);
  if (total === 0) return [];

  return eventStats.value.projectBreakdown
    .filter(p => p.projectId !== null)
    .map(p => {
      const proj = projects.value.find(pr => pr.id === p.projectId);
      return {
        name: proj?.name || '未知项目',
        color: proj?.color || '#666',
        count: p.count,
        percentage: Math.round((p.count / total) * 100)
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
});

// Model usage distribution
const modelDistribution = computed(() => {
  return usageStats.value?.modelBreakdown.slice(0, 5) ?? [];
});

// Task type distribution
const taskDistribution = computed(() => {
  return usageStats.value?.taskBreakdown.slice(0, 5) ?? [];
});

// Activity type breakdown for bar chart
const activityTypes = computed(() => {
  const typeLabels: Record<string, string> = {
    chat_start: 'AI对话',
    reading_session_start: '阅读文献',
    writing_polish: '写作润色',
    citation_insert: '引用插入',
    capture_ocr_complete: '截图提取',
    experiment_snapshot: '实验记录',
    sentinel_check: '文献哨兵',
    project_create: '创建项目',
    todo_complete: '完成待办',
    zotero_sync: 'Zotero同步',
    kb_index_complete: '知识库索引',
    synthesis_complete: '综述生成'
  };

  return (eventStats.value?.typeBreakdown ?? [])
    .filter(t => (typeLabels[t.eventType] || t.eventType) && t.count > 0)
    .slice(0, 8)
    .map(t => ({
      label: typeLabels[t.eventType] || t.eventType,
      count: t.count
    }));
});

const maxActivityCount = computed(() => {
  return Math.max(...activityTypes.value.map(a => a.count), 1);
});
</script>

<template>
  <div class="dashboard-panel">
    <div class="sidebar-header">
      <span class="sidebar-title">📊 数据仪表盘</span>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>

    <!-- Time range selector -->
    <div class="time-range-bar">
      <button
        v-for="range in ['week', 'month', 'quarter'] as const"
        :key="range"
        class="range-btn"
        :class="{ active: timeRange === range }"
        @click="timeRange = range"
      >
        {{ range === 'week' ? '本周' : range === 'month' ? '本月' : '本季' }}
      </button>
    </div>

    <!-- Project filter -->
    <div class="project-filter-bar">
      <label>项目：</label>
      <select v-model="selectedProjectId" class="project-select">
        <option value="all">全部项目</option>
        <option
          v-for="proj in projects"
          :key="proj.id"
          :value="proj.id"
        >
          {{ proj.name }}
        </option>
      </select>
    </div>

    <div v-if="loading" class="loading-state">加载中...</div>
    <div v-else-if="error" class="error-state">{{ error }}</div>
    <div v-else class="dashboard-content">
      <!-- Summary Cards -->
      <div class="summary-cards">
        <div class="summary-card">
          <div class="card-icon">📚</div>
          <div class="card-value">{{ totalReadingSessions }}</div>
          <div class="card-label">阅读文献</div>
        </div>
        <div class="summary-card">
          <div class="card-icon">💬</div>
          <div class="card-value">{{ totalChatEvents }}</div>
          <div class="card-label">AI对话</div>
        </div>
        <div class="summary-card">
          <div class="card-icon">✍️</div>
          <div class="card-value">{{ totalWritingEvents }}</div>
          <div class="card-label">写作操作</div>
        </div>
        <div class="summary-card">
          <div class="card-icon">💰</div>
          <div class="card-value">{{ formatCurrency(totalCost) }}</div>
          <div class="card-label">模型消耗</div>
        </div>
      </div>

      <!-- Daily Activity Trend (Line/Bar Chart) -->
      <div class="chart-section">
        <h4 class="chart-title">📈 每日活跃趋势</h4>
        <div class="trend-chart">
          <div
            v-for="day in dailyEvents"
            :key="day.date"
            class="trend-bar-wrapper"
            :title="`${day.date}: ${day.count} 次活动`"
          >
            <div class="trend-bar" :style="{ height: getBarHeight(day.count) }"></div>
            <div class="trend-label">{{ formatDate(day.date) }}</div>
          </div>
        </div>
      </div>

      <!-- Activity Heatmap -->
      <div class="chart-section">
        <h4 class="chart-title">🔥 科研活跃度热力图</h4>
        <div class="heatmap">
          <div
            v-for="(day, idx) in heatmapDays"
            :key="idx"
            class="heatmap-cell"
            :class="`intensity-${getHeatmapIntensity(day.count)}`"
            :title="`${day.date}: ${day.count} 次活动`"
          ></div>
        </div>
        <div class="heatmap-legend">
          <span>少</span>
          <div class="legend-cell intensity-0"></div>
          <div class="legend-cell intensity-1"></div>
          <div class="legend-cell intensity-2"></div>
          <div class="legend-cell intensity-3"></div>
          <div class="legend-cell intensity-4"></div>
          <span>多</span>
        </div>
      </div>

      <!-- Two-column layout for smaller charts -->
      <div class="charts-row">
        <!-- Project Distribution -->
        <div class="chart-section half">
          <h4 class="chart-title">📁 项目时间分配</h4>
          <div v-if="projectDistribution.length === 0" class="empty-chart">
            暂无项目数据
          </div>
          <div v-else class="pie-chart">
            <div class="pie-visual">
              <svg viewBox="0 0 100 100" class="pie-svg">
                <circle
                  v-for="(slice, i) in projectDistribution"
                  :key="i"
                  cx="50" cy="50" r="40"
                  fill="none"
                  :stroke="slice.color"
                  stroke-width="20"
                  :stroke-dasharray="`${slice.percentage * 2.51} ${251 - slice.percentage * 2.51}`"
                  :stroke-dashoffset="-projectDistribution.slice(0, i).reduce((s, p) => s + p.percentage * 2.51, 0)"
                  transform="rotate(-90 50 50)"
                />
              </svg>
            </div>
            <div class="pie-legend">
              <div v-for="(item, i) in projectDistribution" :key="i" class="legend-item">
                <div class="legend-dot" :style="{ background: item.color }"></div>
                <span class="legend-name">{{ item.name }}</span>
                <span class="legend-pct">{{ item.percentage }}%</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Activity Type Distribution -->
        <div class="chart-section half">
          <h4 class="chart-title">🎯 活动类型分布</h4>
          <div v-if="activityTypes.length === 0" class="empty-chart">
            暂无活动数据
          </div>
          <div v-else class="bar-chart">
            <div
              v-for="(item, i) in activityTypes"
              :key="i"
              class="bar-row"
            >
              <div class="bar-label">{{ item.label }}</div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  :style="{ width: `${(item.count / maxActivityCount) * 100}%` }"
                ></div>
              </div>
              <div class="bar-value">{{ item.count }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Model Usage -->
      <div class="chart-section">
        <h4 class="chart-title">🤖 模型使用分布</h4>
        <div v-if="modelDistribution.length === 0" class="empty-chart">
          暂无模型使用数据
        </div>
        <div v-else class="model-list">
          <div
            v-for="(model, i) in modelDistribution"
            :key="i"
            class="model-item"
          >
            <div class="model-name">{{ model.modelName }}</div>
            <div class="model-bar-track">
              <div
                class="model-bar-fill"
                :style="{ width: `${(model.calls / modelDistribution[0].calls) * 100}%` }"
              ></div>
            </div>
            <div class="model-meta">
              <span>{{ model.calls }} 次</span>
              <span class="model-cost">¥{{ model.cost.toFixed(2) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Task Type Distribution -->
      <div class="chart-section">
        <h4 class="chart-title">📋 任务类型分布</h4>
        <div v-if="taskDistribution.length === 0" class="empty-chart">
          暂无任务数据
        </div>
        <div v-else class="task-tags">
          <div
            v-for="(task, i) in taskDistribution"
            :key="i"
            class="task-tag"
            :style="{ opacity: 0.5 + (task.calls / taskDistribution[0].calls) * 0.5 }"
          >
            <span class="task-name">{{ task.taskType }}</span>
            <span class="task-count">{{ task.calls }}</span>
          </div>
        </div>
      </div>

      <!-- Current Project Stats -->
      <div class="chart-section">
        <h4 class="chart-title">📂 当前项目统计</h4>
        <div class="project-stats-grid">
          <div class="proj-stat">
            <div class="proj-stat-value">{{ projectStats?.docCount ?? 0 }}</div>
            <div class="proj-stat-label">知识库文献</div>
          </div>
          <div class="proj-stat">
            <div class="proj-stat-value">{{ projectStats?.conversationCount ?? 0 }}</div>
            <div class="proj-stat-label">对话次数</div>
          </div>
          <div class="proj-stat">
            <div class="proj-stat-value">{{ projectStats?.todoCount ?? 0 }}</div>
            <div class="proj-stat-label">待办事项</div>
          </div>
          <div class="proj-stat">
            <div class="proj-stat-value">{{ readingStats?.totalDurationMinutes ?? 0 }}m</div>
            <div class="proj-stat-label">阅读时长</div>
          </div>
          <div class="proj-stat">
            <div class="proj-stat-value">{{ readingStats?.documentsRead ?? 0 }}</div>
            <div class="proj-stat-label">已读文献</div>
          </div>
          <div class="proj-stat">
            <div class="proj-stat-value">{{ readingStats?.totalSessions ?? 0 }}</div>
            <div class="proj-stat-label">阅读会话</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-panel {
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
  flex-shrink: 0;
}

.sidebar-title {
  font-family: 'Syne', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  color: #f0f0f5;
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
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.8);
}

.time-range-bar {
  display: flex;
  gap: 0.25rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}

.range-btn {
  padding: 0.3rem 0.75rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  color: rgba(240, 240, 245, 0.5);
  font-size: 0.75rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.range-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.range-btn.active {
  background: rgba(0, 229, 204, 0.15);
  border-color: rgba(0, 229, 204, 0.3);
  color: #00e5cc;
}

.project-filter-bar {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  flex-shrink: 0;
}

.project-filter-bar label {
  font-size: 0.75rem;
  color: rgba(240, 240, 245, 0.5);
}

.project-select {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  padding: 0.3rem 0.5rem;
  color: rgba(240, 240, 245, 0.7);
  font-size: 0.75rem;
  cursor: pointer;
  outline: none;
}

.project-select:focus {
  border-color: rgba(0, 229, 204, 0.3);
}

.loading-state,
.error-state {
  text-align: center;
  padding: 3rem 1rem;
  color: rgba(240, 240, 245, 0.4);
  font-size: 0.85rem;
}

.error-state {
  color: #ef4444;
}

.dashboard-content {
  flex: 1;
  overflow-y: auto;
  padding: 0.75rem;
}

/* Summary Cards */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.summary-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 0.75rem;
  text-align: center;
}

.card-icon {
  font-size: 1.25rem;
  margin-bottom: 0.25rem;
}

.card-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: #f0f0f5;
  font-family: 'JetBrains Mono', monospace;
}

.card-label {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.4);
  margin-top: 0.15rem;
}

/* Chart Sections */
.chart-section {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 10px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
}

.chart-section.half {
  flex: 1;
  min-width: 0;
}

.chart-title {
  margin: 0 0 0.5rem;
  font-size: 0.78rem;
  font-weight: 600;
  color: rgba(240, 240, 245, 0.7);
}

.empty-chart {
  text-align: center;
  padding: 1.5rem;
  color: rgba(240, 240, 245, 0.25);
  font-size: 0.75rem;
}

/* Trend Chart */
.trend-chart {
  display: flex;
  align-items: flex-end;
  gap: 0.15rem;
  height: 80px;
  padding-bottom: 1.2rem;
  position: relative;
}

.trend-bar-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  position: relative;
}

.trend-bar {
  width: 100%;
  background: linear-gradient(to top, rgba(0, 229, 204, 0.4), rgba(0, 229, 204, 0.15));
  border-radius: 2px 2px 0 0;
  min-height: 2px;
  transition: height 0.3s ease;
}

.trend-label {
  position: absolute;
  bottom: -1.1rem;
  font-size: 0.55rem;
  color: rgba(240, 240, 245, 0.3);
  white-space: nowrap;
  transform: rotate(-30deg);
  transform-origin: top left;
}

/* Heatmap */
.heatmap {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 0.15rem;
}

.heatmap-cell {
  aspect-ratio: 1;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.04);
  transition: transform 0.15s ease;
}

.heatmap-cell:hover {
  transform: scale(1.2);
}

.intensity-1 { background: rgba(0, 229, 204, 0.2); }
.intensity-2 { background: rgba(0, 229, 204, 0.4); }
.intensity-3 { background: rgba(0, 229, 204, 0.6); }
.intensity-4 { background: rgba(0, 229, 204, 0.85); }

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  margin-top: 0.5rem;
  font-size: 0.65rem;
  color: rgba(240, 240, 245, 0.35);
}

.legend-cell {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}

/* Charts Row */
.charts-row {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

/* Pie Chart */
.pie-chart {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.pie-visual {
  width: 70px;
  height: 70px;
  flex-shrink: 0;
}

.pie-svg {
  width: 100%;
  height: 100%;
}

.pie-legend {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.72rem;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-name {
  color: rgba(240, 240, 245, 0.6);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.legend-pct {
  color: rgba(240, 240, 245, 0.35);
  font-family: 'JetBrains Mono', monospace;
}

/* Bar Chart */
.bar-chart {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.bar-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.bar-label {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.55);
  width: 70px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bar-track {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(61, 116, 231, 0.6), rgba(61, 116, 231, 0.9));
  border-radius: 3px;
  transition: width 0.5s ease;
}

.bar-value {
  font-size: 0.7rem;
  color: rgba(240, 240, 245, 0.4);
  width: 24px;
  text-align: right;
  font-family: 'JetBrains Mono', monospace;
}

/* Model List */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.model-name {
  font-size: 0.72rem;
  color: rgba(240, 240, 245, 0.6);
  width: 90px;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-bar-track {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}

.model-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, rgba(0, 229, 204, 0.5), rgba(0, 229, 204, 0.8));
  border-radius: 3px;
  transition: width 0.5s ease;
}

.model-meta {
  display: flex;
  gap: 0.4rem;
  font-size: 0.65rem;
  color: rgba(240, 240, 245, 0.35);
  width: 70px;
  justify-content: flex-end;
}

.model-cost {
  color: rgba(0, 229, 204, 0.6);
  font-family: 'JetBrains Mono', monospace;
}

/* Task Tags */
.task-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.task-tag {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.3rem 0.6rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  font-size: 0.72rem;
}

.task-name {
  color: rgba(240, 240, 245, 0.7);
}

.task-count {
  color: rgba(240, 240, 245, 0.4);
  font-family: 'JetBrains Mono', monospace;
}

/* Project Stats Grid */
.project-stats-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.proj-stat {
  text-align: center;
  padding: 0.5rem;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.proj-stat-value {
  font-size: 0.95rem;
  font-weight: 700;
  color: #f0f0f5;
  font-family: 'JetBrains Mono', monospace;
}

.proj-stat-label {
  font-size: 0.65rem;
  color: rgba(240, 240, 245, 0.4);
  margin-top: 0.1rem;
}
</style>
