<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from '../composables/useI18n';

const { t } = useI18n();

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
      :placeholder="t('chatInput.placeholder')"
      class="input-field"
      :disabled="isStreaming"
      @keyup.enter="canSend && emit('send')"
    />
    <button
      v-if="isStreaming"
      class="send-btn stop-btn"
      @click="emit('stop')"
    >
      {{ t('chatInput.stop') }}
    </button>
    <button
      v-else
      class="send-btn"
      :disabled="!canSend"
      @click="emit('send')"
    >
      {{ t('chatInput.send') }}
    </button>
  </div>
</template>

<style scoped>
.input-container {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-subtle);
  display: flex;
  gap: 0.75rem;
  background: var(--bg-surface);
}

.input-field {
  flex: 1;
  background: var(--bg-input);
  border: 1px solid var(--border-light);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  color: var(--text-primary);
  outline: none;
  transition: all 0.2s ease;
  font-size: 0.9rem;
}

.input-field:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(26, 115, 232, 0.1);
}

.input-field:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-field::placeholder {
  color: var(--text-muted);
}

.send-btn {
  background: var(--accent);
  border: none;
  border-radius: 10px;
  padding: 0.75rem 1.5rem;
  color: var(--text-on-accent);
  cursor: pointer;
  font-weight: 600;
  font-size: 0.875rem;
  transition: all 0.2s ease;
  min-width: 80px;
  box-shadow: 0 2px 10px rgba(26, 115, 232, 0.2);
}

.send-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 15px rgba(26, 115, 232, 0.3);
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
  background: var(--error);
  color: var(--text-on-accent);
  box-shadow: 0 2px 10px rgba(234, 67, 53, 0.25);
}

.stop-btn:hover {
  box-shadow: 0 4px 15px rgba(234, 67, 53, 0.35);
  transform: translateY(-1px);
}
</style>
