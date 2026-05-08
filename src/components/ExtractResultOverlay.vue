<script setup lang="ts">
interface Props {
  icon: string;
  label: string;
  result: string;
}

defineProps<Props>();

const emit = defineEmits<{
  close: [];
}>();
</script>

<template>
  <div class="result-overlay">
    <div class="result-box">
      <div class="result-header">
        <span>{{ icon }}</span>
        <span>{{ label }}</span>
        <button class="result-close" @click="emit('close')">关闭</button>
      </div>
      <div class="result-content">
        <pre>{{ result }}</pre>
      </div>
      <div class="result-footer">
        已复制到剪贴板，可直接粘贴
      </div>
    </div>
  </div>
</template>

<style scoped>
.result-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  background: var(--bg-overlay);
  backdrop-filter: blur(6px);
}

.result-box {
  background: var(--bg-elevated);
  backdrop-filter: blur(20px);
  border: 1px solid var(--accent-border);
  border-radius: 18px;
  max-width: 720px;
  width: 88%;
  max-height: 82vh;
  overflow: hidden;
  box-shadow: var(--shadow-xl);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px;
  border-bottom: 1px solid var(--border-subtle);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  background: var(--accent-subtle);
}

.result-close {
  margin-left: auto;
  padding: 6px 14px;
  background: var(--accent-subtle);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.result-close:hover {
  background: var(--accent-border);
  border-color: var(--accent);
}

.result-content {
  padding: 22px;
  max-height: 420px;
  overflow-y: auto;
}

.result-content pre {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.65;
  margin: 0;
  background: var(--bg-surface);
  padding: 16px;
  border-radius: 10px;
  border: 1px solid var(--border-subtle);
}

.result-footer {
  padding: 14px 22px;
  border-top: 1px solid var(--border-subtle);
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
  background: var(--accent-subtle);
  letter-spacing: 0.02em;
}
</style>
