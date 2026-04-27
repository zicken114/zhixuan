/**
 * Zotero Bridge — Communicates with Zotero's local HTTP JSON API.
 *
 * Zotero runs a REST-like API at 127.0.0.1:23119 when the desktop app is open.
 * We use it to sync item metadata into a local SQLite cache for fast search
 * and offline access.
 *
 * All HTTP requests go through a Rust backend proxy to bypass CORS restrictions.
 */

import { invoke } from '@tauri-apps/api/core';
import {
  saveZoteroItems,
  saveZoteroCollections,
  loadZoteroCollections,
  getLastZoteroSyncTime,
  clearZoteroCache,
  searchZoteroItems,
  type ZoteroItem,
  type ZoteroCollection
} from '../composables/useDatabase';

const ZOTERO_BASE = 'http://127.0.0.1:23119/api';

export interface ZoteroApiItemData {
  key?: string;
  version?: number;
  itemType?: string;
  title?: string;
  creators?: { firstName?: string; lastName: string; creatorType: string }[];
  abstractNote?: string;
  url?: string;
  DOI?: string;
  date?: string;
  publicationTitle?: string;
  tags?: { tag: string }[];
  collections?: string[];
}

export interface ZoteroApiItem {
  key: string;
  version: number;
  data: ZoteroApiItemData;
}

export interface ZoteroApiCollectionData {
  key?: string;
  version?: number;
  name?: string;
  parentCollection?: string | false;
}

export interface ZoteroApiCollection {
  key: string;
  version: number;
  data: ZoteroApiCollectionData;
}

export interface ZoteroSyncResult {
  itemsSynced: number;
  collectionsSynced: number;
  success: boolean;
  error?: string;
}

interface FetchZoteroResult {
  body: string;
  total_results?: number;
}

/**
 * Build the API base URL for a given user ID.
 * Defaults to user 0 (local default library).
 */
function apiBase(userId: string = '0'): string {
  return `${ZOTERO_BASE}/users/${userId}`;
}

/**
 * Proxy a GET request to the Zotero API through the Rust backend.
 */
async function zoteroGet(url: string): Promise<FetchZoteroResult> {
  return invoke<FetchZoteroResult>('fetch_zotero', { url });
}

/**
 * Check if Zotero local API is reachable.
 */
