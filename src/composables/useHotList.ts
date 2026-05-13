import { ref } from 'vue';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { loadHotListCache, saveHotListCache } from './useDatabase';

// ── API 配置 ──────────────────────────────────────────────
const ZHIHU_HOT_API = 'https://developer.zhihu.com/api/v1/content/hot_list';
const ZHIHU_API_TOKEN = '55nvcOahOqf09Pv7kPU5eUJSwKumbmlT';

// 缓存 TTL：30 分钟（100 次/天 ≈ 每 15 分钟一次，30 分钟每天最多 48 次，安全余量充足）
const CACHE_TTL_MS = 30 * 60 * 1000;

// ── 响应实体类 ──────────────────────────────────────────────

export interface ZhihuHotItem {
  Title: string;
  Url: string;
  ThumbnailUrl: string;
  Summary: string;
}

interface ZhihuHotResponse {
  Code: number;
  Message: string;
  Data: {
    Total: number;
    Items: ZhihuHotItem[];
  };
}

export interface HotListResult {
  total: number;
  items: ZhihuHotItem[];
}

// ── 前端展示用的简化类型 ────────────────────────────────────

export interface HotItem {
  id: string;
  title: string;
  heat: string;
  url?: string;
  excerpt?: string;
  thumbnail?: string;
}

// ── 兜底 Mock 数据 ──────────────────────────────────────────

const MOCK_HOT_LIST: HotItem[] = [
  {
    id: 'mock-1',
    title: '如何看待 OpenAI 最新发布的 GPT-5，对国产大模型有什么影响？',
    heat: '1287 万热度',
    url: 'https://www.zhihu.com/',
    excerpt: '行业巨变将至，国产模型还能跟上节奏吗？',
    thumbnail: '',
  },
  {
    id: 'mock-2',
    title: '为什么越来越多的年轻人开始流行「冰箱式社交」？',
    heat: '986 万热度',
    url: 'https://www.zhihu.com/',
    excerpt: '只在需要时打开，平时关上门各过各的生活方式火了。',
    thumbnail: '',
  },
  {
    id: 'mock-3',
    title: 'DeepSeek V3.1 实测：国产大模型真的能挑战 Claude 了吗？',
    heat: '742 万热度',
    url: 'https://www.zhihu.com/',
    excerpt: '推理能力、长文本、代码生成全方位对比。',
    thumbnail: '',
  },
  {
    id: 'mock-4',
    title: '30 岁存款 50 万在一线城市算什么水平？',
    heat: '658 万热度',
    url: 'https://www.zhihu.com/',
    excerpt: '是焦虑的开始还是底气的来源，这届年轻人怎么看待存款。',
    thumbnail: '',
  },
  {
    id: 'mock-5',
    title: '如何评价 SpaceX 完成第 100 次星舰回收，对人类太空探索意味着什么？',
    heat: '521 万热度',
    url: 'https://www.zhihu.com/',
    excerpt: '从一次性火箭到完全可复用，航天工业的革命性转折点。',
    thumbnail: '',
  },
];

// ── 内存缓存（同进程内快速命中）─────────────────────────────

const cachedList = ref<HotItem[] | null>(null);
const cachedAt = ref<number>(0);
const cachedIsMock = ref(false);

// ── 核心服务 ────────────────────────────────────────────────

class HotListServiceError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = 'HotListServiceError';
  }
}

/**
 * 向知乎开发者平台热榜 API 发起请求。
 * 每次请求动态生成秒级 Unix 时间戳并注入请求头。
 */
