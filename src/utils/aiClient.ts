import { useSettingsStore, type TaskType, type ModelProfile } from '../stores/settings';
import { useUsageStore } from '../stores/usage';
import { saveUsageRecord } from '../composables/useDatabase';

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export type MessageContent = string | (TextContent | ImageContent)[];

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: MessageContent;
}

export interface CallMetadata {
  modelName: string;
  latencyMs: number;
  estimatedCost: number;
  isFallback: boolean;
  fallbackReason?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface StreamCallbacks {
  onStart?: () => void;
  onToken?: (token: string) => void;
  onComplete?: (fullText: string, metadata?: CallMetadata) => void;
  onInterrupted?: (partialText: string, reason: 'user' | 'timeout') => void;
  onError?: (error: Error, metadata?: CallMetadata) => void;
}

/**
 * Estimate token count using a simple heuristic:
 * ~1 token per 4 characters for English/Chinese mixed text.
 * This is rough but sufficient for cost estimation.
 */
function estimateTokens(content: MessageContent): number {
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .filter((c): c is TextContent => c.type === 'text')
      .map(c => c.text)
      .join('');
  }
  return Math.ceil(text.length / 4);
}

function estimateMessagesTokens(messages: ChatMessage[]): { input: number; output: number } {
  const input = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  // Assume output is roughly 1.5x the last user message on average
  const lastUser = messages.filter(m => m.role === 'user').pop();
  const output = lastUser ? Math.ceil(estimateTokens(lastUser.content) * 1.5) : 256;
  return { input, output };
}

export class AIClient {
  private abortController: AbortController | null = null;
  private isUserCancelled = false;

