import { OPENAI_API_BASE, OPENAI_MAX_TOKENS } from '@shared/constants';
import { addTokenUsage } from '@/storage/settings-store';
import type { AIProvider, AIMessage, AIMessageContent, AIResponse } from './ai-types';

interface OpenAIResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Convert our unified AIMessageContent to OpenAI's message content format.
 * - String → passed as-is
 * - Array of content blocks → mapped to OpenAI's format
 */
function formatContentForOpenAI(content: AIMessageContent): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;

  return content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    // Image block → OpenAI's image_url format with data URI
    return {
      type: 'image_url',
      image_url: {
        url: `data:${block.mediaType};base64,${block.base64Data}`,
      },
    };
  });
}

export class OpenAIClient implements AIProvider {
  readonly type = 'openai' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(
    system: string,
    messages: AIMessage[],
    maxTokens: number = OPENAI_MAX_TOKENS,
  ): Promise<string> {
    // Convert to OpenAI format: system message + user/assistant messages
    const openaiMessages = [
      { role: 'system' as const, content: system },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: formatContentForOpenAI(m.content),
      })),
    ];

    const response = await this.fetchWithRetry(OPENAI_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: openaiMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data: OpenAIResponse = await response.json();

    // Track token usage (shared tracker)
    if (data.usage) {
      await addTokenUsage(data.usage.prompt_tokens, data.usage.completion_tokens);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty response');
    }

    return content;
  }

  async sendMessageWithUsage(
    system: string,
    messages: AIMessage[],
    maxTokens: number = OPENAI_MAX_TOKENS,
  ): Promise<AIResponse> {
    const openaiMessages = [
      { role: 'system' as const, content: system },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: formatContentForOpenAI(m.content),
      })),
    ];

    const response = await this.fetchWithRetry(OPENAI_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        messages: openaiMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
    }

    const data: OpenAIResponse = await response.json();
    const inputTokens = data.usage?.prompt_tokens ?? 0;
    const outputTokens = data.usage?.completion_tokens ?? 0;
    if (data.usage) {
      await addTokenUsage(inputTokens, outputTokens);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('OpenAI returned empty response');

    return { text: content, inputTokens, outputTokens };
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
        if (attempt < maxRetries - 1) {
          await sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    throw lastError ?? new Error('OpenAI request failed after retries');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