export async function fetchZhihuHotList(limit = 30): Promise<HotListResult> {
  const timestamp = Math.floor(Date.now() / 1000);

  const response = await tauriFetch(`${ZHIHU_HOT_API}?Limit=${limit}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${ZHIHU_API_TOKEN}`,
      'X-Request-Timestamp': String(timestamp),
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new HotListServiceError(`HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ZhihuHotResponse;

  // 业务码校验
  if (payload.Code === 20001) {
    throw new HotListServiceError('鉴权失败，请检查 Secret', payload.Code);
  }
  if (payload.Code === 30001) {
    throw new HotListServiceError('接口请求太快，触发频率限制', payload.Code);
  }
  if (payload.Code !== 0) {
    throw new HotListServiceError(
      payload.Message || `未知错误 (Code: ${payload.Code})`,
      payload.Code
    );
  }

  return {
    total: payload.Data?.Total ?? 0,
    items: payload.Data?.Items ?? [],
  };
}

// ── 转换为前端展示格式 ──────────────────────────────────────

function toHotItems(items: ZhihuHotItem[]): HotItem[] {
  return items.map((item, i) => ({
    id: `zhihu-hot-${i}`,
    title: item.Title,
    url: item.Url,
    excerpt: item.Summary,
    thumbnail: item.ThumbnailUrl,
    heat: `${(30 - i) * 43 + 120} 万热度`, // 占位热度，API 未返回时做近似展示
  }));
}

// ── 缓存命中判断 ────────────────────────────────────────────

function isCacheValid(timestamp: number): boolean {
  return timestamp > 0 && Date.now() - timestamp < CACHE_TTL_MS;
}

/**
 * 格式化缓存时间戳为可读字符串
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

// ── 对外统一接口（三层缓存 + 兜底）───────────────────────────

/**
 * 获取知乎热榜。
 *
 * 缓存策略（优先级从高到低）：
 * 1. 内存缓存（同 Vue 进程内，30 分钟 TTL）
 * 2. SQLite 持久化缓存（跨会话，30 分钟 TTL）
 * 3. 网络请求（知乎 API，Limit=30）
 * 4. Mock 兜底数据（任何异常时）
 *
 * `forceRefresh` 会跳过内存和 SQLite 缓存，但仍会兜底。
 */
export async function fetchHotList(forceRefresh = false): Promise<{ items: HotItem[]; isMock: boolean; cachedAt: number }> {
  // 1. 内存缓存命中
  if (!forceRefresh && cachedList.value && isCacheValid(cachedAt.value)) {
    return { items: cachedList.value, isMock: cachedIsMock.value, cachedAt: cachedAt.value };
  }

  // 2. SQLite 持久化缓存命中
  if (!forceRefresh) {
    try {
      const dbCache = await loadHotListCache();
      if (dbCache && isCacheValid(dbCache.cachedAt)) {
        cachedList.value = dbCache.items;
        cachedAt.value = dbCache.cachedAt;
        cachedIsMock.value = dbCache.isMock;
        return { items: dbCache.items, isMock: dbCache.isMock, cachedAt: dbCache.cachedAt };
      }
    } catch (e) {
      console.warn('[HotList] Failed to load DB cache:', e);
    }
  }

  // 3. 网络请求
  try {
    const result = await fetchZhihuHotList(30);
    const items = toHotItems(result.items);
    const now = Date.now();

    // 写入内存缓存
    cachedList.value = items;
    cachedAt.value = now;
    cachedIsMock.value = false;

    // 写入 SQLite 持久化缓存
    try {
      await saveHotListCache({ items, cachedAt: now, isMock: false });
    } catch (e) {
      console.warn('[HotList] Failed to save DB cache:', e);
    }

    return { items, isMock: false, cachedAt: now };
  } catch (e) {
    console.warn('[HotList] live fetch failed, falling back to mock:', e);

    // 网络失败时，尝试返回任意可用缓存（即使已过期），避免界面白屏
    if (!forceRefresh) {
      try {
        const dbCache = await loadHotListCache();
        if (dbCache && dbCache.items.length > 0) {
          cachedList.value = dbCache.items;
          cachedAt.value = dbCache.cachedAt;
          cachedIsMock.value = dbCache.isMock;
          return { items: dbCache.items, isMock: dbCache.isMock, cachedAt: dbCache.cachedAt };
        }
      } catch {
        // ignore
      }
      if (cachedList.value) {
        return { items: cachedList.value, isMock: cachedIsMock.value, cachedAt: cachedAt.value };
      }
    }

    const now = Date.now();
    cachedList.value = MOCK_HOT_LIST;
    cachedAt.value = now;
    cachedIsMock.value = true;
    return { items: MOCK_HOT_LIST, isMock: true, cachedAt: now };
  }
}

export function getMockHotList(): HotItem[] {
  return MOCK_HOT_LIST;
}

// 导出错误类，供 UI 层做精细化提示
export { HotListServiceError };
