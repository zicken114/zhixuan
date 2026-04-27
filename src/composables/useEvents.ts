import { invoke } from '@tauri-apps/api/core';

export interface EventPayload {
  event_type: string;
  project_id?: string;
  duration_ms?: number;
  resource_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Record an activity event to the Rust EventCollector.
 * Events are buffered in a ring buffer and flushed to SQLite periodically.
 * If incognito mode is enabled, this becomes a no-op.
 */
export async function recordEvent(payload: EventPayload): Promise<void> {
  try {
    await invoke('record_event', {
      eventType: payload.event_type,
      projectId: payload.project_id ?? null,
      durationMs: payload.duration_ms ?? null,
      resourceId: payload.resource_id ?? null,
      metadata: payload.metadata ? JSON.stringify(payload.metadata) : null,
    });
  } catch (e) {
    // Silently ignore event recording failures — they should never break user-facing features
    console.warn('[EventCollector] Failed to record event:', e);
  }
}

/**
 * Set incognito mode on the Rust side.
 */
export async function setIncognitoMode(enabled: boolean): Promise<void> {
  await invoke('set_incognito_mode', { enabled });
}

/**
 * Manually flush buffered events to the database.
 */
export async function flushEvents(): Promise<number> {
  return await invoke('flush_events') as number;
}
