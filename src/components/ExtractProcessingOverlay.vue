<script setup lang="ts">
interface Props {
  icon: string;
  label: string;
  streamText: string;
}

defineProps<Props>();
</script>

<template>
  <div class="processing-overlay">
    <div class="processing-box">
      <div class="spinner"></div>
      <div class="processing-text">
        <span>{{ icon }} {{ label }}</span>
        <span class="processing-stream">{{ streamText }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.processing-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 40;
  background: var(--bg-overlay);
  backdrop-filter: blur(4px);
}

.processing-box {
  background: var(--bg-elevated);
  backdrop-filter: blur(20px);
  border: 1px solid var(--accent-border);
  border-radius: 16px;
  padding: 28px 36px;
  max-width: 620px;
  width: 80%;
  box-shadow: var(--shadow-xl);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--accent-border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 18px;
  box-shadow: 0 0 15px rgba(26, 115, 232, 0.3);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.processing-text {
  color: var(--text-primary);
  font-size: 14px;
  text-align: center;
}

.processing-text span:first-child {
  display: block;
  margin-bottom: 14px;
  color: var(--text-secondary);
  font-size: 13px;
  letter-spacing: 0.02em;
}

.processing-stream {
  display: block;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: var(--text-primary);
  background: var(--bg-surface);
  padding: 18px;
  border-radius: 10px;
  min-height: 90px;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid var(--border-subtle);
  line-height: 1.6;
}

.processing-stream::-webkit-scrollbar {
  width: 4px;
}

.processing-stream::-webkit-scrollbar-thumb {
  background: var(--accent-border);
  border-radius: 2px;
}
</style>
