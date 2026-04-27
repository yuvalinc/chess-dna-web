import { GEMINI_API_BASE, GEMINI_MAX_TOKENS } from '@shared/constants';
import { addTokenUsage } from '@/storage/settings-store';
import type { AIProvider, AIMessage, AIMessageContent, AIResponse } from './ai-types';

interface GeminiResponse {
  candidates: Array<{
    content: { parts: Array<{ text: string }>; role: string };
    finishReason: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

/**
 * Convert our unified AIMessageContent to Gemini's parts format.
 * - String → [{ text }]
 * - Array of content blocks → mapped to Gemini parts
 */
function formatPartsForGemini(content: AIMessageContent): Array<Record<string, unknown>> {
  if (typeof content === 'string') {
    return [{ text: content }];
  }

  return content.map((block) => {
    if (block.type === 'text') {
      return { text: block.text };
    }
    // Image block → Gemini's inlineData format
    return {
      inlineData: {
        mimeType: block.mediaType,
        data: block.base64Data,
      },
    };
  });
}

export class GeminiClient implements AIProvider {
  readonly type = 'gemini' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(
    system: string,
    messages: AIMessage[],
    maxTokens: number = GEMINI_MAX_TOKENS,
  ): Promise<string> {
    // Gemini uses a different format:
    // - systemInstruction for system prompt
    // - contents[] with role: "user" | "model"
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: formatPartsForGemini(m.content),
    }));

    const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: system }],
        },
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data: GeminiResponse = await response.json();

    // Track token usage
    if (data.usageMetadata) {
      await addTokenUsage(
        data.usageMetadata.promptTokenCount ?? 0,
        data.usageMetadata.candidatesTokenCount ?? 0,
      );
    }

    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join('');

    if (!text) {
      throw new Error('Gemini returned empty response');
    }

    return text;
  }

  async sendMessageWithUsage(
    system: string,
    messages: AIMessage[],
    maxTokens: number = GEMINI_MAX_TOKENS,
  ): Promise<AIResponse> {
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: formatPartsForGemini(m.content),
    }));

    const url = `${GEMINI_API_BASE}/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error ${response.status}: ${errorText}`);
    }

    const data: GeminiResponse = await response.json();
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount ?? 0;
    if (data.usageMetadata) {
      await addTokenUsage(inputTokens, outputTokens);
    }

    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('');
    if (!text) throw new Error('Gemini returned empty response');

    return { text, inputTokens, outputTokens };
  }

  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries: number = 3,
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        // Retry on rate limit or server errors
        if (response.status === 429 || response.status >= 500) {
          const errBody = await response.text().catch(() => '');
          lastError = new Error(`HTTP ${response.status}: ${errBody.slice(0, 200)}`);
          console.warn(`[Gemini] Attempt ${attempt + 1}/${maxRetries} got ${response.status} for ${this.model}:`, errBody.slice(0, 200));
          const retryAfter = response.headers.get('retry-after');
          const delay = retryAfter
            ? parseInt(retryAfter, 10) * 1000
            : Math.pow(2, attempt) * 1000;
          await sleep(delay);
          continue;
        }

        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.warn(`[Gemini] Attempt ${attempt + 1}/${maxRetries} failed for ${this.model}:`, lastError.message);
        if (attempt < maxRetries - 1) {
          await sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw new Error(`Gemini ${this.model}: ${lastError?.message ?? 'request failed after retries'}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
