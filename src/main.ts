import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { MotionPlugin } from '@vueuse/motion';
import App from './App.vue';
import './style.css';
import { initDatabase, migrateFromLocalStorage } from './composables/useDatabase';
import { useSettingsStore } from './stores/settings';
import { useHistoryStore } from './stores/history';
import { useProjectStore } from './stores/projects';

async function bootstrap() {
  const app = createApp(App);
  const pinia = createPinia();

  app.use(pinia);
  app.use(MotionPlugin);

  // Initialize SQLite schema and migrate legacy localStorage data
  try {
    await initDatabase();
    await migrateFromLocalStorage();
  } catch (e) {
    console.error('[Bootstrap] Database initialization failed:', e);
  }

  // Initialize stores with persisted data
  const settingsStore = useSettingsStore();
  const historyStore = useHistoryStore();
  const projectStore = useProjectStore();

  await settingsStore.init();
  await projectStore.init();
  await historyStore.init();

  app.mount('#app');
}

bootstrap();
