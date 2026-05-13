import { defineStore } from 'pinia';
import { ref } from 'vue';

export type PopupActionType = 'translate' | 'clean' | 'citation' | 'extract-text' | 'extract-latex' | 'extract-math' | 'extract-table' | 'screenshot';

export interface PopupHistoryItem {
  id: string;
  actionType: PopupActionType;
  actionLabel: string;
  actionIcon?: string;
  inputText: string;
  inputImage?: string; // base64 image data for screenshots
  outputText: string;
  timestamp: number;
}

export const usePopupHistoryStore = defineStore('popupHistory', () => {
  const items = ref<PopupHistoryItem[]>([]);
  const maxItems = 50;

  const loadFromStorage = () => {
    try {
      const stored = localStorage.getItem('popupHistory');
      if (stored) {
        items.value = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load popup history:', e);
    }
  };

  const saveToStorage = () => {
    try {
      localStorage.setItem('popupHistory', JSON.stringify(items.value));
    } catch (e) {
      console.error('Failed to save popup history:', e);
    }
  };

  const addItem = (item: Omit<PopupHistoryItem, 'id' | 'timestamp'>) => {
    const newItem: PopupHistoryItem = {
      ...item,
      id: Date.now().toString(),
      timestamp: Date.now()
    };
    items.value.unshift(newItem);
    // Keep only the last maxItems
    if (items.value.length > maxItems) {
      items.value = items.value.slice(0, maxItems);
    }
    saveToStorage();
  };

  const deleteItem = (id: string) => {
    const index = items.value.findIndex(item => item.id === id);
    if (index !== -1) {
      items.value.splice(index, 1);
      saveToStorage();
    }
  };

  const clearAll = () => {
    items.value = [];
    saveToStorage();
  };

  // Initialize
  loadFromStorage();

  return {
    items,
    addItem,
    deleteItem,
    clearAll,
    loadFromStorage
  };
});
