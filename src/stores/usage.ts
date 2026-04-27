import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getUsageStats, type UsageStats } from '../composables/useDatabase';

export const useUsageStore = defineStore('usage', () => {
  const stats = ref<UsageStats | null>(null);
  const loading = ref(false);

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;

  const todayStats = computed(() => stats.value);

  const hasData = computed(() => (stats.value?.totalCalls || 0) > 0);

  const loadStats = async (period: 'today' | 'week' | 'month') => {
    loading.value = true;
    try {
      const since = period === 'today'
        ? now - dayMs
        : period === 'week'
          ? now - 7 * dayMs
          : now - 30 * dayMs;
      stats.value = await getUsageStats(since);
    } catch (e) {
      console.error('Failed to load usage stats:', e);
      stats.value = null;
    } finally {
      loading.value = false;
    }
  };

  return {
    stats,
    loading,
    todayStats,
    hasData,
    loadStats
  };
});
