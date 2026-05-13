<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { aiClient, type ChatMessage } from '../utils/aiClient';
import { useClipboard } from '../composables/useClipboard';
import { useWindow } from '../composables/useWindow';
import { recordEvent } from '../composables/useEvents';
import { usePopupHistoryStore } from '../stores/popupHistory';
import { useScreenshotSelection } from '../composables/useScreenshotSelection';
import ExtractPromptMenu from '../components/ExtractPromptMenu.vue';
import ExtractProcessingOverlay from '../components/ExtractProcessingOverlay.vue';
import ExtractResultOverlay from '../components/ExtractResultOverlay.vue';
import type { ExtractionPrompt } from '../components/ExtractPromptMenu.vue';
import type { PopupActionType } from '../stores/popupHistory';

interface ScreenshotPayload {
  image: string;  // Base64 PNG
  width: number;
  height: number;
  x: number;
  y: number;
}

const { writeText, writeHtml } = useClipboard();
const { hideCapture, showResult: showResultWindow, waitForResultReady } = useWindow();
const popupHistoryStore = usePopupHistoryStore();
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
  { label: '硬核图表分析', icon: '📈', prompt: '哥们儿帮我看看这张图，图表里数据走势咋样，有没有啥值得注意的点。用知乎上那种专业但不装的口吻聊聊，别整一堆数字堆砌，直接说人话给结论就行。输出纯文本，不要用星号、井号这些 markdown 符号，也不要用 1.2.3. 列表。', format: 'text' },
  { label: '复杂布局拆解', icon: '🧩', prompt: '这张图信息挺杂的，帮我理一理。看看视觉层级怎么排的，核心论点是什么，支撑材料在哪，广告和背景直接忽略。最后给我一份创作大纲，用自然的中文写出来，不要用 markdown 格式，也不要用 1.2.3. 编号列表，就像跟朋友口述思路一样。', format: 'markdown' },
  { label: '灵感手稿一键转正', icon: '✨', prompt: '这是我随手记的东西，可能写得比较潦草甚至有手写内容。帮我把核心意思抓住，然后扩写成一段知乎风格的开场白，要真诚、有温度，像真人写的而不是 AI 生成的。保持我原来的意图，但把口语化的地方顺一顺。直接输出文字，不要加星号、井号，不要用列表符号。', format: 'text' },
  { label: '梗图解码', icon: '🦊', prompt: '你现在是知乎的刘看山，一只住在北极、偶尔掉毛、爱吃鳕鱼的短尾巴北极狐。看看这张图里有啥好玩的梗或者特别的氛围，用你平时那种调皮呆萌的语气随便吐槽两句，最后丢个颜文字就行。要像真人聊天一样自然，别整得跟说明书似的，不要出现星号、井号这些符号。', format: 'text' },
];

const toHistoryActionType = (prompt: ExtractionPrompt): PopupActionType => {
  if (prompt.label.includes('布局')) return 'extract-table';
  if (prompt.label.includes('图表')) return 'extract-latex';
  return 'extract-text';
};

const presetHint = ref<string>('');
let presetPromptIndex = -1;

let unlisten: UnlistenFn | null = null;
let unlistenNewCapture: UnlistenFn | null = null;
let unlistenPreset: UnlistenFn | null = null;

const resetCaptureUI = () => {
  resetSelection();
  isProcessing.value = false;
  showResult.value = false;
  processingResult.value = '';
  selectedPrompt.value = null;
  presetHint.value = '';
  presetPromptIndex = -1;
};

onMounted(async () => {
  // Fires as soon as a new capture session begins — runs *before* the
  // screenshot itself is ready. Reset selection + UI state immediately so
  // the user can't interact with stale state from a previous extraction.
  unlistenNewCapture = await listen('new-capture-started', () => {
    resetCaptureUI();
  });

  unlisten = await listen<ScreenshotPayload>('screenshot-ready', (event) => {
    screenshotData.value = event.payload;
    originalImageWidth.value = event.payload.width;
    originalImageHeight.value = event.payload.height;
    backgroundImage.value = `data:image/png;base64,${event.payload.image}`;
    // Reset again in case the capture window was shown before
    // 'new-capture-started' was processed.
    resetCaptureUI();
  });

  window.addEventListener('error', (e) => {
    console.error('Window error:', e);
  });

  window.addEventListener('keydown', handleKeyDown);

  // Listen for preset triggers from reading-companion hotkeys (F2=formula, F3=table)
  unlistenPreset = await listen<string>('capture:preset', (event) => {
    if (event.payload === 'formula') {
      presetHint.value = '阅读助手：拖拽选择图表区域，按 Enter 进行图表分析';
      presetPromptIndex = 0; // 图表分析
    } else if (event.payload === 'table') {
      presetHint.value = '阅读助手：拖拽选择布局区域，按 Enter 拆解布局';
      presetPromptIndex = 1; // 布局拆解
    }
  });
});

onUnmounted(() => {
  if (unlisten) unlisten();
  if (unlistenNewCapture) unlistenNewCapture();
  if (unlistenPreset) unlistenPreset();
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

        popupHistoryStore.addItem({
          actionType: toHistoryActionType(prompt),
          actionLabel: prompt.label,
          actionIcon: prompt.icon,
          inputText: '[截图输入]',
          inputImage: croppedImage,
          outputText: clipboardText
        });
        await invoke('notify_history_changed');

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
      :selection-bottom="Math.max(startY, endY)"
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
  background: var(--bg-overlay);
  z-index: 1;
}

.selection-box {
  position: absolute;
  border: 2px solid var(--accent);
  background: rgba(26, 115, 232, 0.08);
  z-index: 10;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.2);
  transition: border-color var(--transition-fast);
}

.selection-info {
  position: absolute;
  bottom: -32px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 11px;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
  font-family: var(--font-mono);
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-md);
}

.instructions {
  position: absolute;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-sm) var(--space-lg);
  box-shadow: var(--shadow-lg);
  z-index: 20;
  pointer-events: none;
}

.instructions p {
  font-size: 0.8rem;
  color: var(--text-secondary);
  letter-spacing: 0.03em;
}
</style>
