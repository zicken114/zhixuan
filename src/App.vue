<script setup lang="ts">
import { ref } from 'vue';
import WidgetWindow from './windows/WidgetWindow.vue';
import MainWindow from './windows/MainWindow.vue';
import PopupWindow from './windows/PopupWindow.vue';
import CaptureWindow from './windows/CaptureWindow.vue';
import ResultWindow from './windows/ResultWindow.vue';
import HistoryWindow from './windows/HistoryWindow.vue';

const params = new URLSearchParams(window.location.search);
const windowType = ref<string>(params.get('window') || 'widget');
</script>

<template>
  <div class="app-container">
    <WidgetWindow v-if="windowType === 'widget'" />
    <MainWindow v-else-if="windowType === 'main'" />
    <PopupWindow v-else-if="windowType === 'popup'" />
    <CaptureWindow v-else-if="windowType === 'capture'" />
    <ResultWindow v-else-if="windowType === 'result'" />
    <HistoryWindow v-else-if="windowType === 'history'" />
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
