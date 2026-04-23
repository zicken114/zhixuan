<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient, type ChatMessage } from '../utils/aiClient';
import { usePopupHistoryStore } from '../stores/popupHistory';

const historyStore = usePopupHistoryStore();

interface ScreenshotPayload {
  image: string;  // Base64 PNG
  width: number;
  height: number;
  x: number;
  y: number;
}

interface ExtractionPrompt {
  label: string;
  icon: string;
  prompt: string;
  format: 'latex' | 'markdown' | 'text' | 'html';
}

// Screenshot state
const screenshotData = ref<ScreenshotPayload | null>(null);
const backgroundImage = ref<string>('');
const originalImageWidth = ref(0);
const originalImageHeight = ref(0);

// Selection state
const isSelecting = ref(false);
const startX = ref(0);
const startY = ref(0);
const endX = ref(0);
const endY = ref(0);
const hasSelected = ref(false);

// Processing state
const isProcessing = ref(false);
const processingResult = ref<string>('');
const showResult = ref(false);

// Prompt options
const extractionPrompts: ExtractionPrompt[] = [
  { label: '提取公式为 LaTeX', icon: '📐', prompt: '请将图片中的数学公式完整提取为 LaTeX 代码，只返回 LaTeX 代码，不要任何解释或markdown代码块标记。', format: 'latex' },
  { label: '提取表格为 Markdown', icon: '📊', prompt: '请将图片中的表格完整提取为 Markdown 格式的表格代码，只返回 Markdown 代码，不要任何解释或markdown代码块标记。', format: 'markdown' },
  { label: '提取为纯文本', icon: '📝', prompt: '请将图片中的所有文字内容完整提取为纯文本，只返回文本内容，不要任何解释。', format: 'text' },
  { label: '提取伪代码/流程', icon: '🔣', prompt: '请将图片中的伪代码、算法流程图或流程描述提取为清晰的步骤说明，返回结构化的文本描述。', format: 'text' },
];

const selectedPrompt = ref<ExtractionPrompt | null>(null);

let unlisten: UnlistenFn | null = null;

// Create thumbnail from base64 image
const createThumbnail = (base64: string, maxSize: number = 100): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => resolve(base64);
    img.src = `data:image/png;base64,${base64}`;
  });
};

// Save screenshot extraction to history
const saveScreenshotToHistory = async (
  label: string,
  content: string,
  actionType: string
) => {
  if (!screenshotData.value) return;

  try {
    // Create thumbnail
    const thumbnail = await createThumbnail(screenshotData.value.image, 150);

    // Determine action type from label
    let type = actionType;
    if (label.includes('LaTeX') || label.includes('公式')) type = 'extract-latex';
    else if (label.includes('表格')) type = 'extract-table';
    else if (label.includes('纯文本') || label.includes('文字')) type = 'extract-text';

    historyStore.addItem({
      actionType: type as any,
      actionLabel: label,
      inputText: '[截图内容]',
      inputImage: thumbnail, // Store thumbnail
      outputText: content
    });

    await invoke('notify_history_changed');
    console.log('[Capture] Screenshot history saved');
  } catch (e) {
    console.error('[Capture] Failed to save screenshot history:', e);
  }
};

onMounted(async () => {
  // Listen for screenshot from Rust
  unlisten = await listen<ScreenshotPayload>('screenshot-ready', (event) => {
    console.log('Screenshot received:', event.payload.width, 'x', event.payload.height);
    screenshotData.value = event.payload;
    originalImageWidth.value = event.payload.width;
    originalImageHeight.value = event.payload.height;
    backgroundImage.value = `data:image/png;base64,${event.payload.image}`;
    console.log('Background image set, length:', event.payload.image.length);
    console.log('Original image dimensions:', originalImageWidth.value, 'x', originalImageHeight.value);
    // Reset all states for new capture
    isSelecting.value = false;
    hasSelected.value = false;
    isProcessing.value = false;
    showResult.value = false;
    processingResult.value = '';
    selectedPrompt.value = null;
  });

  window.addEventListener('error', (e) => {
    console.error('Window error:', e);
  });
});

onUnmounted(() => {
  if (unlisten) {
    unlisten();
  }
});

