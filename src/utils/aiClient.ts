import { useSettingsStore } from '../stores/settings';

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

export interface StreamCallbacks {
  onStart?: () => void;
  onToken?: (token: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: Error) => void;
}

export class AIClient {
  private getTextConfig() {
    const settingsStore = useSettingsStore();
    if (!settingsStore.isTextConfigured()) {
      throw new Error('Text AI configuration not set. Please configure API settings first.');
    }
    return settingsStore.config.textConfig;
  }

  private getVisionConfig() {
    const settingsStore = useSettingsStore();
    console.log('[getVisionConfig] Called, visionConfig:', JSON.stringify(settingsStore.config.visionConfig));
    if (!settingsStore.isVisionConfigured()) {
      throw new Error('Vision AI configuration not set. Please configure API settings first.');
    }
    return settingsStore.config.visionConfig;
  }

  async chatStream(
    messages: ChatMessage[],
    callbacks: StreamCallbacks,
    useVision: boolean = false
  ): Promise<void> {
    const config = useVision ? this.getVisionConfig() : this.getTextConfig();

    callbacks.onStart?.();

    try {
      // Vision models often don't support streaming well, so use stream: false for vision
      const doStream = !useVision;

      const requestBody = {
        model: config.model,
        messages,
        stream: doStream
      };

      console.log('[Vision Request]', {
        url: config.baseUrl,
        model: config.model,
        useVision,
        messageCount: messages.length,
        firstMessageHasImages: Array.isArray(messages[0]?.content) &&
          messages[0].content.some((c: any) => c.type === 'image_url')
      });

      const response = await fetch(`${config.baseUrl}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Vision API Error]', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
          url: config.baseUrl,
          model: config.model
        });
        throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (doStream) {
        // Handle streaming response (SSE format)
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(line => line.trim() !== '');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;

              try {
                const parsed = JSON.parse(data);
                const token = parsed.choices?.[0]?.delta?.content;

                if (token) {
                  fullText += token;
                  callbacks.onToken?.(token);
                }
              } catch (e) {
                console.warn('Failed to parse SSE data:', e);
              }
            }
          }
        }

        callbacks.onComplete?.(fullText);
      } else {
        // Handle non-streaming response (JSON format)
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '';
        callbacks.onToken?.(content);
        callbacks.onComplete?.(content);
      }
    } catch (error) {
      callbacks.onError?.(error as Error);
      throw error;
    }
  }

  async chatOnce(messages: ChatMessage[], useVision: boolean = false): Promise<string> {
    const config = useVision ? this.getVisionConfig() : this.getTextConfig();

    const response = await fetch(`${config.baseUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

export const aiClient = new AIClient();