<script setup lang="ts">
export interface ExtractionPrompt {
  label: string;
  icon: string;
  prompt: string;
  format: 'latex' | 'markdown' | 'text' | 'html';
}

interface Props {
  prompts: ExtractionPrompt[];
  left: number;
  top: number;
}

defineProps<Props>();

const emit = defineEmits<{
  select: [prompt: ExtractionPrompt];
  cancel: [];
}>();
</script>

<template>
  <div class="prompt-menu" :style="{ left: `${left}px`, top: `${top}px` }">
    <div class="prompt-menu-title">选择提取类型</div>
    <button
      v-for="p in prompts"
      :key="p.label"
      class="prompt-item"
      @click.stop="emit('select', p)"
    >
      <span class="prompt-icon">{{ p.icon }}</span>
      <span class="prompt-label">{{ p.label }}</span>
    </button>
    <button class="prompt-cancel" @mousedown.stop @click.stop="emit('cancel')">取消</button>
  </div>
</template>

<style scoped>
.prompt-menu {
  position: absolute;
  background: var(--bg-elevated);
  backdrop-filter: blur(16px);
  border: 1px solid var(--border-light);
  border-radius: 14px;
  padding: 10px;
  z-index: 30;
  min-width: 220px;
  box-shadow: var(--shadow-lg);
}

.prompt-menu-title {
  color: var(--text-muted);
  font-size: 10px;
  padding: 6px 10px 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-weight: 600;
}

.prompt-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 14px;
  background: transparent;
  border: none;
  border-radius: 10px;
  color: var(--text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 14px;
}

.prompt-item:hover {
  background: var(--accent-subtle);
  color: var(--text-primary);
}

.prompt-item:hover .prompt-icon {
  transform: scale(1.1);
}

.prompt-icon {
  font-size: 18px;
  transition: transform 0.15s ease;
}

.prompt-label {
  flex: 1;
  text-align: left;
  font-weight: 500;
}

.prompt-cancel {
  width: 100%;
  padding: 10px;
  margin-top: 6px;
  background: transparent;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}

.prompt-cancel:hover {
  background: rgba(234, 67, 53, 0.1);
  border-color: rgba(234, 67, 53, 0.3);
  color: var(--error);
}
</style>
