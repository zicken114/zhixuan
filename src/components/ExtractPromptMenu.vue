<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue';

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
  // The bottom edge of the selection box (used as a fallback flip anchor).
  selectionBottom?: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  select: [prompt: ExtractionPrompt];
  cancel: [];
}>();

const menuRef = ref<HTMLDivElement | null>(null);
const menuWidth = ref(0);
const menuHeight = ref(0);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 0);
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 0);

const EDGE_MARGIN = 8;

const measure = () => {
  if (!menuRef.value) return;
  menuWidth.value = menuRef.value.offsetWidth;
  menuHeight.value = menuRef.value.offsetHeight;
};

const onResize = () => {
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
};

onMounted(async () => {
  await nextTick();
  measure();
  window.addEventListener('resize', onResize);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
});

// Re-measure when prompts change (rare, but keeps layout robust).
watch(
  () => props.prompts.length,
  async () => {
    await nextTick();
    measure();
  }
);

const adjustedPosition = computed(() => {
  // Until we've measured the menu, render off-screen (invisible) so the
  // user never sees the menu flash at the unbounded position.
  if (menuWidth.value === 0 || menuHeight.value === 0) {
    return { left: -9999, top: -9999, visible: false };
  }

  const vw = viewportWidth.value;
  const vh = viewportHeight.value;

  let left = props.left;
  let top = props.top;

  // Horizontal: clamp inside viewport with EDGE_MARGIN padding.
  const maxLeft = vw - menuWidth.value - EDGE_MARGIN;
  if (left > maxLeft) left = maxLeft;
  if (left < EDGE_MARGIN) left = EDGE_MARGIN;

  // Vertical: if the menu would overflow below the viewport, flip above
  // the selection. Otherwise clamp to keep it on-screen.
  const overflowsBottom = top + menuHeight.value + EDGE_MARGIN > vh;
  if (overflowsBottom) {
    const selectionBottom = props.selectionBottom ?? props.top;
    // Place 10px above the selection's top edge (selectionTop = selectionBottom - 10
    // because the parent already added +10 for spacing).
    const flippedTop = selectionBottom - 10 - menuHeight.value - 10;
    if (flippedTop >= EDGE_MARGIN) {
      top = flippedTop;
    } else {
      // Selection is tall enough that neither below nor above fits — clamp.
      top = Math.max(EDGE_MARGIN, vh - menuHeight.value - EDGE_MARGIN);
    }
  }

  if (top < EDGE_MARGIN) top = EDGE_MARGIN;

  return { left, top, visible: true };
});
</script>

<template>
  <div
    ref="menuRef"
    class="prompt-menu"
    :style="{
      left: `${adjustedPosition.left}px`,
      top: `${adjustedPosition.top}px`,
      visibility: adjustedPosition.visible ? 'visible' : 'hidden',
    }"
  >
    <div class="prompt-menu-title">选择提取类型</div>
    <button
      v-for="p in prompts"
      :key="p.label"
      class="prompt-item"
      @mousedown.stop
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
