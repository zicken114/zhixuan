<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { useWindow } from '../composables/useWindow';

type DockSide = 'left' | 'right' | null;

interface WidgetDockState {
  side: 'left' | 'right' | 'none';
  x: number;
  y: number;
}

const appWindow = getCurrentWebviewWindow();
const { showPopup: showPopupMenu, show, snapWidget: snapWidgetToBounds, setWidgetDefaultPosition, center } = useWindow();

const collapsedOffset = 44;
const collapseDelayMs = 1200;
const expandedSize = 60;
const collapsedWidth = 14;
const collapsedHeight = 46;

const dockSide = ref<DockSide>(null);
const isExpanded = ref(true);

let isMouseDown = false;
let mouseDownX = 0;
let mouseDownY = 0;
let hasDragged = false;
let clickTimeout: number | null = null;
let moveSettleTimeout: number | null = null;
let collapseDelayTimeout: number | null = null;
let suppressSingleClick = false;
let unlistenMoved: (() => void) | null = null;

const widgetShellStyle = computed(() => {
  if (!dockSide.value || isExpanded.value) {
    return {
      width: `${expandedSize}px`,
      height: `${expandedSize}px`,
      transform: 'translateX(0)',
      borderRadius: '50%'
    };
  }

  return {
    width: `${collapsedWidth}px`,
    height: `${collapsedHeight}px`,
    transform: dockSide.value === 'left'
      ? `translateX(-${collapsedOffset}px)`
      : `translateX(${collapsedOffset}px)`,
    borderRadius: dockSide.value === 'left' ? '0 12px 12px 0' : '12px 0 0 12px'
  };
});

const widgetCoreStyle = computed(() => {
  if (!dockSide.value || isExpanded.value) {
    return {
      opacity: 1,
      transform: 'scale(1)'
    };
  }

  return {
    opacity: 0,
    transform: dockSide.value === 'left' ? 'translateX(-8px) scale(0.84)' : 'translateX(8px) scale(0.84)'
  };
});

const syncDockState = async () => {
  const result = await snapWidgetToBounds() as WidgetDockState;
  dockSide.value = result.side === 'none' ? null : result.side;
  isExpanded.value = result.side === 'none';
};

const scheduleDockSync = () => {
  if (moveSettleTimeout) {
    clearTimeout(moveSettleTimeout);
  }

  moveSettleTimeout = window.setTimeout(async () => {
    moveSettleTimeout = null;
    await syncDockState();
  }, 140);
};

const expandDockedWidget = () => {
  if (collapseDelayTimeout) {
    clearTimeout(collapseDelayTimeout);
    collapseDelayTimeout = null;
  }

  if (dockSide.value) {
    isExpanded.value = true;
  }
};

const collapseDockedWidget = () => {
  if (!isMouseDown && dockSide.value) {
    if (collapseDelayTimeout) {
      clearTimeout(collapseDelayTimeout);
    }

    collapseDelayTimeout = window.setTimeout(() => {
      isExpanded.value = false;
      collapseDelayTimeout = null;
    }, collapseDelayMs);
  }
};

const handleMouseDown = (e: MouseEvent) => {
  if (e.button === 0 && e.detail === 2) {
    suppressSingleClick = true;

    if (clickTimeout) {
      clearTimeout(clickTimeout);
      clickTimeout = null;
    }
  }

  expandDockedWidget();
  isMouseDown = true;
  hasDragged = false;
  mouseDownX = e.screenX;
  mouseDownY = e.screenY;
};

const handleMouseMove = async (e: MouseEvent) => {
  if (!isMouseDown) return;

  const dx = Math.abs(e.screenX - mouseDownX);
  const dy = Math.abs(e.screenY - mouseDownY);

  if (!hasDragged && (dx > 5 || dy > 5)) {
    hasDragged = true;
    dockSide.value = null;
    isExpanded.value = true;
    await appWindow.startDragging();
  }
};