// Mouse event handlers
const handleMouseDown = (e: MouseEvent) => {
  if (e.button !== 0) return; // Only left click

  // Check if clicking on UI elements (not background)
  const target = e.target as HTMLElement;
  if (target.closest('.prompt-menu') || target.closest('.processing-overlay') || target.closest('.result-overlay')) {
    return; // Don't start selection when clicking on UI elements
  }

  isSelecting.value = true;
  startX.value = e.clientX;
  startY.value = e.clientY;
  endX.value = e.clientX;
  endY.value = e.clientY;
  hasSelected.value = false;
  showResult.value = false;
};

const handleMouseMove = (e: MouseEvent) => {
  if (!isSelecting.value) return;
  endX.value = e.clientX;
  endY.value = e.clientY;
};

const handleMouseUp = async () => {
  if (!isSelecting.value) return;
  isSelecting.value = false;
  hasSelected.value = true;

  const width = Math.abs(endX.value - startX.value);
  const height = Math.abs(endY.value - startY.value);

  // Minimum selection size
  if (width < 10 || height < 10) {
    hasSelected.value = false;
    return;
  }
};

const handleKeyDown = async (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    // Cancel and hide capture window
    await invoke('hide_capture_window');
  } else if (e.key === 'Enter' && hasSelected.value) {
    // Auto-select first prompt option
    await extractWithPrompt(extractionPrompts[0]);
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown);
});

// Selection box computed style
const selectionBox = computed(() => {
  const x = Math.min(startX.value, endX.value);
  const y = Math.min(startY.value, endY.value);
  const width = Math.abs(endX.value - startX.value);
  const height = Math.abs(endY.value - startY.value);

  return {
    left: `${x}px`,
    top: `${y}px`,
    width: `${width}px`,
    height: `${height}px`,
    display: (isSelecting.value || hasSelected.value) && width > 0 && height > 0 ? 'block' : 'none'
  };
});

// Selection dimensions for display
const selectionInfo = computed(() => {
  const x = Math.min(startX.value, endX.value);
  const y = Math.min(startY.value, endY.value);
  const width = Math.abs(endX.value - startX.value);
  const height = Math.abs(endY.value - startY.value);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
});

