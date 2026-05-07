<script setup lang="ts">
import { onMounted, ref } from 'vue';
import WidgetWindow from './windows/WidgetWindow.vue';
import MainWindow from './windows/MainWindow.vue';
import PopupWindow from './windows/PopupWindow.vue';
import CaptureWindow from './windows/CaptureWindow.vue';
import ResultWindow from './windows/ResultWindow.vue';
import SentinelBriefWindow from './windows/SentinelBriefWindow.vue';
import ExperimentSnapshotWindow from './windows/ExperimentSnapshotWindow.vue';
import ReviewWizardWindow from './windows/ReviewWizardWindow.vue';

const windowType = ref<string>('widget');

onMounted(() => {
  const params = new URLSearchParams(window.location.search);
  windowType.value = params.get('window') || 'widget';
});
</script>

<template>
  <div class="app-container">
    <WidgetWindow v-if="windowType === 'widget'" />
    <MainWindow v-else-if="windowType === 'main'" />
    <PopupWindow v-else-if="windowType === 'popup'" />
    <CaptureWindow v-else-if="windowType === 'capture'" />
    <ResultWindow v-else-if="windowType === 'result'" />
    <SentinelBriefWindow v-else-if="windowType === 'sentinel_brief'" />
    <ExperimentSnapshotWindow v-else-if="windowType === 'experiment_snapshot'" />
    <ReviewWizardWindow v-else-if="windowType === 'review_wizard'" />
    <ExperimentSnapshotWindow v-else-if="windowType === 'experiment_snapshot'" />
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