const handleMouseUp = (e: MouseEvent) => {
  if (!isMouseDown) return;
  isMouseDown = false;

  const dx = Math.abs(e.screenX - mouseDownX);
  const dy = Math.abs(e.screenY - mouseDownY);
  const wasClick = !hasDragged && dx < 5 && dy < 5;

  if (hasDragged) {
    scheduleDockSync();
    return;
  }

  if (wasClick && e.button === 0 && !suppressSingleClick) {
    clickTimeout = window.setTimeout(() => {
      clickTimeout = null;
      showPopup();
    }, 220);
  }
};

const handleDoubleClick = () => {
  suppressSingleClick = true;

  if (clickTimeout) {
    clearTimeout(clickTimeout);
    clickTimeout = null;
  }

  showMainWindow();

  window.setTimeout(() => {
    suppressSingleClick = false;
  }, 250);
};

const showPopup = async () => {
  try {
    await showPopupMenu();
  } catch (error) {
    console.error('Failed to show popup:', error);
  }
};

const showMainWindow = async () => {
  try {
    await show('main');
  } catch (error) {
    console.error('Failed to show main window:', error);
  }
};

const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault();
};

onMounted(async () => {
  await setWidgetDefaultPosition();
  await appWindow.hide();
  await center('main');
  await show('main');

  unlistenMoved = await appWindow.onMoved(() => {
    scheduleDockSync();
  });
});

onUnmounted(() => {
  if (moveSettleTimeout) {
    clearTimeout(moveSettleTimeout);
  }

  if (collapseDelayTimeout) {
    clearTimeout(collapseDelayTimeout);
  }

  if (unlistenMoved) {
    unlistenMoved();
  }
});
</script>

<template>
  <div
    class="widget-container"
    :class="{
      'is-docked': dockSide,
      'is-collapsed': dockSide && !isExpanded
    }"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @dblclick="handleDoubleClick"
    @mouseenter="expandDockedWidget"
    @mouseleave="collapseDockedWidget"
    @contextmenu="handleContextMenu"
  >
    <div class="widget-shell" :style="widgetShellStyle">
      <div class="widget-tab" :class="{ 'dock-left': dockSide === 'left', 'dock-right': dockSide === 'right' }"></div>
      <div class="widget-core" :style="widgetCoreStyle"></div>
    </div>
  </div>
</template>

<style scoped>
.widget-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: move;
  user-select: none;
  pointer-events: auto;
  background: transparent;
  overflow: hidden;
}

.widget-shell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(18, 24, 33, 0.96) 0%, rgba(11, 15, 22, 0.96) 100%);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-widget);
  transition:
    width var(--transition-widget),
    height var(--transition-widget),
    transform var(--transition-slow),
    border-radius var(--transition-slow),
    box-shadow var(--transition-slow),
    filter var(--transition-slow),
    background var(--transition-slow);
}

.widget-core {
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background-image: url('../assets/icon.jpg');
  background-size: cover;
  background-position: center;
  transition:
    opacity var(--transition-base),
    transform var(--transition-slow);
}

.widget-tab {
  position: absolute;
  inset: 6px 3px;
  border-radius: 10px;
  background:
    linear-gradient(180deg, rgba(0, 229, 204, 0.75) 0%, rgba(61, 116, 231, 0.82) 100%);
  opacity: 0;
  transition: opacity var(--transition-slow);
}

.widget-tab::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 4px;
  height: 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.85);
  transform: translate(-50%, -50%);
}

.widget-tab.dock-left::after {
  transform: translate(-40%, -50%);
}

.widget-tab.dock-right::after {
  transform: translate(-60%, -50%);
}

.widget-container.is-collapsed .widget-shell {
  box-shadow: var(--shadow-sm);
  filter: saturate(0.94);
}

.widget-container.is-collapsed .widget-tab {
  opacity: 1;
}
</style>
