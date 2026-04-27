import { ref } from 'vue';

/**
 * Provides a fake progress bar that simulates variable-speed progress
 * until manually completed or cancelled.
 *
 * Used by PopupWindow and ResultWindow to show visual feedback
 * while waiting for AI responses.
 */
export function useProgress() {
  const progress = ref(0);
  const label = ref('处理中...');
  let timer: ReturnType<typeof setInterval> | null = null;

  /** Start the fake progress animation. */
  const start = (initialLabel = '处理中...') => {
    stop();
    progress.value = 0;
    label.value = initialLabel;

    timer = setInterval(() => {
      if (progress.value < 85) {
        // Variable speed: slow start, faster middle, slow end
        const increment = progress.value < 30 ? 2 : progress.value < 70 ? 3.5 : 1.5;
        progress.value = Math.min(85, progress.value + increment);
      }
    }, 80);
  };

  /** Mark progress as completed (100%). */
  const complete = async (completionLabel = '✓ 已复制到粘贴板', dwellMs = 1500) => {
    stop();
    progress.value = 100;
    label.value = completionLabel;
    await new Promise(resolve => setTimeout(resolve, dwellMs));
  };

  /** Stop the timer without changing the displayed values. */
  const stop = () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  /** Reset to initial state. */
  const reset = () => {
    stop();
    progress.value = 0;
    label.value = '处理中...';
  };

  return {
    progress,
    label,
    start,
    complete,
    stop,
    reset,
  };
}
