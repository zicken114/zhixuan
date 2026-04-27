/**
 * Local embedding using Transformers.js
 * No Ollama, no online API — runs entirely in the browser/WebView.
 *
 * Model: Xenova/all-MiniLM-L6-v2 (~22 MB)
 * - 384-dimensional vectors
 * - Good balance of speed and quality for academic text
 * - Downloaded automatically on first use and cached locally
 */

import { pipeline, type FeatureExtractionPipeline, env } from '@huggingface/transformers';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

let extractor: FeatureExtractionPipeline | null = null;
let loading = false;
let currentMirrorUrl = 'https://hf-mirror.com/';
let fetchIntercepted = false;

export interface EmbedderProgress {
  status: 'initiate' | 'download' | 'progress' | 'progress_total' | 'done';
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

/** Intercept fetch calls to redirect huggingface.co URLs to the mirror,
 *  and route them through Tauri's backend fetch to bypass CORS. */
function setupFetchInterceptor(mirrorUrl: string): void {
  if (fetchIntercepted) return;
  fetchIntercepted = true;

  const browserFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else {
      url = input.url;
    }

    // Redirect huggingface.co to mirror, then use Tauri backend fetch
    // to bypass browser CORS restrictions.
    if (url.includes('huggingface.co') || url.includes('hf-mirror.com')) {
      const newUrl = url.includes('huggingface.co')
        ? url.replace('https://huggingface.co/', mirrorUrl)
        : url;
      console.log('[Embedder] Fetch via Tauri backend:', url, '->', newUrl);
      return tauriFetch(newUrl, init);
    }

    return browserFetch(input, init);
  };
}

/** Configure the HuggingFace mirror URL for model downloads (e.g. https://hf-mirror.com/). */
export function setEmbedderMirrorUrl(url: string): void {
  if (url && url.trim()) {
    currentMirrorUrl = url.trim().endsWith('/') ? url.trim() : `${url.trim()}/`;
    // Also set Transformers.js internal env as a backup
    try {
      (env as any).remoteHost = currentMirrorUrl;
    } catch {
      // ignore
    }
    // CRITICAL FIX: Override env.fetch so Transformers.js uses Tauri's backend HTTP
    // client instead of the browser's fetch. env.fetch is captured at module load time
    // (globalThis.fetch.bind(globalThis)) and never sees our window.fetch override, so
    // we must replace it explicitly here to bypass CORS restrictions.
    try {
      (env as any).fetch = async (input: string | URL | Request, init?: any) => {
        let fetchUrl: string;
        if (typeof input === 'string') {
          fetchUrl = input;
        } else if (input instanceof URL) {
          fetchUrl = input.href;
        } else {
          fetchUrl = input.url;
        }

        // Redirect huggingface.co URLs to mirror
        if (fetchUrl.includes('huggingface.co')) {
          fetchUrl = fetchUrl.replace('https://huggingface.co/', currentMirrorUrl);
        }

        console.log('[Embedder] env.fetch via Tauri backend:', fetchUrl);
        return tauriFetch(fetchUrl, init);
      };
    } catch {
      // ignore
    }
    setupFetchInterceptor(currentMirrorUrl);
    console.log('[Embedder] Mirror URL set to:', currentMirrorUrl);
  }
}

/** Check if the embedder model has already been loaded (and likely cached). */
export function isEmbedderLoaded(): boolean {
  return extractor !== null;
}

/**
 * Pre-load the embedding model with optional progress callback.
 * This lets the UI show a download progress bar before indexing begins.
 */
export async function preloadEmbedder(
  onProgress?: (info: EmbedderProgress) => void
): Promise<void> {
  if (extractor) return;
  if (loading) {
    while (loading) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return;
  }

  loading = true;
  try {
    console.log('[Embedder] Pre-loading model from mirror:', currentMirrorUrl);
    extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      dtype: 'fp32',
      device: 'wasm',
      progress_callback: onProgress
        ? (data: any) => {
            onProgress({
              status: data.status,
              file: data.file,
              name: data.name,
              progress: data.progress,
              loaded: data.loaded,
              total: data.total
            });
          }
        : undefined
    });
    console.log('[Embedder] Model loaded: Xenova/all-MiniLM-L6-v2');
  } catch (e) {
    console.error('[Embedder] Failed to load model:', e);
    throw new Error('Embedding model failed to load. Check your network for first-time download.');
  } finally {
    loading = false;
  }
}

/**
 * Initialise (or reuse) the embedding pipeline.
 * The first call downloads the ONNX model to the browser cache.
 */
export async function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (extractor) return extractor;
  await preloadEmbedder();
  if (!extractor) throw new Error('Embedder initialization failed unexpectedly');
  return extractor;
}

/**
 * Embed a single string into a 384-dim float vector.
 * Result is L2-normalised (cosine similarity = dot product).
 */
export async function embed(text: string): Promise<number[]> {
  const pipe = await getEmbedder();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  // output is a Tensor — convert to plain JS array
  const tensorData = output.data as Float32Array;
  return Array.from(tensorData);
}

/**
 * Batch embed multiple strings.
 * More efficient than calling embed() in a loop.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const pipe = await getEmbedder();
  const outputs = await pipe(texts, { pooling: 'mean', normalize: true });
  // When batching, output.data is a flat Float32Array of shape [batch, 384]
  const flat = outputs.data as Float32Array;
  const dim = 384;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const start = i * dim;
    results.push(Array.from(flat.slice(start, start + dim)));
  }
  return results;
}
