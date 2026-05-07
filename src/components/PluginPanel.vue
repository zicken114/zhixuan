<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const emit = defineEmits<{
  close: [];
}>();

interface RegistryPlugin {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  category: string;
  permissions: string[];
  download_url: string;
  icon_url?: string;
  rating: number;
  install_count: number;
}

interface PluginDef {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  permissions: string[];
  enabled: boolean;
  manifest: Record<string, any>;
  source_url?: string;
  install_path?: string;
  created_at: number;
  updated_at: number;
}

const activeTab = ref<'installed' | 'discover'>('installed');
const installedPlugins = ref<PluginDef[]>([]);
const registryPlugins = ref<RegistryPlugin[]>([]);
const selectedCategory = ref<string>('all');
const loading = ref(false);
const installLoading = ref<string | null>(null);

const categories = computed(() => {
  const cats = new Set(registryPlugins.value.map(p => p.category));
  return ['all', ...Array.from(cats)];
});

const filteredRegistry = computed(() => {
  if (selectedCategory.value === 'all') return registryPlugins.value;
  return registryPlugins.value.filter(p => p.category === selectedCategory.value);
});

async function loadInstalled() {
  try {
    const plugins = await invoke<PluginDef[]>('list_plugins', { enabledOnly: false });
    installedPlugins.value = plugins;
  } catch (e) {
    console.error('Failed to load installed plugins:', e);
  }
}

async function loadRegistry() {
  loading.value = true;
  try {
    const plugins = await invoke<RegistryPlugin[]>('get_plugin_registry');
    registryPlugins.value = plugins;
  } catch (e) {
    console.error('Failed to load plugin registry:', e);
  } finally {
    loading.value = false;
  }
}

async function installPlugin(id: string) {
  installLoading.value = id;
  try {
    await invoke('install_plugin', { registryId: id });
    await loadInstalled();
    alert('Plugin installed successfully');
  } catch (e) {
    alert('Installation failed: ' + e);
  } finally {
    installLoading.value = null;
  }
}

async function togglePlugin(plugin: PluginDef) {
  try {
    await invoke('toggle_plugin', { id: plugin.id, enabled: !plugin.enabled });
    plugin.enabled = !plugin.enabled;
  } catch (e) {
    console.error('Failed to toggle plugin:', e);
  }
}

async function uninstallPlugin(id: string) {
  if (!confirm('Uninstall this plugin?')) return;
  try {
    await invoke('uninstall_plugin', { id });
    await loadInstalled();
  } catch (e) {
    alert('Uninstall failed: ' + e);
  }
}

function isInstalled(pluginId: string): boolean {
  return installedPlugins.value.some(p => p.id === pluginId);
}

function formatPermission(p: string): string {
  const map: Record<string, string> = {
    clipboard: 'Clipboard',
    network: 'Network',
    result_window: 'Result Window',
    local_storage: 'Local Storage',
    file_system: 'File System',
  };
  return map[p] || p;
}

onMounted(() => {
  loadInstalled();
  loadRegistry();
});
</script>

