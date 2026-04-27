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
  background: rgba(7, 7, 13, 0.7);
  backdrop-filter: blur(4px);
}

.processing-box {
  background: rgba(13, 13, 20, 0.95);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(0, 229, 204, 0.15);
  border-radius: 16px;
  padding: 28px 36px;
  max-width: 620px;
  width: 80%;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 229, 204, 0.1);
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(0, 229, 204, 0.15);
  border-top-color: #00e5cc;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 18px;
  box-shadow: 0 0 15px rgba(0, 229, 204, 0.3);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.processing-text {
  color: white;
  font-size: 14px;
  text-align: center;
}

.processing-text span:first-child {
  display: block;
  margin-bottom: 14px;
  color: rgba(240, 240, 245, 0.6);
  font-size: 13px;
  letter-spacing: 0.02em;
}

.processing-stream {
  display: block;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  color: #e2e8f0;
  background: rgba(0, 0, 0, 0.3);
  padding: 18px;
  border-radius: 10px;
  min-height: 90px;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.05);
  line-height: 1.6;
}

.processing-stream::-webkit-scrollbar {
  width: 4px;
}

.processing-stream::-webkit-scrollbar-thumb {
  background: rgba(0, 229, 204, 0.3);
  border-radius: 2px;
}
</style>