// Extract selected region using canvas and call Vision AI
const extractWithPrompt = async (prompt: ExtractionPrompt) => {
  if (!hasSelected.value) return;

  // Immediately hide capture window and open result window
  console.log('[CaptureWindow] hiding capture window and showing result window');
  await invoke('hide_capture_window');
  await invoke('show_result_window');
  console.log('[CaptureWindow] result window should now be visible');
  // Wait for result window to be fully mounted and listeners ready
  await invoke('wait_for_result_window_ready');
  console.log('[CaptureWindow] result window is ready');

  // Viewport coordinates (what the user selected on screen)
  const viewX = Math.min(startX.value, endX.value);
  const viewY = Math.min(startY.value, endY.value);
  const viewWidth = Math.abs(endX.value - startX.value);
  const viewHeight = Math.abs(endY.value - startY.value);

  // Get viewport dimensions
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Get original image dimensions
  const imgWidth = originalImageWidth.value;
  const imgHeight = originalImageHeight.value;

  console.log('[Crop Debug] Viewport:', viewportWidth, 'x', viewportHeight);
  console.log('[Crop Debug] Original image:', imgWidth, 'x', imgHeight);
  console.log('[Crop Debug] Selection (viewport):', viewX, viewY, viewWidth, viewHeight);

  // Calculate how image was scaled and offset with object-fit: cover
  const imgAspect = imgWidth / imgHeight;
  const viewAspect = viewportWidth / viewportHeight;

  let displayWidth: number, displayHeight: number, offsetX: number, offsetY: number;

  if (imgAspect > viewAspect) {
    // Image is wider - scale by height, then crop width
    displayHeight = viewportHeight;
    displayWidth = displayHeight * imgAspect;
    offsetX = (displayWidth - viewportWidth) / 2;
    offsetY = 0;
  } else {
    // Image is taller - scale by width, then crop height
    displayWidth = viewportWidth;
    displayHeight = displayWidth / imgAspect;
    offsetX = 0;
    offsetY = (displayHeight - viewportHeight) / 2;
  }

  console.log('[Crop Debug] Displayed image:', displayWidth, 'x', displayHeight, 'offset:', offsetX, offsetY);

  // Scale factors from viewport to original image
  const scaleX = imgWidth / displayWidth;
  const scaleY = imgHeight / displayHeight;

  // Convert viewport coordinates to image coordinates
  const imgX = Math.round((viewX + offsetX) * scaleX);
  const imgY = Math.round((viewY + offsetY) * scaleY);
  const imgWidthScaled = Math.round(viewWidth * scaleX);
  const imgHeightScaled = Math.round(viewHeight * scaleY);

  console.log('[Crop Debug] Crop region (image coords):', imgX, imgY, imgWidthScaled, imgHeightScaled);

  isProcessing.value = true;
  selectedPrompt.value = prompt;
  showResult.value = false;

  try {
    // Create canvas to crop the image
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        canvas.width = imgWidthScaled;
        canvas.height = imgHeightScaled;
        ctx.drawImage(img, imgX, imgY, imgWidthScaled, imgHeightScaled, 0, 0, imgWidthScaled, imgHeightScaled);
        console.log('[Crop Debug] Canvas drew region:', imgX, imgY, imgWidthScaled, imgHeightScaled);
        resolve();
      };
      img.onerror = reject;
      img.src = backgroundImage.value;
    });

    // Get cropped image as base64
    const croppedImage = canvas.toDataURL('image/png').split(',')[1];

    // Call Vision AI
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt.prompt },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${croppedImage}` } }
        ]
      }
    ];

    let fullResponse = '';

    // Use vision model for image-based chat
    await aiClient.chatStream(messages, {
      onToken: (token) => {
        fullResponse += token;
        processingResult.value = fullResponse;
        invoke('emit_to_result', { content: fullResponse }).catch(() => {});
      },
      onComplete: async () => {
        isProcessing.value = false;
        showResult.value = true;

        // Determine clipboard text based on format
        let clipboardText = fullResponse;
        if (prompt.format === 'latex' || prompt.format === 'markdown') {
          // Remove markdown code block markers if present
          clipboardText = fullResponse
            .replace(/^```(?:latex|markdown)?\n?/i, '')
            .replace(/\n?```$/, '')
            .trim();
        } else {
          clipboardText = fullResponse.trim();
        }

        // Write to clipboard based on format
        if (prompt.format === 'latex') {
          await invoke('set_clipboard_text', { text: clipboardText });
        } else if (prompt.format === 'markdown') {
          const htmlResult = convertMarkdownToHtml(clipboardText);
          try {
            await invoke('set_clipboard_html', { html: htmlResult });
          } catch {
            await invoke('set_clipboard_text', { text: clipboardText });
          }
        } else {
          await invoke('set_clipboard_text', { text: clipboardText });
        }

        // Emit complete to result window
        await invoke('emit_extraction_complete', {
          icon: prompt.icon,
          label: prompt.label,
          content: clipboardText
        });

        // Save to history
        await saveScreenshotToHistory(prompt.label, clipboardText, '');
      },
      onError: (error) => {
        isProcessing.value = false;
        processingResult.value = `错误: ${error}`;
        showResult.value = true;
        // Emit error to result window
        invoke('emit_extraction_error', { error: String(error) }).catch(() => {});
      }
    }, true);

  } catch (error) {
    isProcessing.value = false;
    processingResult.value = `错误: ${error}`;
    showResult.value = true;
    await invoke('emit_extraction_error', { error: String(error) });
  }
};

// Simple markdown to HTML converter
const convertMarkdownToHtml = (md: string): string => {
  let html = md;

  // Headers
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Line breaks
  html = html.replace(/\n/g, '<br>');

  return html;
};

// Cancel selection
const cancelSelection = async () => {
  console.log('cancelSelection called');
  hasSelected.value = false;
  isSelecting.value = false;
  showResult.value = false;
  processingResult.value = '';
  selectedPrompt.value = null;
  // Use hideCapture which has fallback
  await hideCapture();
};

// Hide capture window
const hideCapture = async () => {
  console.log('hideCapture called');
  try {
    await invoke('hide_capture_window');
  } catch (e) {
    console.error('Failed to hide capture window:', e);
  }
};
</script>

<template>
  <div
    class="capture-window"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
  >
    <!-- Background screenshot -->
    <img
      v-if="backgroundImage"
      :src="backgroundImage"
      class="background-image"
      alt="Screenshot"
    />

    <!-- Semi-transparent overlay -->
    <div class="overlay"></div>

    <!-- Selection box -->
    <div
      v-if="selectionBox.display !== 'none'"
      class="selection-box"
      :style="selectionBox"
    >
      <div class="selection-info">
        {{ selectionInfo.width }} × {{ selectionInfo.height }}
      </div>
    </div>

    <!-- Instructions (before selection) -->
    <div v-if="!hasSelected && !isProcessing" class="instructions">
      <p class="text-white text-sm">拖动选择区域 • 按 ESC 取消</p>
    </div>

    <!-- Prompt menu (after selection) -->
    <div
      v-if="hasSelected && !isProcessing && !showResult"
      class="prompt-menu"
      :style="{
        left: `${Math.min(startX, endX)}px`,
        top: `${Math.max(startY, endY) + 10}px`
      }"
    >
      <div class="prompt-menu-title">选择提取类型</div>
      <button
        v-for="p in extractionPrompts"
        :key="p.label"
        class="prompt-item"
        @click.stop="extractWithPrompt(p)"
      >
        <span class="prompt-icon">{{ p.icon }}</span>
        <span class="prompt-label">{{ p.label }}</span>
      </button>
      <button class="prompt-cancel" @mousedown.stop @click.stop="cancelSelection">取消</button>
    </div>

    <!-- Processing indicator -->
    <div v-if="isProcessing" class="processing-overlay">
      <div class="processing-box">
        <div class="spinner"></div>
        <div class="processing-text">
          <span>{{ selectedPrompt?.icon }} {{ selectedPrompt?.label }}</span>
          <span class="processing-stream">{{ processingResult }}</span>
        </div>
      </div>
    </div>

    <!-- Result display -->
    <div v-if="showResult" class="result-overlay">
      <div class="result-box">
        <div class="result-header">
          <span>{{ selectedPrompt?.icon }}</span>
          <span>{{ selectedPrompt?.label }}</span>
          <button class="result-close" @click="hideCapture">关闭</button>
        </div>
        <div class="result-content">
          <pre>{{ processingResult }}</pre>
        </div>
        <div class="result-footer">
          已复制到剪贴板，可直接粘贴
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.capture-window {
  width: 100vw;
  height: 100vh;
  position: relative;
  cursor: crosshair;
  overflow: hidden;
}

.background-image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(7, 7, 13, 0.4);
  z-index: 1;
}

.selection-box {
  position: absolute;
  border: 2px solid #00e5cc;
  background: rgba(0, 229, 204, 0.1);
  z-index: 10;
  box-shadow: 0 0 0 9999px rgba(7, 7, 13, 0.5);
  transition: border-color 0.15s ease;
}

.selection-box::before {
  content: '';
  position: absolute;
  inset: -4px;
  border: 1px solid rgba(0, 229, 204, 0.3);
  border-radius: 4px;
  pointer-events: none;
}

.selection-info {
  position: absolute;
  bottom: -28px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(13, 13, 20, 0.95);
  color: #00e5cc;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 6px;
  white-space: nowrap;
  font-family: 'JetBrains Mono', monospace;
  border: 1px solid rgba(0, 229, 204, 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.instructions {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(13, 13, 20, 0.9);
  backdrop-filter: blur(12px);
  padding: 12px 24px;
  border-radius: 10px;
  z-index: 20;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.instructions p {
  font-size: 0.8rem;
  color: rgba(240, 240, 245, 0.6);
  letter-spacing: 0.03em;
}

.prompt-menu {
  position: absolute;
  background: rgba(13, 13, 20, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 10px;
  z-index: 30;
  min-width: 220px;
  box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(0, 229, 204, 0.1);
}

.prompt-menu-title {
  color: rgba(240, 240, 245, 0.4);
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
  color: rgba(240, 240, 245, 0.8);
  cursor: pointer;
  transition: all 0.15s ease;
  font-size: 14px;
}

.prompt-item:hover {
  background: rgba(0, 229, 204, 0.12);
  color: #f0f0f5;
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
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(240, 240, 245, 0.5);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}

.prompt-cancel:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

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
