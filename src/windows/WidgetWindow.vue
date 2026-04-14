<script setup lang="ts">
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { invoke } from '@tauri-apps/api/core';

const appWindow = getCurrentWebviewWindow();

let isMouseDown = false;
let mouseDownX = 0;
let mouseDownY = 0;
let hasDragged = false;
let clickTimeout: number | null = null;

const handleMouseDown = (e: MouseEvent) => {
  isMouseDown = true;
  hasDragged = false;
  mouseDownX = e.screenX;
  mouseDownY = e.screenY;
};

const handleMouseMove = async (e: MouseEvent) => {
  if (!isMouseDown) return;

  const dx = Math.abs(e.screenX - mouseDownX);
  const dy = Math.abs(e.screenY - mouseDownY);

  // Start native drag after small movement threshold
  if (!hasDragged && (dx > 5 || dy > 5)) {
    hasDragged = true;
    await appWindow.startDragging();
  }
};

const handleMouseUp = (e: MouseEvent) => {
  if (!isMouseDown) return;
  isMouseDown = false;

  const dx = Math.abs(e.screenX - mouseDownX);
  const dy = Math.abs(e.screenY - mouseDownY);
  const wasClick = !hasDragged && dx < 5 && dy < 5;

  if (wasClick) {
    if (e.button === 0) {
      // Left click - show popup menu after a short delay to distinguish from drag
      clickTimeout = window.setTimeout(() => {
        showPopup();
      }, 50);
    } else if (e.button === 2) {
      // Right click - show main window with settings
      if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
      }
      showMainWindowWithSettings();
    }
  }
};

const showPopup = async () => {
  try {
    await invoke('show_popup_with_clipboard');
  } catch (error) {
    console.error('Failed to show popup:', error);
  }
};

const showMainWindowWithSettings = async () => {
  try {
    await invoke('show_window', { label: 'main' });
  } catch (error) {
    console.error('Failed to show main window:', error);
  }
};

const handleContextMenu = (e: MouseEvent) => {
  e.preventDefault();
};
</script>

<template>
  <div
    class="widget-container"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @contextmenu="handleContextMenu"
  >
    <div class="widget-ball"></div>
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
}

.widget-ball {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background-image: url('../assets/icon.jpg');
  background-size: cover;
  background-position: center;
  pointer-events: none;
}
</style>
