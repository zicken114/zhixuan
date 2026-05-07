<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient, type ChatMessage } from '../utils/aiClient';
import { useClipboard } from '../composables/useClipboard';
import { useWindow } from '../composables/useWindow';
import { recordEvent } from '../composables/useEvents';
import { useScreenshotSelection } from '../composables/useScreenshotSelection';
import ExtractPromptMenu from '../components/ExtractPromptMenu.vue';
import ExtractProcessingOverlay from '../components/ExtractProcessingOverlay.vue';
import ExtractResultOverlay from '../components/ExtractResultOverlay.vue';
import type { ExtractionPrompt } from '../components/ExtractPromptMenu.vue';

interface ScreenshotPayload {
  image: string;  // Base64 PNG
  width: number;
  height: number;
  x: number;
  y: number;
}

const { writeText, writeHtml } = useClipboard();
const { hideCapture, showResult: showResultWindow, waitForResultReady } = useWindow();
const {
  hasSelected,
  startX,
  startY,
  endX,
  endY,
  handleMouseDown: onSelectionMouseDown,
  handleMouseMove: onSelectionMouseMove,
  handleMouseUp: onSelectionMouseUp,
  resetSelection,
  selectionBox,
  selectionInfo,
  cropSelection
} = useScreenshotSelection();

// Screenshot state
const screenshotData = ref<ScreenshotPayload | null>(null);
const backgroundImage = ref<string>('');
const originalImageWidth = ref(0);
const originalImageHeight = ref(0);

// Processing state
const isProcessing = ref(false);
const processingResult = ref('');
const showResult = ref(false);
const selectedPrompt = ref<ExtractionPrompt | null>(null);

const extractionPrompts: ExtractionPrompt[] = [
  { label: '提取公式为 LaTeX', icon: '📐', prompt: '请将图片中的数学公式完整提取为 LaTeX 代码，只返回 LaTeX 代码，不要任何解释或markdown代码块标记。', format: 'latex' },
  { label: '提取表格为 Markdown', icon: '📊', prompt: '请将图片中的表格完整提取为 Markdown 格式的表格代码，只返回 Markdown 代码，不要任何解释或markdown代码块标记。', format: 'markdown' },
  { label: '提取为纯文本', icon: '📝', prompt: '请将图片中的所有文字内容完整提取为纯文本，只返回文本内容，不要任何解释。', format: 'text' },
  { label: '提取伪代码/流程', icon: '🔣', prompt: '请将图片中的伪代码、算法流程图或流程描述提取为清晰的步骤说明，返回结构化的文本描述。', format: 'text' },
];

const presetHint = ref<string>('');
let presetPromptIndex = -1;

let unlisten: UnlistenFn | null = null;

onMounted(async () => {
  unlisten = await listen<ScreenshotPayload>('screenshot-ready', (event) => {
    screenshotData.value = event.payload;
    originalImageWidth.value = event.payload.width;
    originalImageHeight.value = event.payload.height;
    backgroundImage.value = `data:image/png;base64,${event.payload.image}`;
    resetSelection();
    isProcessing.value = false;
    showResult.value = false;
    processingResult.value = '';
    selectedPrompt.value = null;
    presetHint.value = '';
    presetPromptIndex = -1;
  });

  window.addEventListener('error', (e) => {
    console.error('Window error:', e);
  });

  window.addEventListener('keydown', handleKeyDown);

  // Listen for preset triggers from reading-companion hotkeys (F2=formula, F3=table)
  listen<string>('capture:preset', (event) => {
    if (event.payload === 'formula') {
      presetHint.value = '阅读助手：拖拽选择公式区域，按 Enter 提取为 LaTeX';
      presetPromptIndex = 0; // LaTeX extraction
    } else if (event.payload === 'table') {
      presetHint.value = '阅读助手：拖拽选择表格区域，按 Enter 提取为 Markdown';
      presetPromptIndex = 1; // Markdown table extraction
    }
  });
});

onUnmounted(() => {
  if (unlisten) unlisten();
  window.removeEventListener('keydown', handleKeyDown);
});

const handleMouseDown = (e: MouseEvent) => {
  const didStart = onSelectionMouseDown(e, '.prompt-menu, .processing-overlay, .result-overlay');
  if (didStart) {
    showResult.value = false;
  }
};

const handleMouseMove = (e: MouseEvent) => {
  onSelectionMouseMove(e);
};

const handleMouseUp = () => {
  onSelectionMouseUp();
};

