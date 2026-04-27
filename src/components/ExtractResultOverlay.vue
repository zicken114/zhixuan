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
  background: rgba(7, 7, 13, 0.75);
  backdrop-filter: blur(6px);
}

.result-box {
  background: rgba(13, 13, 20, 0.98);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 229, 204, 0.2);
  border-radius: 18px;
  max-width: 720px;
  width: 88%;
  max-height: 82vh;
  overflow: hidden;
  box-shadow: 0 12px 50px rgba(0, 0, 0, 0.5), 0 0 40px rgba(0, 229, 204, 0.08);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(240, 240, 245, 0.9);
  font-size: 14px;
  font-weight: 500;
  background: rgba(0, 229, 204, 0.03);
}

.result-close {
  margin-left: auto;
  padding: 6px 14px;
  background: rgba(0, 229, 204, 0.15);
  border: 1px solid rgba(0, 229, 204, 0.25);
  border-radius: 8px;
  color: #00e5cc;
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.result-close:hover {
  background: rgba(0, 229, 204, 0.25);
  border-color: rgba(0, 229, 204, 0.4);
}

.result-content {
  padding: 22px;
  max-height: 420px;
  overflow-y: auto;
}

.result-content pre {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.65;
  margin: 0;
  background: rgba(0, 0, 0, 0.2);
  padding: 16px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.result-footer {
  padding: 14px 22px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  color: rgba(240, 240, 245, 0.45);
  font-size: 12px;
  text-align: center;
  background: rgba(0, 229, 204, 0.05);
  letter-spacing: 0.02em;
}
</style>