export async function checkZoteroConnection(userId: string = '0'): Promise<boolean> {
  try {
    await zoteroGet(`${apiBase(userId)}/items?limit=1`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fetch a single page of items from Zotero.
 */
async function fetchItemsPage(
  userId: string,
  start: number = 0,
  limit: number = 100,
  since?: number
): Promise<{ items: ZoteroApiItem[]; totalResults: number }> {
  const params = new URLSearchParams({ start: String(start), limit: String(limit) });
  if (since) params.set('since', String(since));

  const res = await zoteroGet(`${apiBase(userId)}/items?${params.toString()}`);
  const items: ZoteroApiItem[] = JSON.parse(res.body);
  console.log('[ZoteroBridge] fetchItemsPage returned', items.length, 'items. First item keys:', items.slice(0, 3).map((i: any) => i.key || i.data?.key));
  return { items, totalResults: res.total_results || 0 };
}

/**
 * Fetch a single page of items from a specific collection.
 */
async function fetchCollectionItemsPage(
  userId: string,
  collectionKey: string,
  start: number = 0,
  limit: number = 100,
  since?: number
): Promise<{ items: ZoteroApiItem[]; totalResults: number }> {
  const params = new URLSearchParams({ start: String(start), limit: String(limit) });
  if (since) params.set('since', String(since));

  const res = await zoteroGet(`${apiBase(userId)}/collections/${collectionKey}/items?${params.toString()}`);
  const items: ZoteroApiItem[] = JSON.parse(res.body);
  console.log('[ZoteroBridge] fetchCollectionItemsPage returned', items.length, 'items for collection', collectionKey);
  return { items, totalResults: res.total_results || 0 };
}

/**
 * Fetch all collections from Zotero.
 */
export async function fetchCollections(userId: string): Promise<ZoteroApiCollection[]> {
  const res = await zoteroGet(`${apiBase(userId)}/collections?limit=1000`);
  return JSON.parse(res.body);
}

/**
 * Convert an API item to our local cache format.
 */
/** Item types to skip — these are notes, attachments, etc. that aren't actual publications. */
const SKIP_ITEM_TYPES = new Set(['note', 'attachment', 'annotation']);

function toCacheItem(item: ZoteroApiItem): ZoteroItem | null {
  if (!item.key) {
    console.warn('[ZoteroBridge] Skipping item without key:', item);
    return null;
  }

  // Zotero API v3 wraps fields in `data`, but some local API responses may put them at top level.
  const d: any = item.data || item;
  const itemType = (d.itemType)?.trim() || 'unknown';

  if (SKIP_ITEM_TYPES.has(itemType)) {
    console.log('[ZoteroBridge] Skipping non-publication item:', item.key, itemType);
    return null;
  }

  const creators = (d.creators || [])
    .map((c: any) => `${c.firstName || ''} ${c.lastName}`.trim())
    .join(', ');

  const result = {
    id: 0, // auto-assigned by SQLite
    key: item.key,
    itemType,
    title: d.title,
    creators: creators || undefined,
    abstract: d.abstractNote,
    url: d.url,
    doi: d.DOI,
    date: d.date,
    publication: d.publicationTitle,
    tags: (d.tags || []).map((t: any) => t.tag).join(', ') || undefined,
    collections: (d.collections || []).join(', ') || undefined,
    jsonData: JSON.stringify(item),
    version: item.version || 0,
    syncedAt: Date.now()
  };
  console.log('[ZoteroBridge] toCacheItem:', item.key, 'type=', itemType, 'title=', d.title);
  return result;
}

/**
 * Sync items from a specific collection.
 */
async function syncCollectionItems(
  userId: string,
  collectionKey: string,
  since?: number
): Promise<number> {
  let itemsSynced = 0;
  let start = 0;
  const limit = 100;

  while (true) {
    const { items, totalResults } = await fetchCollectionItemsPage(userId, collectionKey, start, limit, since);
    if (items.length === 0) break;

    const cacheItems = items.map(toCacheItem).filter((item): item is ZoteroItem => item !== null);
    if (cacheItems.length > 0) {
      await saveZoteroItems(cacheItems);
    }
    itemsSynced += cacheItems.length;

    start += items.length;
    if (start >= totalResults) break;
  }

  return itemsSynced;
}

/**
 * Perform a full or incremental sync of Zotero items and collections.
 *
 * If `collectionKeys` is provided, only sync items from those collections.
 * Otherwise, sync all items in the library.
 */
export async function syncZoteroLibrary(
  userId: string = '0',
  collectionKeys?: string[],
  forceFullSync: boolean = false
): Promise<ZoteroSyncResult> {
  const reachable = await checkZoteroConnection(userId);
  if (!reachable) {
    return { itemsSynced: 0, collectionsSynced: 0, success: false, error: 'Zotero is not running or API is unreachable. Make sure Zotero is open and the local API is enabled (Edit → Preferences → Advanced → Allow other applications...).' };
  }

  try {
    // Sync collections first (always sync all collections so we have the full tree)
    const apiCollections = await fetchCollections(userId);
    const collections: ZoteroCollection[] = apiCollections.map((c) => {
      const d = c.data || {};
      return {
        id: 0,
        key: c.key,
        name: d.name?.trim() || '(Unnamed Collection)',
        parentKey: d.parentCollection && typeof d.parentCollection === 'string' ? d.parentCollection : undefined,
        version: c.version || d.version || 0,
        syncedAt: Date.now()
      };
    });
    await saveZoteroCollections(collections);

    const lastSync = !forceFullSync ? await getLastZoteroSyncTime() : null;
    const since = lastSync ? Math.floor(lastSync / 1000) : undefined;

    let itemsSynced = 0;

    if (collectionKeys && collectionKeys.length > 0) {
      // Sync only selected collections
      for (const key of collectionKeys) {
        const count = await syncCollectionItems(userId, key, since);
        itemsSynced += count;
      }
    } else {
      // Sync all items
      let start = 0;
      const limit = 100;

      while (true) {
        const { items, totalResults } = await fetchItemsPage(userId, start, limit, since);
        if (items.length === 0) break;

        const cacheItems = items.map(toCacheItem).filter((item): item is ZoteroItem => item !== null);
        if (cacheItems.length > 0) {
          await saveZoteroItems(cacheItems);
        }
        itemsSynced += cacheItems.length;

        start += items.length;
        if (start >= totalResults) break;
      }
    }

    return { itemsSynced, collectionsSynced: collections.length, success: true };
  } catch (e: any) {
    console.error('[ZoteroBridge] Sync failed:', e);
    return { itemsSynced: 0, collectionsSynced: 0, success: false, error: e?.message || 'Sync failed' };
  }
}

/**
 * Search the local Zotero cache by keyword.
 */
export async function searchZoteroCache(query: string, limit: number = 20): Promise<ZoteroItem[]> {
  return searchZoteroItems(query, limit);
}

/**
 * Get all cached collections.
 */
export async function getCachedCollections(): Promise<ZoteroCollection[]> {
  return loadZoteroCollections();
}

/**
 * Clear the local Zotero cache and re-sync from scratch.
 */
export async function resetZoteroCache(): Promise<void> {
  await clearZoteroCache();
}

/**
 * Build a citation string from a Zotero item in a given style.
 * Supported: 'apa', 'ieee', 'gb7714'.
 */
export function formatCitation(item: ZoteroItem, style: 'apa' | 'ieee' | 'gb7714' = 'gb7714'): string {
  const authors = item.creators || 'Unknown';
  const year = item.date ? item.date.split('-')[0] : 'n.d.';
  const title = item.title || 'Untitled';
  const pub = item.publication || '';
  const doi = item.doi || '';

  switch (style) {
    case 'apa':
      return `${authors} (${year}). ${title}. ${pub}${doi ? ` https://doi.org/${doi}` : ''}`;
    case 'ieee':
      return `[1] ${authors}, "${title}," ${pub}, ${year}.`;
    case 'gb7714':
    default:
      return `${authors}. ${title}[J]. ${pub}, ${year}.${doi ? ` DOI:${doi}.` : ''}`;
  }
}
