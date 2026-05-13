import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  pickFolder,
  addFolderToKnowledgeBase,
  indexDocument,
  removeDocument,
  searchKnowledgeBase,
  getProjectDocuments,
  type SearchResult
} from '../utils/knowledgeBase';
import { isEmbedderLoaded, preloadEmbedder, type EmbedderProgress } from '../utils/embedder';
import type { KnowledgeDoc } from '../composables/useDatabase';
import { useProjectStore } from './projects';
import { recordEvent } from '../composables/useEvents';
import { fetchStoryLibrary } from '../composables/useStoryLibrary';

export const useKnowledgeBaseStore = defineStore('knowledgeBase', () => {
  const projectStore = useProjectStore();

  const documents = ref<KnowledgeDoc[]>([]);
  const searchResults = ref<SearchResult[]>([]);
  const searchQuery = ref('');
  const isIndexing = ref(false);
  const indexProgress = ref({ current: 0, total: 0 });
  const isSearching = ref(false);
  const lastError = ref<string | null>(null);

  // Embedder download state
  const embedderLoading = ref(false);
  const embedderProgress = ref(0);
  const embedderStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const showDownloadModal = ref(false);

  // Zhihu mock fetch state
  const zhihuFetching = ref(false);

  const projectDocuments = computed(() => {
    const pid = projectStore.currentProjectId;
    return documents.value.filter((d) =>
      pid === null ? !d.projectId : d.projectId === pid
    );
  });

  const pendingDocs = computed(() =>
    projectDocuments.value.filter((d) => d.indexStatus === 'pending')
  );

  const indexedDocs = computed(() =>
    projectDocuments.value.filter((d) => d.indexStatus === 'completed')
  );

  const errorDocs = computed(() =>
    projectDocuments.value.filter((d) => d.indexStatus === 'error')
  );

  const isEmbedderReady = computed(() => embedderStatus.value === 'ready');

  /** Load documents for the current project from DB. */
  const loadDocuments = async () => {
    try {
      documents.value = await getProjectDocuments(projectStore.currentProjectId);
    } catch (e) {
      console.error('[KB Store] Failed to load documents:', e);
      lastError.value = 'Failed to load documents';
    }
  };

  /** Check if embedder is ready; if not, show the download modal. */
  const ensureEmbedder = async (): Promise<boolean> => {
    if (isEmbedderLoaded()) {
      embedderStatus.value = 'ready';
      return true;
    }
    showDownloadModal.value = true;
    return false;
  };

  /** Download the embedding model with progress tracking. */
  const downloadEmbedder = async () => {
    embedderLoading.value = true;
    embedderStatus.value = 'loading';
    embedderProgress.value = 0;
    lastError.value = null;

    try {
      await preloadEmbedder((info: EmbedderProgress) => {
        if (info.status === 'progress_total' && typeof info.progress === 'number') {
          embedderProgress.value = Math.round(info.progress);
        } else if (info.status === 'progress' && info.loaded && info.total) {
          embedderProgress.value = Math.round((info.loaded / info.total) * 100);
        }
      });
      embedderStatus.value = 'ready';
      showDownloadModal.value = false;
    } catch (e: any) {
      console.error('[KB Store] Failed to download embedder:', e);
      embedderStatus.value = 'error';
      lastError.value = e?.message || 'Model download failed';
    } finally {
      embedderLoading.value = false;
    }
  };

  /** Open folder picker and add all PDFs to the knowledge base. */
  const addFolder = async () => {
    const ready = await ensureEmbedder();
    if (!ready) return;

    const folderPath = await pickFolder();
    if (!folderPath) return;

    lastError.value = null;
    isIndexing.value = true;
    indexProgress.value = { current: 0, total: 0 };

    await recordEvent({
      event_type: 'kb_index_start',
      project_id: projectStore.currentProjectId ?? undefined,
      metadata: { source: 'folder', folder_path: folderPath },
    });
    const startTime = Date.now();
    let addedCount = 0;
    let success = false;

    try {
      const added = await addFolderToKnowledgeBase(
        folderPath,
        projectStore.currentProjectId,
        (current, total) => {
          indexProgress.value = { current, total };
        }
      );
      documents.value.unshift(...added);
      addedCount = added.length;
      success = true;
    } catch (e: any) {
      console.error('[KB Store] Failed to add folder:', e);
      lastError.value = e?.message || 'Failed to add folder';
    } finally {
      isIndexing.value = false;
      indexProgress.value = { current: 0, total: 0 };
      await recordEvent({
        event_type: 'kb_index_complete',
        project_id: projectStore.currentProjectId ?? undefined,
        duration_ms: Date.now() - startTime,
        metadata: { source: 'folder', folder_path: folderPath, documents_added: addedCount, success, error: lastError.value ?? undefined },
      });
    }
  };

  /** Re-index a single document. */
  const reindexDocument = async (doc: KnowledgeDoc) => {
    const ready = await ensureEmbedder();
    if (!ready) return;

    await recordEvent({
      event_type: 'kb_index_start',
      project_id: projectStore.currentProjectId ?? undefined,
      resource_id: doc.id,
      metadata: { source: 'reindex', file_name: doc.fileName },
    });
    const startTime = Date.now();
    let success = false;

    try {
      isIndexing.value = true;
      lastError.value = null;
      await indexDocument(doc);
      // Refresh doc status
      await loadDocuments();
      success = true;
    } catch (e: any) {
      console.error('[KB Store] Failed to reindex:', e);
      lastError.value = e?.message || 'Reindex failed';
    } finally {
      isIndexing.value = false;
      await recordEvent({
        event_type: 'kb_index_complete',
        project_id: projectStore.currentProjectId ?? undefined,
        resource_id: doc.id,
        duration_ms: Date.now() - startTime,
        metadata: { source: 'reindex', file_name: doc.fileName, success, error: lastError.value ?? undefined },
      });
    }
  };

  /** Remove a document from the knowledge base. */
  const deleteDocument = async (docId: string) => {
    try {
      await removeDocument(docId);
      documents.value = documents.value.filter((d) => d.id !== docId);
    } catch (e) {
      console.error('[KB Store] Failed to delete document:', e);
      lastError.value = 'Failed to delete document';
    }
  };

  /** Search the knowledge base for relevant chunks. */
  const search = async (query: string, topK: number = 5): Promise<SearchResult[]> => {
    if (!query.trim()) {
      searchResults.value = [];
      return [];
    }

    // Search also needs embedder
    const ready = await ensureEmbedder();
    if (!ready) {
      searchResults.value = [];
      return [];
    }

    isSearching.value = true;
    lastError.value = null;

    try {
      const results = await searchKnowledgeBase(
        query,
        projectStore.currentProjectId,
        topK
      );
      searchResults.value = results;
      return results;
    } catch (e: any) {
      console.error('[KB Store] Search failed:', e);
      lastError.value = e?.message || 'Search failed';
      searchResults.value = [];
      return [];
    } finally {
      isSearching.value = false;
    }
  };

  /** Build a context string from search results for injection into chat. */
  const buildContextFromResults = (results: SearchResult[]): string => {
    if (results.length === 0) return '';

    const chunks = results.map((r, i) => {
      const source = r.chunk.pageNumber
        ? `[来源 ${i + 1}, 第 ${r.chunk.pageNumber} 页]`
        : `[来源 ${i + 1}]`;
      return `${source}\n${r.chunk.content}`;
    });

    return `以下是我收藏的知乎素材和参考文档，你帮我看看这里面有没有能回答我问题的内容。如果有就直接用，没有的话按你的常识答也行。回答要自然像人写的，别用星号、井号、列表编号这些符号，直接输出文字。\n\n${chunks.join('\n\n---\n\n')}`;
  };

  /** 从知乎开放平台抓取故事素材列表 */
  const fetchZhihuFavorites = async () => {
    zhihuFetching.value = true;

    try {
      const result = await fetchStoryLibrary();
      // Story items are not added to knowledge docs — they are displayed in the story panel
      await recordEvent({
        event_type: 'zhihu_story_fetch',
        project_id: projectStore.currentProjectId ?? undefined,
        metadata: { stories_count: result.items.length, from_cache: result.fromCache }
      });
    } catch (e) {
      console.error('[KB Store] Failed to fetch story library:', e);
    } finally {
      zhihuFetching.value = false;
    }
  };

  return {
    documents,
    searchResults,
    searchQuery,
    isIndexing,
    indexProgress,
    isSearching,
    lastError,
    embedderLoading,
    embedderProgress,
    embedderStatus,
    showDownloadModal,
    zhihuFetching,
    projectDocuments,
    pendingDocs,
    indexedDocs,
    errorDocs,
    isEmbedderReady,
    loadDocuments,
    ensureEmbedder,
    downloadEmbedder,
    addFolder,
    reindexDocument,
    deleteDocument,
    search,
    buildContextFromResults,
    fetchZhihuFavorites
  };
});
