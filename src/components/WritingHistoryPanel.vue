<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { getWritingEvents, type WritingEvent } from '../composables/useDatabase';
import { useProjectStore } from '../stores/projects';

const projectStore = useProjectStore();
const events = ref<WritingEvent[]>([]);
const loading = ref(false);

const emit = defineEmits<{
  close: [];
}>();

const loadEvents = async () => {
  loading.value = true;
  try {
    events.value = await getWritingEvents(projectStore.currentProjectId, 100);
  } catch (e) {
    console.error('[WritingHistory] Failed to load events:', e);
  } finally {
    loading.value = false;
  }
};

onMounted(loadEvents);
watch(() => projectStore.currentProjectId, loadEvents);

const formatTime = (timestamp: number): string => {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const eventIcon = (type: string): string => {
  switch (type) {
    case 'writing_polish': return '✨';
    case 'citation_recommend': return '📚';
    case 'citation_insert': return '🔖';
    case 'writing_format_fix': return '📐';
    case 'note_save_to_obsidian': return '📝';
    default: return '•';
  }
};

const eventLabel = (type: string): string => {
  switch (type) {
    case 'writing_polish': return '润色';
    case 'citation_recommend': return '引用推荐';
    case 'citation_insert': return '插入引用';
    case 'writing_format_fix': return '格式修正';
    case 'note_save_to_obsidian': return '保存笔记';
    default: return type;
  }
};

const eventDetail = (ev: WritingEvent): string => {
  const m = ev.metadata;
  if (!m) return '';
  if (ev.eventType === 'writing_polish' && m.polish_type) {
    return m.polish_type;
  }
  if (ev.eventType === 'citation_insert' && m.style) {
    return m.style;
  }
  if (ev.eventType === 'writing_format_fix' && m.format_type) {
    return m.format_type;
  }
  if (ev.resourceId) {
    return ev.resourceId.slice(0, 40);
  }
  return '';
};
</script>

<template>
  <div class="writing-history-panel">
    <div class="history-header">
      <span>写作历史</span>
      <button class="close-btn" @click="emit('close')">×</button>
    </div>
    <div class="history-list">
      <div v-if="loading" class="history-empty">加载中...</div>
      <div v-else-if="events.length === 0" class="history-empty">
        暂无写作活动记录
      </div>
      <div
        v-for="ev in events"
        :key="ev.id"
        class="history-item"
      >
        <span class="event-icon">{{ eventIcon(ev.eventType) }}</span>
        <div class="event-body">
          <div class="event-title">
            <span class="event-label">{{ eventLabel(ev.eventType) }}</span>
            <span class="event-time">{{ formatTime(ev.timestamp) }}</span>
          </div>
          <div v-if="eventDetail(ev)" class="event-detail">
            {{ eventDetail(ev) }}
          </div>
          <div v-if="ev.durationMs" class="event-meta">
            耗时 {{ Math.round(ev.durationMs / 1000) }}s
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.writing-history-panel {
  background: rgba(13, 13, 20, 0.98);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  max-height: 320px;
  overflow-y: auto;
}

.history-header {
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

.history-list {
  padding: 0.5rem;
}

.history-item {
  display: flex;
  align-items: flex-start;
  gap: 0.6rem;
  padding: 0.65rem 0.75rem;
  border-radius: 8px;
  cursor: default;
  transition: all 0.15s ease;
  border: 1px solid transparent;
}

.history-item:hover {
  background: rgba(0, 229, 204, 0.04);
  border-color: rgba(0, 229, 204, 0.08);
}

.event-icon {
  font-size: 0.95rem;
  flex-shrink: 0;
  margin-top: 0.05rem;
}

.event-body {
  flex: 1;
  min-width: 0;
}

.event-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.event-label {
  color: rgba(240, 240, 245, 0.8);
  font-size: 0.82rem;
  font-weight: 500;
}

.event-time {
  color: rgba(240, 240, 245, 0.35);
  font-size: 0.7rem;
  font-family: 'JetBrains Mono', monospace;
  flex-shrink: 0;
}

.event-detail {
  color: rgba(240, 240, 245, 0.45);
  font-size: 0.75rem;
  margin-top: 0.15rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.event-meta {
  color: rgba(0, 229, 204, 0.5);
  font-size: 0.7rem;
  margin-top: 0.15rem;
  font-family: 'JetBrains Mono', monospace;
}

.history-empty {
  padding: 2rem;
  text-align: center;
  color: rgba(240, 240, 245, 0.3);
  font-size: 0.875rem;
}
</style>
