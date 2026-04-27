<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  modelValue: string;
  isStreaming: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: string];
  send: [];
  stop: [];
}>();

const inputText = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
});

const canSend = computed(() => !props.isStreaming && inputText.value.trim().length > 0);
</script>

<template>
  <div class="input-container">
    <input
      v-model="inputText"
      type="text"
      placeholder="Ask me anything..."
      class="input-field"
      :disabled="isStreaming"
      @keyup.enter="canSend && emit('send')"
    />
    <button
      v-if="isStreaming"
      class="send-btn stop-btn"
      @click="emit('stop')"
    >
      Stop
    </button>
    <button
      v-else
      class="send-btn"
      :disabled="!canSend"
      @click="emit('send')"
    >
      Send
    </button>
  </div>
</template>

<style scoped>
.input-container {
  padding: 1rem 1.25rem;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  gap: 0.75rem;
  background: rgba(13, 13, 20, 0.5);
}

.input-field {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  color: #f0f0f5;
  outline: none;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.input-field:focus {
  border-color: rgba(0, 229, 204, 0.5);
  box-shadow: 0 0 0 3px rgba(0, 229, 204, 0.1);
}

.input-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-field::placeholder {
  color: rgba(240, 240, 245, 0.35);
}

.send-btn {
  background: linear-gradient(135deg, #00e5cc 0%, #00b8a3 100%);
  border: none;
  border-radius: 10px;
  padding: 0.75rem 1.5rem;
  color: #07070d;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  min-width: 80px;
  box-shadow: 0 2px 10px rgba(0, 229, 204, 0.2);
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(0, 229, 204, 0.3);
}

.send-btn:active:not(:disabled) {
  transform: translateY(0);
}

.send-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
}

.stop-btn {
  background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(239, 68, 68, 0.25);
}

.stop-btn:hover {
  box-shadow: 0 4px 15px rgba(239, 68, 68, 0.35);
  transform: translateY(-1px);
}
</style>