const handleKeyDown = async (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    await hideCapture();
  } else if (e.key === 'Enter' && hasSelected) {
    const promptIndex = presetPromptIndex >= 0 ? presetPromptIndex : 0;
    await extractWithPrompt(extractionPrompts[promptIndex]);
  }
};

const extractWithPrompt = async (prompt: ExtractionPrompt) => {
  if (!hasSelected || !screenshotData.value) return;

  await hideCapture();
  await showResultWindow();
  await waitForResultReady();

  isProcessing.value = true;
  selectedPrompt.value = prompt;
  showResult.value = false;
  processingResult.value = '';

  const ocrStartTime = performance.now();
  recordEvent({
    event_type: 'capture_ocr_start',
    metadata: { format: prompt.format, label: prompt.label }
  });

  try {
    const croppedDataUrl = await cropSelection(
      backgroundImage.value,
      originalImageWidth.value,
      originalImageHeight.value
    );
    const croppedImage = croppedDataUrl.split(',')[1];

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

    await aiClient.chatStream(messages, {
      onToken: (token) => {
        fullResponse += token;
        processingResult.value = fullResponse;
        invoke('emit_to_result', { content: fullResponse }).catch(() => {});
      },
      onComplete: async () => {
        isProcessing.value = false;
        showResult.value = true;

        let clipboardText = fullResponse;
        if (prompt.format === 'latex' || prompt.format === 'markdown') {
          clipboardText = fullResponse
            .replace(/^```(?:latex|markdown)?\n?/i, '')
            .replace(/\n?```$/, '')
            .trim();
        } else {
          clipboardText = fullResponse.trim();
        }

        if (prompt.format === 'markdown') {
          const { marked } = await import('marked');
          const htmlResult = await marked(clipboardText);
          await writeHtml(htmlResult, clipboardText);
        } else {
          await writeText(clipboardText);
        }

        await invoke('emit_extraction_complete', {
          icon: prompt.icon,
          label: prompt.label,
          content: clipboardText
        });

        recordEvent({
          event_type: 'capture_ocr_complete',
          duration_ms: Math.round(performance.now() - ocrStartTime),
          metadata: { format: prompt.format, label: prompt.label, success: true }
        });
      },
      onError: (error) => {
        isProcessing.value = false;
        processingResult.value = `错误: ${error}`;
        showResult.value = true;
        invoke('emit_extraction_error', { error: String(error) }).catch(() => {});

        recordEvent({
          event_type: 'capture_ocr_complete',
          duration_ms: Math.round(performance.now() - ocrStartTime),
          metadata: { format: prompt.format, label: prompt.label, success: false, error: String(error) }
        });
      }
    }, true, 'vision_extraction');

  } catch (error) {
    isProcessing.value = false;
    processingResult.value = `错误: ${error}`;
    showResult.value = true;
    await invoke('emit_extraction_error', { error: String(error) });

    recordEvent({
      event_type: 'capture_ocr_complete',
      duration_ms: Math.round(performance.now() - ocrStartTime),
      metadata: { format: prompt.format, label: prompt.label, success: false, error: String(error) }
    });
  }
};

const cancelSelection = async () => {
  // reset selection state is handled by hideCapture, but we clear flags here too
  resetSelection();
  isProcessing.value = false;
  showResult.value = false;
  processingResult.value = '';
  selectedPrompt.value = null;
  presetHint.value = '';
  presetPromptIndex = -1;
  await hideCapture();
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
      <p class="text-white text-sm">
        <span v-if="presetHint">{{ presetHint }}</span>
        <span v-else>拖动选择区域 • 按 ESC 取消</span>
      </p>
    </div>

    <!-- Prompt menu (after selection) -->
    <ExtractPromptMenu
      v-if="hasSelected && !isProcessing && !showResult"
      :prompts="extractionPrompts"
      :left="Math.min(startX, endX)"
      :top="Math.max(startY, endY) + 10"
      @select="extractWithPrompt"
      @cancel="cancelSelection"
    />

    <!-- Processing indicator -->
    <ExtractProcessingOverlay
      v-if="isProcessing"
      :icon="selectedPrompt?.icon || ''"
      :label="selectedPrompt?.label || ''"
      :stream-text="processingResult"
    />

    <!-- Result display -->
    <ExtractResultOverlay
      v-if="showResult"
      :icon="selectedPrompt?.icon || ''"
      :label="selectedPrompt?.label || ''"
      :result="processingResult"
      @close="hideCapture"
    />
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
</style>
