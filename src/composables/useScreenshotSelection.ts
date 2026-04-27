import { ref, computed } from 'vue';

export interface SelectionInfo {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SelectionBoxStyle = Record<string, string>;

/**
 * Manages mouse-based region selection on top of a screenshot.
 * Handles viewport-to-original-image coordinate conversion and canvas cropping.
 */
export function useScreenshotSelection() {
  const isSelecting = ref(false);
  const hasSelected = ref(false);
  const startX = ref(0);
  const startY = ref(0);
  const endX = ref(0);
  const endY = ref(0);

  const handleMouseDown = (e: MouseEvent, excludeSelector?: string) => {
    if (e.button !== 0) return false;

    const target = e.target as HTMLElement;
    if (excludeSelector && target.closest(excludeSelector)) {
      return false;
    }

    isSelecting.value = true;
    startX.value = e.clientX;
    startY.value = e.clientY;
    endX.value = e.clientX;
    endY.value = e.clientY;
    hasSelected.value = false;
    return true;
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isSelecting.value) return;
    endX.value = e.clientX;
    endY.value = e.clientY;
  };

  const handleMouseUp = () => {
    if (!isSelecting.value) return;
    isSelecting.value = false;

    const width = Math.abs(endX.value - startX.value);
    const height = Math.abs(endY.value - startY.value);

    if (width < 10 || height < 10) {
      hasSelected.value = false;
      return;
    }

    hasSelected.value = true;
  };

  const cancelSelection = () => {
    hasSelected.value = false;
    isSelecting.value = false;
  };

  const resetSelection = () => {
    isSelecting.value = false;
    hasSelected.value = false;
    startX.value = 0;
    startY.value = 0;
    endX.value = 0;
    endY.value = 0;
  };

  const selectionBox = computed((): SelectionBoxStyle => {
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

  const selectionInfo = computed((): SelectionInfo => {
    const width = Math.abs(endX.value - startX.value);
    const height = Math.abs(endY.value - startY.value);
    return {
      x: Math.round(Math.min(startX.value, endX.value)),
      y: Math.round(Math.min(startY.value, endY.value)),
      width: Math.round(width),
      height: Math.round(height)
    };
  });

  /**
   * Crops the selected region from the screenshot image.
   * Returns the cropped image as a base64 data URL.
   */
  const cropSelection = async (
    backgroundImage: string,
    originalWidth: number,
    originalHeight: number
  ): Promise<string> => {
    const viewX = Math.min(startX.value, endX.value);
    const viewY = Math.min(startY.value, endY.value);
    const viewWidth = Math.abs(endX.value - startX.value);
    const viewHeight = Math.abs(endY.value - startY.value);

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate how image was scaled with object-fit: cover
    const imgAspect = originalWidth / originalHeight;
    const viewAspect = viewportWidth / viewportHeight;

    let displayWidth: number;
    let displayHeight: number;
    let offsetX: number;
    let offsetY: number;

    if (imgAspect > viewAspect) {
      displayHeight = viewportHeight;
      displayWidth = displayHeight * imgAspect;
      offsetX = (displayWidth - viewportWidth) / 2;
      offsetY = 0;
    } else {
      displayWidth = viewportWidth;
      displayHeight = displayWidth / imgAspect;
      offsetX = 0;
      offsetY = (displayHeight - viewportHeight) / 2;
    }

    const scaleX = originalWidth / displayWidth;
    const scaleY = originalHeight / displayHeight;

    const imgX = Math.round((viewX + offsetX) * scaleX);
    const imgY = Math.round((viewY + offsetY) * scaleY);
    const imgWidthScaled = Math.round(viewWidth * scaleX);
    const imgHeightScaled = Math.round(viewHeight * scaleY);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    const img = new Image();

    await new Promise<void>((resolve, reject) => {
      img.onload = () => {
        canvas.width = imgWidthScaled;
        canvas.height = imgHeightScaled;
        ctx.drawImage(img, imgX, imgY, imgWidthScaled, imgHeightScaled, 0, 0, imgWidthScaled, imgHeightScaled);
        resolve();
      };
      img.onerror = reject;
      img.src = backgroundImage;
    });

    return canvas.toDataURL('image/png');
  };

  return {
    isSelecting,
    hasSelected,
    startX,
    startY,
    endX,
    endY,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    cancelSelection,
    resetSelection,
    selectionBox,
    selectionInfo,
    cropSelection
  };
}
