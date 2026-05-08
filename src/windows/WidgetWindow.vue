<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { useWindow } from '../composables/useWindow';
import { startReadingSession, endReadingSession, getDocumentProgress, recordPage } from '../composables/useReadingSession';
import { getCurrentPdfPath, estimatePdfPage } from '../composables/usePdfDetection';
import { hasExtractableContent as checkExtractableContent } from '../composables/useContentDetection';
import { extractPdfText } from '../utils/pdfExtractor';
import { countUnreadSentinelPapers } from '../composables/useDatabase';

type DockSide = 'left' | 'right' | null;
type AppContext = 'writing' | 'pdf_reader' | 'code_editor' | 'browser' | 'zotero' | 'unknown';

interface WidgetDockState {
  side: 'left' | 'right' | 'none';
  x: number;
  y: number;
}

interface WindowInfoPayload {
  process_name: string;
  window_title: string;
  app_type: string;
}

interface ReadingSessionStartPayload {
  document_title: string;
  document_path?: string;
  process_name?: string;
}

const appWindow = getCurrentWebviewWindow();
const { showPopup: showPopupMenu, show, resize, showSentinelBrief, snapWidget: snapWidgetToBounds, setWidgetDefaultPosition, center } = useWindow();

const collapsedOffset = 44;
const collapseDelayMs = 1200;
const expandedSize = 60;
const collapsedWidth = 14;
const collapsedHeight = 46;

const dockSide = ref<DockSide>(null);
const isExpanded = ref(true);
const appContext = ref<AppContext>('unknown');
const contextTooltip = ref('');
const hasExtractableContent = ref(false);
const currentWindowTitle = ref('');
const sentinelUnreadCount = ref(0);
const showSentinelBanner = ref(false);

interface ResumeInfo {
  lastPage: number | null;
  totalDurationMinutes: number;
  pagesRead: number;
}
const resumeInfo = ref<ResumeInfo | null>(null);

let isMouseDown = false;
let mouseDownX = 0;
let mouseDownY = 0;
let hasDragged = false;
let clickTimeout: number | null = null;
let moveSettleTimeout: number | null = null;
let collapseDelayTimeout: number | null = null;
let suppressSingleClick = false;
let unlistenMoved: (() => void) | null = null;
let unlistenWindowActivity: (() => void) | null = null;
let unlistenSessionStart: (() => void) | null = null;
let unlistenSessionEnd: (() => void) | null = null;
let unlistenSentinelPapers: (() => void) | null = null;
let pdfCheckInterval: number | null = null;
let lastCheckedPdfPath: string | null = null;
let cachedPdfData: Uint8Array | null = null;

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

const contextClass = computed(() => {
  switch (appContext.value) {
    case 'writing': return 'context-writing';
    case 'pdf_reader': return 'context-pdf';
    case 'code_editor': return 'context-code';
    case 'browser': return 'context-browser';
    case 'zotero': return 'context-zotero';
    default: return '';
  }
});

const contextLabel = computed(() => {
  switch (appContext.value) {
    case 'writing': return 'Writing';
    case 'pdf_reader': return 'Reading';
    case 'code_editor': return 'Coding';
    case 'browser': return 'Browsing';
    case 'zotero': return 'Zotero';
    default: return '';
  }
});

/* ── PDF extractable-content detection (Phase 3.2 breathing ring) ── */

const clearPdfCheck = () => {
  if (pdfCheckInterval) {
    clearInterval(pdfCheckInterval);
    pdfCheckInterval = null;
  }
  hasExtractableContent.value = false;
  lastCheckedPdfPath = null;
  cachedPdfData = null;
};

const checkPdfExtractableContent = async () => {
  if (appContext.value !== 'pdf_reader' || !currentWindowTitle.value) return;

  try {
    const page = await estimatePdfPage(currentWindowTitle.value);
    if (!page) return;

    // Track page changes for reading session (Phase 3.3)
    recordPage(page).catch(() => {});

    const pdfPath = await getCurrentPdfPath();
    if (!pdfPath) return;

    // Re-read PDF only if path changed
    if (pdfPath !== lastCheckedPdfPath || !cachedPdfData) {
      cachedPdfData = await readFile(pdfPath);
      lastCheckedPdfPath = pdfPath;
    }

    const result = await extractPdfText(cachedPdfData!, pdfPath);
    const pageData = result.pages.find(p => p.pageNumber === page);
    if (!pageData || !pageData.text) {
      hasExtractableContent.value = false;
      return;
    }

    const extractable = await checkExtractableContent(pageData.text);
    hasExtractableContent.value = extractable;
  } catch (e) {
    // Silently fail — breathing ring is best-effort
    hasExtractableContent.value = false;
  }
};