<template>
  <div class="plugin-panel">
    <div class="panel-header">
      <h3>Plugins</h3>
      <button class="close-btn" @click="emit('close')">&times;</button>
    </div>

    <div class="tab-bar">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'installed' }"
        @click="activeTab = 'installed'"
      >
        Installed
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'discover' }"
        @click="activeTab = 'discover'"
      >
        Discover
      </button>
    </div>

    <!-- Installed Tab -->
    <div v-if="activeTab === 'installed'" class="tab-content">
      <div v-if="installedPlugins.length === 0" class="empty-state">
        <p>No plugins installed yet.</p>
        <button class="action-link" @click="activeTab = 'discover'">
          Browse marketplace &rarr;
        </button>
      </div>

      <div v-else class="plugin-list">
        <div
          v-for="plugin in installedPlugins"
          :key="plugin.id"
          class="plugin-card"
          :class="{ disabled: !plugin.enabled }"
        >
          <div class="plugin-card-header">
            <div class="plugin-info">
              <h4>{{ plugin.name }}</h4>
              <span class="version">v{{ plugin.version }}</span>
            </div>
            <label class="toggle-switch">
              <input
                type="checkbox"
                :checked="plugin.enabled"
                @change="togglePlugin(plugin)"
              />
              <span class="slider"></span>
            </label>
          </div>
          <p class="plugin-desc">{{ plugin.description }}</p>
          <div class="plugin-meta">
            <span class="author">by {{ plugin.author }}</span>
            <div class="permissions">
              <span
                v-for="perm in plugin.permissions"
                :key="perm"
                class="perm-tag"
              >
                {{ formatPermission(perm) }}
              </span>
            </div>
          </div>
          <button class="uninstall-btn" @click="uninstallPlugin(plugin.id)">
            Uninstall
          </button>
        </div>
      </div>
    </div>

    <!-- Discover Tab -->
    <div v-else class="tab-content">
      <div class="category-filter">
        <button
          v-for="cat in categories"
          :key="cat"
          class="category-chip"
          :class="{ active: selectedCategory === cat }"
          @click="selectedCategory = cat"
        >
          {{ cat === 'all' ? 'All' : cat }}
        </button>
      </div>

      <div v-if="loading" class="loading">Loading marketplace...</div>

      <div v-else class="plugin-list">
        <div
          v-for="plugin in filteredRegistry"
          :key="plugin.id"
          class="plugin-card marketplace"
        >
          <div class="plugin-card-header">
            <div class="plugin-info">
              <h4>{{ plugin.name }}</h4>
              <span class="version">v{{ plugin.version }}</span>
            </div>
            <div class="rating">
              <span class="stars">{{ '★'.repeat(Math.floor(plugin.rating)) }}</span>
              <span class="count">({{ plugin.install_count }})</span>
            </div>
          </div>
          <p class="plugin-desc">{{ plugin.description }}</p>
          <div class="plugin-meta">
            <span class="author">by {{ plugin.author }}</span>
            <span class="category-badge">{{ plugin.category }}</span>
          </div>
          <div class="permissions">
            <span
              v-for="perm in plugin.permissions"
              :key="perm"
              class="perm-tag"
            >
              {{ formatPermission(perm) }}
            </span>
          </div>
          <button
            class="install-btn"
            :disabled="isInstalled(plugin.id) || installLoading === plugin.id"
            @click="installPlugin(plugin.id)"
          >
            {{ isInstalled(plugin.id) ? 'Installed' : installLoading === plugin.id ? 'Installing...' : 'Install' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-panel {
  position: fixed;
  top: 0;
  left: 0;
  width: 320px;
  height: 100vh;
  background: #0d0d14;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  flex-direction: column;
  z-index: 100;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-header h3 {
  font-family: 'Syne', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  color: #f0f0f5;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  color: rgba(240, 240, 245, 0.5);
  font-size: 1.5rem;
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
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.tab-bar {
  display: flex;
  gap: 0.25rem;
  padding: 0.75rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.tab-btn {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.6);
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: all 0.2s ease;
}

.tab-btn.active {
  background: rgba(0, 229, 204, 0.1);
  border-color: rgba(0, 229, 204, 0.3);
  color: #00e5cc;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 1rem;
}

.empty-state {
  text-align: center;
  padding: 3rem 1rem;
  color: rgba(240, 240, 245, 0.4);
}

.empty-state p {
  margin-bottom: 1rem;
}

.action-link {
  background: none;
  border: none;
  color: #00e5cc;
  cursor: pointer;
  font-size: 0.9rem;
  text-decoration: underline;
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.plugin-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  padding: 1rem;
  transition: all 0.2s ease;
}

.plugin-card.disabled {
  opacity: 0.6;
}

.plugin-card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.5rem;
}

.plugin-info h4 {
  font-size: 0.95rem;
  font-weight: 600;
  color: #f0f0f5;
  margin: 0 0 0.25rem 0;
}

.version {
  font-size: 0.75rem;
  color: rgba(240, 240, 245, 0.4);
}

.plugin-desc {
  font-size: 0.85rem;
  color: rgba(240, 240, 245, 0.6);
  margin: 0 0 0.75rem 0;
  line-height: 1.5;
}

.plugin-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.author {
  font-size: 0.8rem;
  color: rgba(240, 240, 245, 0.4);
}

.category-badge {
  font-size: 0.75rem;
  background: rgba(0, 229, 204, 0.1);
  color: #00e5cc;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}

.permissions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.75rem;
}

.perm-tag {
  font-size: 0.75rem;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(240, 240, 245, 0.5);
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
}

.toggle-switch {
  position: relative;
  width: 40px;
  height: 22px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 22px;
  transition: 0.2s;
}

.slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background: rgba(240, 240, 245, 0.7);
  border-radius: 50%;
  transition: 0.2s;
}

.toggle-switch input:checked + .slider {
  background: rgba(0, 229, 204, 0.3);
}

.toggle-switch input:checked + .slider::before {
  transform: translateX(18px);
  background: #00e5cc;
}

.install-btn,
.uninstall-btn {
  width: 100%;
  padding: 0.5rem;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid transparent;
}

.install-btn {
  background: rgba(0, 229, 204, 0.1);
  border-color: rgba(0, 229, 204, 0.3);
  color: #00e5cc;
}

.install-btn:hover:not(:disabled) {
  background: rgba(0, 229, 204, 0.2);
}

.install-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.uninstall-btn {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.uninstall-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

.rating {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.8rem;
}

.stars {
  color: #fbbf24;
}

.count {
  color: rgba(240, 240, 245, 0.4);
}

.category-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 1rem;
}

.category-chip {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: rgba(240, 240, 245, 0.6);
  padding: 0.3rem 0.75rem;
  border-radius: 20px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s ease;
}

.category-chip.active {
  background: rgba(0, 229, 204, 0.1);
  border-color: rgba(0, 229, 204, 0.3);
  color: #00e5cc;
}

.loading {
  text-align: center;
  padding: 2rem;
  color: rgba(240, 240, 245, 0.4);
}
</style>
