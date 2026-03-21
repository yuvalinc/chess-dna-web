import { CLAUDE_API_BASE, CLAUDE_API_VERSION, CLAUDE_MAX_TOKENS } from '@shared/constants';
import { addTokenUsage } from '@/storage/settings-store';
import type { AIProvider, AIMessage, AIMessageContent } from './ai-types';

interface ClaudeResponse {
  content: Array<{ type: 'text'; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Convert our unified AIMessageContent to Claude's message content format.
 * - String → passed as-is (Claude accepts plain strings)
 * - Array of content blocks → mapped to Claude's format
 */
function formatContentForClaude(content: AIMessageContent): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;

  return content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
    // Image block → Claude's base64 image format
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: block.mediaType,
        data: block.base64Data,
      },
    };
  });
}

export class ClaudeClient implements AIProvider {
  readonly type = 'claude' as const;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async sendMessage(
    system: string,
    messages: AIMessage[],
    maxTokens: number = CLAUDE_MAX_TOKENS,
  ): Promise<string> {
    const formattedMessages = messages.map((m) => ({
      role: m.role,
      content: formatContentForClaude(m.content),
    }));

    const response = await this.fetchWithRetry(CLAUDE_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': CLAUDE_API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: maxTokens,
        system,
        messages: formattedMessages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errorText}`);
    }

    const data: ClaudeResponse = await response.json();

    // Track token usage
    await addTokenUsage(data.usage.input_tokens, data.usage.output_tokens);

    return data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');
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

    throw lastError ?? new Error('Request failed after retries');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