watch(appContext, (newCtx, oldCtx) => {
  if (newCtx === 'pdf_reader') {
    // Start periodic content detection (every 15 seconds)
    if (!pdfCheckInterval) {
      checkPdfExtractableContent(); // immediate first check
      pdfCheckInterval = window.setInterval(checkPdfExtractableContent, 15000);
    }
  } else if (oldCtx === 'pdf_reader') {
    clearPdfCheck();
  }
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

const refreshUnread = async () => {
  try {
    const count = await countUnreadSentinelPapers();
    sentinelUnreadCount.value = count;
  } catch (e) {
    // Silent fail
  }
};

const showPopup = async () => {
  // Refresh sentinel count on user interaction
  refreshUnread();
  try {
    await showPopupMenu();
  } catch (error) {
    console.error('Failed to show popup:', error);
  }
};

const showMainWindow = async () => {
  // Refresh sentinel count on user interaction
  refreshUnread();
  try {
    await resize('main', 860, 800).catch(() => {});
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
  await center('main');
  await resize('main', 560, 800).catch(() => {});
  await show('main');

  unlistenMoved = await appWindow.onMoved(() => {
    scheduleDockSync();
  });

  // Listen for window activity changes to update context
  unlistenWindowActivity = await listen<WindowInfoPayload>('window:activity-changed', (event) => {
    const appType = event.payload.app_type;
    appContext.value = appType as AppContext;
    currentWindowTitle.value = event.payload.window_title;
    contextTooltip.value = `${event.payload.window_title} (${event.payload.process_name})`;
  });

  // Listen for reading session lifecycle events from Rust (Phase 3.3)
  unlistenSessionStart = await listen<ReadingSessionStartPayload>('reading:session-start', async (event) => {
    const { document_title, document_path } = event.payload;

    // Check if there's past progress for this document (Phase 3.3 — resume hint)
    const progress = await getDocumentProgress(document_title);
    if (progress.pagesRead > 0) {
      resumeInfo.value = {
        lastPage: progress.lastPage,
        totalDurationMinutes: progress.totalDurationMinutes,
        pagesRead: progress.pagesRead
      };
    } else {
      resumeInfo.value = null;
    }

    startReadingSession(document_title, document_path || undefined).catch((e) => {
      console.error('[Widget] Failed to start reading session:', e);
    });
  });

  unlistenSessionEnd = await listen('reading:session-end', () => {
    endReadingSession().catch((e) => {
      console.error('[Widget] Failed to end reading session:', e);
    });
    resumeInfo.value = null;
  });

  // Listen for new sentinel papers (Phase 4.1)
  unlistenSentinelPapers = await listen<{ count: number }>('sentinel:new-papers', (event) => {
    sentinelUnreadCount.value += event.payload.count;
    showSentinelBanner.value = true;
    // Auto-hide banner after 5 seconds
    window.setTimeout(() => {
      showSentinelBanner.value = false;
    }, 5000);
  });

  // Initial load of unread count
  refreshUnread();
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

  if (unlistenWindowActivity) {
    unlistenWindowActivity();
  }

  if (unlistenSessionStart) {
    unlistenSessionStart();
  }

  if (unlistenSessionEnd) {
    unlistenSessionEnd();
  }
  if (unlistenSentinelPapers) {
    unlistenSentinelPapers();
  }
  clearPdfCheck();
});
</script>

<template>
  <div
    class="widget-container"
    :class="{
      'is-docked': dockSide,
      'is-collapsed': dockSide && !isExpanded,
      'has-extractable': hasExtractableContent,
      [contextClass]: true
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
      <div v-if="contextLabel" class="context-badge">{{ contextLabel }}</div>
      <!-- Sentinel notification dot (Phase 4.1) -->
      <div v-if="sentinelUnreadCount > 0" class="sentinel-dot">{{ sentinelUnreadCount }}</div>
      <!-- Breathing light ring -->
      <div v-if="appContext === 'pdf_reader'" class="breathing-ring"></div>
    </div>
    <!-- Sentinel new papers banner -->
    <div v-if="showSentinelBanner && sentinelUnreadCount > 0" class="sentinel-banner" @click="showSentinelBrief()">
      本周有 {{ sentinelUnreadCount }} 篇新文献
    </div>
    <div v-if="contextTooltip" class="context-tooltip">{{ contextTooltip }}</div>
    <!-- Resume reading hint (Phase 3.3) -->
    <div v-if="appContext === 'pdf_reader' && resumeInfo" class="resume-hint">
      <span class="resume-label">上次读到</span>
      <span class="resume-page">P{{ resumeInfo.lastPage ?? '?' }}</span>
      <span class="resume-detail">{{ resumeInfo.pagesRead }}页 · {{ resumeInfo.totalDurationMinutes }}分钟</span>
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
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: var(--bg-base);
  box-shadow: var(--shadow-md);
  border: 1.5px solid var(--border-light);
  transition:
    width var(--transition-widget),
    height var(--transition-widget),
    transform var(--transition-slow),
    border-radius var(--transition-slow),
    box-shadow var(--transition-base),
    filter var(--transition-slow),
    background var(--transition-slow);
  cursor: pointer;
}

.widget-shell:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-1px);
}

