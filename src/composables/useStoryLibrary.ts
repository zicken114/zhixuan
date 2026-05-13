import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { loadStoryLibraryCache, saveStoryLibraryCache } from './useDatabase';

// ── API 配置 ──────────────────────────────────────────────
const STORY_API_URL = 'https://openapi.zhihu.com/openapi/hackathon_story/list';
const APP_KEY = 'speed-88-40';
const APP_SECRET = '55nvcOahOqf09Pv7kPU5eUJSwKumbmlT';

// 缓存 TTL：1 小时（3600 秒）
const CACHE_TTL_MS = 3600 * 1000;

// ── 类型定义 ──────────────────────────────────────────────

export interface StoryItem {
  work_id: string;
  title: string;
  artwork: string;
  tab_artwork: string;
  description: string;
  labels?: string[];
}

interface StoryApiResponse {
  status: number;
  msg: string;
  data: StoryItem[];
}

export interface StoryLibraryResult {
  items: StoryItem[];
  cachedAt: number;
  fromCache: boolean;
}

// ── HMAC-SHA256 签名 ─────────────────────────────────────

function stringToBuffer(str: string): ArrayBuffer {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function hmacSha256(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    stringToBuffer(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, stringToBuffer(message));
  return bufferToBase64(signature);
}

function generateLogId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/**
 * 构造签名
 *
 * 签名字符串格式：app_key:{app_key}|ts:{timestamp}|logid:{log_id}|extra_info:{extra_info}
 * 密钥：app_secret
 * 算法：HMAC-SHA256
 * 编码：Base64
 */
async function buildSign(
  appKey: string,
  timestamp: number,
  logId: string,
  extraInfo: string
): Promise<string> {
  const signString = `app_key:${appKey}|ts:${timestamp}|logid:${logId}|extra_info:${extraInfo}`;
  return hmacSha256(APP_SECRET, signString);
}

// ── 缓存辅助 ──────────────────────────────────────────────

function isCacheValid(timestamp: number): boolean {
  return timestamp > 0 && Date.now() - timestamp < CACHE_TTL_MS;
}

// ── 核心方法 ──────────────────────────────────────────────

class StoryLibraryError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'StoryLibraryError';
  }
}

/**
 * 从知乎开放平台抓取故事素材列表。
 *
 * 缓存策略（优先级从高到低）：
 * 1. SQLite 持久化缓存（1 小时 TTL）
 * 2. 网络请求（带 HMAC-SHA256 签名）
 * 3. 过期缓存兜底（网络失败时静默返回旧数据）
 */
export async function fetchStoryLibrary(): Promise<StoryLibraryResult> {
  // 1. 读取 SQLite 持久化缓存
  try {
    const dbCache = await loadStoryLibraryCache();
    if (dbCache && isCacheValid(dbCache.cachedAt)) {
      console.log('[素材库命中本地缓存]');
      return { items: dbCache.items, cachedAt: dbCache.cachedAt, fromCache: true };
    }
  } catch (e) {
    console.warn('[StoryLibrary] Failed to load DB cache:', e);
  }

  // 2. 网络请求（带签名）
  const timestamp = Math.floor(Date.now() / 1000);
  const logId = generateLogId();
  const extraInfo = '';

  try {
    const sign = await buildSign(APP_KEY, timestamp, logId, extraInfo);

    const response = await tauriFetch(STORY_API_URL, {
      method: 'GET',
      headers: {
        'X-App-Key': APP_KEY,
        'X-Timestamp': String(timestamp),
        'X-Log-Id': logId,
        'X-Extra-Info': extraInfo,
        'X-Sign': sign,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new StoryLibraryError(`HTTP ${response.status}`);
    }

    const payload = (await response.json()) as StoryApiResponse;

    if (payload.status === 1) {
      throw new StoryLibraryError(payload.msg || '接口返回错误', payload.status);
    }

    if (payload.status !== 0) {
      throw new StoryLibraryError(
        payload.msg || `未知错误 (status: ${payload.status})`,
        payload.status
      );
    }

    const items = payload.data || [];
    const now = Date.now();

    // 写入 SQLite 持久化缓存
    try {
      await saveStoryLibraryCache({ items, cachedAt: now });
    } catch (e) {
      console.warn('[StoryLibrary] Failed to save DB cache:', e);
    }

    return { items, cachedAt: now, fromCache: false };
  } catch (e) {
    // 3. 容灾降级：任何失败时，检查是否有过期缓存可用
    console.warn('[StoryLibrary] live fetch failed, falling back to stale cache:', e);

    try {
      const dbCache = await loadStoryLibraryCache();
      if (dbCache && dbCache.items.length > 0) {
        return { items: dbCache.items, cachedAt: dbCache.cachedAt, fromCache: true };
      }
    } catch {
      // ignore
    }

    // 彻底无缓存时抛出原始错误
    throw e;
  }
}

/**
 * 格式化缓存时间为可读字符串
 */
export function formatCacheAge(timestamp: number): string {
  if (!timestamp) return '';
  const diffMs = Date.now() - timestamp;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚更新';
  if (diffMin < 60) return `${diffMin} 分钟前更新`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前更新`;
  return `${Math.floor(diffHour / 24)} 天前更新`;
}

export { StoryLibraryError };
