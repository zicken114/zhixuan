import { ref, computed } from 'vue';
import {
  createReadingSession,
  updateReadingSession,
  getReadingSessions,
  getReadingStats,
  type ReadingSession
} from './useDatabase';
import { recordEvent } from './useEvents';

/** Global reactive state for the active reading session. */
const activeSession = ref<ReadingSession | null>(null);
const isTracking = ref(false);
let pageCheckInterval: number | null = null;

/**
 * Start tracking a reading session.
 * Called when the user enters a PDF reader window.
 */
export async function startReadingSession(
  documentTitle: string,
  documentPath?: string,
  projectId?: string | null,
  startPage?: number
): Promise<void> {
  // If already tracking the same document, just continue
  if (isTracking.value && activeSession.value?.documentTitle === documentTitle) {
    return;
  }

  // End any existing session first
  if (isTracking.value && activeSession.value) {
    await endReadingSession();
  }

  const now = Date.now();

  const session: ReadingSession = {
    projectId: projectId || null,
    documentTitle,
    documentPath,
    startPage,
    pagesRead: startPage !== undefined ? [startPage] : [],
    durationSeconds: 0,
    startedAt: now,
    isActive: true
  };

  try {
    const id = await createReadingSession(session);
    activeSession.value = { ...session, id };
    isTracking.value = true;

    // Start periodic page check (every 10 seconds)
    pageCheckInterval = window.setInterval(() => {
      checkCurrentPage();
    }, 10000);

    recordEvent({
      event_type: 'reading_session_start',
      resource_id: documentTitle,
      metadata: { project_id: projectId, start_page: startPage }
    });
  } catch (e) {
    console.error('[ReadingSession] Failed to start session:', e);
  }
}

/**
 * Record the current page number into the active session.
 */
export async function recordPage(page: number): Promise<void> {
  if (!isTracking.value || !activeSession.value?.id) return;

  const session = activeSession.value;
  if (!session.pagesRead.includes(page)) {
    session.pagesRead.push(page);
    session.pagesRead.sort((a, b) => a - b);
    session.endPage = page;

    try {
      await updateReadingSession(session);
      activeSession.value = { ...session };

      recordEvent({
        event_type: 'page_change',
        resource_id: session.documentTitle,
        metadata: { page, total_pages_read: session.pagesRead.length }
      });
    } catch (e) {
      console.warn('[ReadingSession] Failed to record page:', e);
    }
  }
}

/**
 * End the current reading session.
 */
export async function endReadingSession(): Promise<void> {
  if (!isTracking.value || !activeSession.value?.id) {
    isTracking.value = false;
    activeSession.value = null;
    return;
  }

  if (pageCheckInterval) {
    clearInterval(pageCheckInterval);
    pageCheckInterval = null;
  }

  const session = activeSession.value;
  const now = Date.now();
  session.durationSeconds = Math.round((now - session.startedAt) / 1000);
  session.endedAt = now;
  session.isActive = false;

  try {
    await updateReadingSession(session);

    recordEvent({
      event_type: 'reading_session_end',
      duration_ms: session.durationSeconds * 1000,
      resource_id: session.documentTitle,
      metadata: {
        pages_read: session.pagesRead.length,
        duration_seconds: session.durationSeconds
      }
    });
  } catch (e) {
    console.error('[ReadingSession] Failed to end session:', e);
  } finally {
    isTracking.value = false;
    activeSession.value = null;
  }
}

/**
 * Check the current page (placeholder for integration with pdf_detection).
 * In a full implementation, this would call the Rust backend to get the current page.
 */
async function checkCurrentPage(): Promise<void> {
  if (!activeSession.value) return;
  // This is a no-op placeholder — the actual page tracking happens
  // when the Rust backend emits page-change events or when the
  // widget polls the current window title for page numbers.
}

/**
 * Get a summary of reading progress for a document.
 */
export async function getDocumentProgress(documentTitle: string): Promise<{
  lastReadAt: number | null;
  totalDurationMinutes: number;
  pagesRead: number;
  lastPage: number | null;
}> {
  const sessions = await getReadingSessions(undefined, 100);
  const docSessions = sessions.filter(s => s.documentTitle === documentTitle);

  if (docSessions.length === 0) {
    return { lastReadAt: null, totalDurationMinutes: 0, pagesRead: 0, lastPage: null };
  }

  const totalDuration = docSessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const allPages = new Set<number>();
  let lastPage: number | null = null;
  let lastReadAt: number | null = null;

  for (const s of docSessions) {
    s.pagesRead.forEach(p => allPages.add(p));
    if (s.endPage !== undefined) {
      lastPage = s.endPage;
    }
    if (s.endedAt && (!lastReadAt || s.endedAt > lastReadAt)) {
      lastReadAt = s.endedAt;
    }
  }

  return {
    lastReadAt,
    totalDurationMinutes: Math.round(totalDuration / 60),
    pagesRead: allPages.size,
    lastPage
  };
}

/**
 * Reactively expose the active session state.
 */
export function useReadingSessionState() {
  return {
    activeSession: computed(() => activeSession.value),
    isTracking: computed(() => isTracking.value)
  };
}

export { getReadingSessions, getReadingStats, type ReadingSession };