.widget-shell:active {
  transform: translateY(0) scale(0.96);
}

.widget-core {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: url('/cat-icon.png') center/cover no-repeat;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  font-weight: 700;
  font-family: var(--font-display);
  transition:
    opacity var(--transition-base),
    transform var(--transition-slow);
}

.widget-tab {
  position: absolute;
  inset: 6px 3px;
  border-radius: 10px;
  background: var(--accent);
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
  background: var(--text-on-accent);
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
}

.widget-container.is-collapsed .widget-tab {
  opacity: 1;
}

/* Context-aware subtle border effects */
.widget-container.context-writing .widget-shell {
  border-color: var(--accent-border);
}

.widget-container.context-pdf .widget-shell {
  border-color: var(--accent-border);
}

.widget-container.context-code .widget-shell {
  border-color: rgba(251, 188, 4, 0.4);
}

.widget-container.context-browser .widget-shell {
  border-color: rgba(139, 92, 246, 0.4);
}

.widget-container.context-zotero .widget-shell {
  border-color: rgba(234, 67, 53, 0.4);
}

/* Context badge */
.context-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: var(--accent);
  color: var(--text-on-accent);
  pointer-events: none;
  white-space: nowrap;
}

.context-pdf .context-badge {
  background: var(--accent);
  color: var(--text-on-accent);
}

.context-code .context-badge {
  background: var(--warning);
  color: var(--text-on-accent);
}

.context-browser .context-badge {
  background: var(--accent);
  color: var(--text-on-accent);
}

.context-zotero .context-badge {
  background: var(--error);
  color: var(--text-on-accent);
}

/* Context tooltip */
.context-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-base);
  box-shadow: var(--shadow-lg);
}

.widget-container:hover .context-tooltip {
  opacity: 1;
}

/* Breathing light ring for PDF reading companion — updated to subtle ring */
.breathing-ring {
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  border: 1.5px solid transparent;
  pointer-events: none;
  animation: breathe 3s ease-in-out infinite;
}

@keyframes breathe {
  0%, 100% {
    border-color: rgba(26, 115, 232, 0.15);
    transform: scale(1);
  }
  50% {
    border-color: rgba(26, 115, 232, 0.35);
    transform: scale(1.03);
  }
}

/* Enhanced breathing when extractable content detected */
.widget-container.has-extractable .breathing-ring {
  animation: breathe-intense 2s ease-in-out infinite;
}

@keyframes breathe-intense {
  0%, 100% {
    border-color: rgba(26, 115, 232, 0.3);
    transform: scale(1);
  }
  50% {
    border-color: rgba(26, 115, 232, 0.6);
    transform: scale(1.05);
  }
}

/* Docked state: adjust breathing ring shape */
.widget-container.is-collapsed .breathing-ring {
  border-radius: var(--radius-md);
  inset: -2px;
}

/* Resume reading hint (Phase 3.3) */
.resume-hint {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transition: opacity var(--transition-base);
  box-shadow: var(--shadow-lg);
  display: flex;
  align-items: center;
  gap: 6px;
}

.widget-container:hover .resume-hint {
  opacity: 1;
}

.resume-hint .resume-label {
  color: var(--text-muted);
  font-size: 10px;
}

.resume-hint .resume-page {
  font-weight: 700;
  color: var(--accent);
  font-size: 12px;
}

.resume-hint .resume-detail {
  color: var(--text-muted);
  font-size: 10px;
}

/* Sentinel notification dot (Phase 4.1) */
.sentinel-dot {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--error);
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* Sentinel banner */
.sentinel-banner {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 6px 14px;
  background: var(--bg-elevated);
  border: 1px solid rgba(234, 67, 53, 0.2);
  border-radius: var(--radius-md);
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  animation: banner-in 0.3s ease forwards, banner-out 0.3s ease 4.7s forwards;
  box-shadow: var(--shadow-lg);
}

@keyframes banner-in {
  from { opacity: 0; transform: translateX(-50%) translateY(-4px); }
  to { opacity: 1; transform: translateX(-50%) translateY(0); }
}

@keyframes banner-out {
  from { opacity: 1; transform: translateX(-50%) translateY(0); }
  to { opacity: 0; transform: translateX(-50%) translateY(-4px); }
}
</style>