  cancel() {
    this.isUserCancelled = true;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  private resolveChatCompletionsUrl(baseUrl: string) {
    const trimmedBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (trimmedBaseUrl.endsWith('/chat/completions')) {
      return trimmedBaseUrl;
    }
    return `${trimmedBaseUrl}/chat/completions`;
  }

  private getTextConfig() {
    const settingsStore = useSettingsStore();
    if (!settingsStore.isTextConfigured()) {
      throw new Error('Text AI configuration not set. Please configure API settings first.');
    }
    return settingsStore.config.textConfig;
  }

  private getVisionConfig() {
    const settingsStore = useSettingsStore();
    if (!settingsStore.isVisionConfigured()) {
      throw new Error('Vision AI configuration not set. Please configure API settings first.');
    }
    return settingsStore.config.visionConfig;
  }

  /**
   * Router: select the best model profile for a given task type.
   * If routing is disabled, falls back to the legacy text/vision config.
   */
  private selectProfiles(taskType: TaskType | undefined, forceVision: boolean): { primary: ModelProfile; fallbacks: ModelProfile[]; timeoutMs: number } {
    const settingsStore = useSettingsStore();
    const config = settingsStore.config;

    // Vision tasks always use vision config when routing is off or not configured
    if (forceVision) {
      const visionCfg = this.getVisionConfig();
      const profile: ModelProfile = {
        id: 'vision-legacy',
        name: visionCfg.model,
        provider: visionCfg.provider,
        baseUrl: visionCfg.baseUrl,
        apiKey: visionCfg.apiKey,
        model: visionCfg.model,
        capabilities: ['text', 'vision'],
        maxContextLength: 128000,
        avgLatencyMs: 4000,
        costPer1kTokens: 0.015,
        enabled: true
      };
      return { primary: profile, fallbacks: [], timeoutMs: 30000 };
    }

    // Routing disabled: use text config as the only profile
    if (!config.routing.enabled || !taskType) {
      const textCfg = this.getTextConfig();
      const profile: ModelProfile = {
        id: 'text-legacy',
        name: textCfg.model,
        provider: textCfg.provider,
        baseUrl: textCfg.baseUrl,
        apiKey: textCfg.apiKey,
        model: textCfg.model,
        capabilities: ['text'],
        maxContextLength: 128000,
        avgLatencyMs: 2500,
        costPer1kTokens: 0.005,
        enabled: true
      };
      return { primary: profile, fallbacks: [], timeoutMs: 30000 };
    }

    // Find the routing rule for this task type
    const rule = config.routing.rules.find(r => r.taskType === taskType);
    if (!rule) {
      // No rule found, fallback to text config
      const textCfg = this.getTextConfig();
      const profile: ModelProfile = {
        id: 'text-legacy',
        name: textCfg.model,
        provider: textCfg.provider,
        baseUrl: textCfg.baseUrl,
        apiKey: textCfg.apiKey,
        model: textCfg.model,
        capabilities: ['text'],
        maxContextLength: 128000,
        avgLatencyMs: 2500,
        costPer1kTokens: 0.005,
        enabled: true
      };
      return { primary: profile, fallbacks: [], timeoutMs: 30000 };
    }

    // Filter to only profiles that are actually configured (have apiKey and baseUrl)
    const configuredProfiles = config.routing.profiles.filter(
      p => p.enabled && p.apiKey.trim() !== '' && p.baseUrl.trim() !== ''
    );

    const primary = configuredProfiles.find(p => p.id === rule.preferredModelId);
    const fallbacks = rule.fallbackModelIds
      .map(id => configuredProfiles.find(p => p.id === id))
      .filter((p): p is ModelProfile => p !== undefined);

    if (!primary) {
      // Preferred model not found or disabled, use first fallback
      if (fallbacks.length > 0) {
        return { primary: fallbacks[0], fallbacks: fallbacks.slice(1), timeoutMs: rule.timeoutMs };
      }
      // No profiles available, fallback to text config
      const textCfg = this.getTextConfig();
      const profile: ModelProfile = {
        id: 'text-legacy',
        name: textCfg.model,
        provider: textCfg.provider,
        baseUrl: textCfg.baseUrl,
        apiKey: textCfg.apiKey,
        model: textCfg.model,
        capabilities: ['text'],
        maxContextLength: 128000,
        avgLatencyMs: 2500,
        costPer1kTokens: 0.005,
        enabled: true
      };
      return { primary: profile, fallbacks: [], timeoutMs: rule.timeoutMs };
    }

    return { primary, fallbacks, timeoutMs: rule.timeoutMs };
  }

  private buildMetadata(profile: ModelProfile, latencyMs: number, inputTokens: number, outputTokens: number, isFallback: boolean, fallbackReason?: string): CallMetadata {
    const cost = (inputTokens + outputTokens) / 1000 * profile.costPer1kTokens;
    return {
      modelName: profile.name,
      latencyMs,
      estimatedCost: Math.round(cost * 1000) / 1000,
      isFallback,
      fallbackReason,
      inputTokens,
      outputTokens
    };
  }

  private async recordUsage(
    taskType: TaskType | undefined,
    metadata: CallMetadata,
    success: boolean
  ): Promise<void> {
    try {
      await saveUsageRecord({
        timestamp: Date.now(),
        taskType: taskType || 'chat',
        modelName: metadata.modelName,
        inputTokens: metadata.inputTokens,
        outputTokens: metadata.outputTokens,
        latencyMs: metadata.latencyMs,
        success,
        isFallback: metadata.isFallback,
        estimatedCost: metadata.estimatedCost
      });

      // Refresh usage stats so the UI panel stays up to date
      const usageStore = useUsageStore();
      usageStore.loadStats('today');
    } catch (e) {
      console.warn('[AI Router] Failed to save usage record:', e);
    }
  }

  private async doChatStream(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    profile: ModelProfile,
    doStream: boolean
  ): Promise<{ success: boolean; fullText: string; inputTokens: number; outputTokens: number }> {
    const requestUrl = this.resolveChatCompletionsUrl(profile.baseUrl);
    this.abortController = new AbortController();

    const tokenEstimate = estimateMessagesTokens(messages);
    let fullText = '';
    let outputTokens = 0;

    try {
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${profile.apiKey}`
        },
        body: JSON.stringify({
          model: profile.model,
          messages,
          stream: doStream
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (doStream) {
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        let buffer = ''; // Buffer for incomplete SSE lines across chunks

        while (true) {
          const { done, value } = await reader.read();

          // Flush buffer on stream end
          if (done) {
            if (buffer.trim()) {
              const line = buffer.trim();
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data !== '[DONE]') {
                  try {
                    const parsed = JSON.parse(data);
                    const token = parsed.choices?.[0]?.delta?.content;
                    if (token) {
                      fullText += token;
                      outputTokens += 1;
                      callbacks.onToken?.(token);
                    }
                  } catch (e) {
                    console.warn('Failed to parse SSE data:', e);
                  }
                }
              }
            }
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // Extract complete lines from buffer, keep the remainder
          let lineEnd: number;
          while ((lineEnd = buffer.indexOf('\n')) !== -1) {
            const line = buffer.slice(0, lineEnd).trim();
            buffer = buffer.slice(lineEnd + 1);

            if (!line || !line.startsWith('data: ')) continue;

            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const token = parsed.choices?.[0]?.delta?.content;
              if (token) {
                fullText += token;
                outputTokens += 1;
                callbacks.onToken?.(token);
              }
            } catch (e) {
              console.warn('Failed to parse SSE data:', e);
            }
          }
        }
      } else {
        const data = await response.json();
        fullText = data.choices?.[0]?.message?.content || '';
        outputTokens = Math.ceil(fullText.length / 4);
        callbacks.onToken?.(fullText);
      }

      return { success: true, fullText, inputTokens: tokenEstimate.input, outputTokens: outputTokens || tokenEstimate.output };
    } catch (error) {
      if ((error as Error).name === 'AbortError' || (error as Error).message?.includes('abort')) {
        const reason = this.isUserCancelled ? 'user' : 'timeout';
        callbacks.onInterrupted?.(fullText, reason);
        throw error;
      }
      throw error;
    }
  }

  async chatStream(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    useVision: boolean = false,
    taskType?: TaskType
  ): Promise<void> {
    const { primary, fallbacks, timeoutMs } = this.selectProfiles(taskType, useVision);
    const startTime = performance.now();
    const doStream = !useVision;

    callbacks.onStart?.();
    this.isUserCancelled = false;

    let isFallback = false;
    let fallbackReason: string | undefined;
    let lastError: Error | undefined;
    let profilesToTry = [primary, ...fallbacks];

    for (const profile of profilesToTry) {
      try {
        const timeoutId = setTimeout(() => {
          this.abortController?.abort();
        }, timeoutMs);

        const result = await this.doChatStream(messages, callbacks, profile, doStream);
        clearTimeout(timeoutId);

        const latencyMs = Math.round(performance.now() - startTime);
        const metadata = this.buildMetadata(profile, latencyMs, result.inputTokens, result.outputTokens, isFallback, fallbackReason);
        this.recordUsage(taskType, metadata, true);
        callbacks.onComplete?.(result.fullText, metadata);
        return;
      } catch (error) {
        if ((error as Error).name === 'AbortError' || (error as Error).message?.includes('abort')) {
          // User cancelled — onInterrupted was already fired inside doChatStream
          return;
        }
        lastError = error as Error;
        console.warn(`[AI Router] Model ${profile.name} failed:`, lastError.message);
        isFallback = true;
        fallbackReason = `首选模型 ${primary.name} 失败: ${lastError.message}`;
      }
    }

    // All profiles exhausted
    const latencyMs = Math.round(performance.now() - startTime);
    const metadata = this.buildMetadata(primary, latencyMs, 0, 0, isFallback, fallbackReason);
    this.recordUsage(taskType, metadata, false);
    const finalError = lastError || new Error('All models failed to respond');
    callbacks.onError?.(finalError, metadata);
    throw finalError;
  }

  async chatOnce(messages: ChatMessage[], useVision: boolean = false, taskType?: TaskType): Promise<{ text: string; metadata: CallMetadata }> {
    const { primary, fallbacks, timeoutMs } = this.selectProfiles(taskType, useVision);
    const startTime = performance.now();

    let isFallback = false;
    let fallbackReason: string | undefined;
    let lastError: Error | undefined;
    let profilesToTry = [primary, ...fallbacks];

    for (const profile of profilesToTry) {
      try {
        const requestUrl = this.resolveChatCompletionsUrl(profile.baseUrl);
        this.abortController = new AbortController();

        const timeoutId = setTimeout(() => {
          this.abortController?.abort();
        }, timeoutMs);

        const tokenEstimate = estimateMessagesTokens(messages);

        const response = await fetch(requestUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${profile.apiKey}`
          },
          body: JSON.stringify({
            model: profile.model,
            messages,
            stream: false
          }),
          signal: this.abortController.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`API request failed: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || '';
        const outputTokens = Math.ceil(text.length / 4);

        const latencyMs = Math.round(performance.now() - startTime);
        const metadata = this.buildMetadata(profile, latencyMs, tokenEstimate.input, outputTokens, isFallback, fallbackReason);
        this.recordUsage(taskType, metadata, true);
        return { text, metadata };
      } catch (error) {
        if ((error as Error).name === 'AbortError' || (error as Error).message?.includes('abort')) {
          throw error;
        }
        lastError = error as Error;
        console.warn(`[AI Router] Model ${profile.name} failed:`, lastError.message);
        isFallback = true;
        fallbackReason = `首选模型 ${primary.name} 失败: ${lastError.message}`;
      }
    }

    // All profiles exhausted - record failure
    const failLatencyMs = Math.round(performance.now() - startTime);
    const failMetadata = this.buildMetadata(primary, failLatencyMs, 0, 0, isFallback, fallbackReason);
    this.recordUsage(taskType, failMetadata, false);
    throw lastError || new Error('All models failed to respond');
  }
}

export const aiClient = new AIClient();
