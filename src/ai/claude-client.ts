import { CLAUDE_MAX_TOKENS } from '@shared/constants';
import { addTokenUsage } from '@/storage/settings-store';
import { base44 } from '@/api/base44Client';
import { getAccessToken } from '@base44/sdk';
import type { AIProvider, AIMessage, AIMessageContent, AIResponse } from './ai-types';

/** Base44 app id — must match base44Client. Used to construct the raw
 *  function URL for streaming requests (the SDK's `functions.invoke` buffers
 *  the whole response and can't expose the SSE stream). The `/api` prefix
 *  is what the SDK's axios client uses as its baseURL. */
const BASE44_APP_ID = '69a04516fd2be6e9fdd5fbde';
const BASE44_PROXY_URL = `https://base44.app/api/apps/${BASE44_APP_ID}/functions/claude-proxy`;

interface ClaudeResponse {
  content: Array<{ type: 'text'; text: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

function formatContentForClaude(content: AIMessageContent): string | Array<Record<string, unknown>> {
  if (typeof content === 'string') return content;

  return content.map((block) => {
    if (block.type === 'text') {
      return { type: 'text', text: block.text };
    }
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
  private model: string;

  constructor(_apiKey: string, model: string) {
    this.model = model;
  }

  async sendMessage(
    system: string,
    messages: AIMessage[],
    maxTokens: number = CLAUDE_MAX_TOKENS,
  ): Promise<string> {
    const data = await this.invokeProxy(system, messages, maxTokens);
    await addTokenUsage(data.usage.input_tokens, data.usage.output_tokens);
    return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('');
  }

  async sendMessageWithUsage(
    system: string,
    messages: AIMessage[],
    maxTokens: number = CLAUDE_MAX_TOKENS,
  ): Promise<AIResponse> {
    const data = await this.invokeProxy(system, messages, maxTokens);
    await addTokenUsage(data.usage.input_tokens, data.usage.output_tokens);
    return {
      text: data.content.filter((c) => c.type === 'text').map((c) => c.text).join(''),
      inputTokens: data.usage.input_tokens,
      outputTokens: data.usage.output_tokens,
    };
  }

  /**
   * Stream Claude's response token-by-token. Calls `onDelta` with each
   * incremental text chunk as it arrives from Anthropic. Resolves with the
   * full concatenated text when the stream completes. Used by the AI
   * explanation effect so the user sees text appearing instead of staring
   * at a skeleton for ~3 seconds.
   *
   * Bypasses `base44.functions.invoke` (which buffers the entire response
   * via axios) — instead does a raw fetch to the function URL with the
   * user's access token attached as a Bearer header. The proxy accepts
   * either that or Base44's service-role header.
   *
   * `signal` is an optional AbortSignal so the caller can cancel an
   * in-flight stream (e.g. user navigated to a different move).
   */
  async sendMessageStream(
    system: string,
    messages: AIMessage[],
    maxTokens: number,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<string> {
    const formattedMessages = messages.map((m) => ({
      role: m.role,
      content: formatContentForClaude(m.content),
    }));
    const payload = {
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: formattedMessages,
      stream: true,
    };

    const token = getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(BASE44_PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '');
      throw new Error(`Claude proxy stream error (${res.status}): ${text}`);
    }

    let full = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line. Each event is one or
      // more lines like `event: <name>` and `data: <json>`. We only care
      // about the `data:` lines — Anthropic's content_block_delta carries
      // the incremental text and message_start/message_delta carry usage.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of rawEvent.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payloadStr = line.slice(5).trim();
          if (!payloadStr || payloadStr === '[DONE]') continue;
          try {
            const evt = JSON.parse(payloadStr);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              const text = String(evt.delta.text ?? '');
              if (text) {
                full += text;
                onDelta(text);
              }
            } else if (evt.type === 'message_start' && evt.message?.usage) {
              inputTokens = evt.message.usage.input_tokens ?? 0;
              outputTokens = evt.message.usage.output_tokens ?? 0;
            } else if (evt.type === 'message_delta' && evt.usage) {
              outputTokens = evt.usage.output_tokens ?? outputTokens;
            }
          } catch {
            // ignore malformed SSE payloads
          }
        }
      }
    }

    if (inputTokens || outputTokens) {
      addTokenUsage(inputTokens, outputTokens).catch(() => { /* best-effort */ });
    }
    return full;
  }

  private async invokeProxy(
    system: string,
    messages: AIMessage[],
    maxTokens: number,
  ): Promise<ClaudeResponse> {
    const formattedMessages = messages.map((m) => ({
      role: m.role,
      content: formatContentForClaude(m.content),
    }));

    return await invokeClaudeProxyWithRetry({
      model: this.model,
      max_tokens: maxTokens,
      system,
      messages: formattedMessages,
    });
  }
}

async function invokeClaudeProxyWithRetry(
  payload: Record<string, unknown>,
  maxRetries: number = 3,
): Promise<ClaudeResponse> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await base44.functions.invoke('claude-proxy', payload);
      const data = (response?.data ?? response) as ClaudeResponse | { error?: string };
      if ('error' in data && data.error) {
        throw new Error(`Claude proxy error: ${data.error}`);
      }
      return data as ClaudeResponse;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastError = error;

      const status = extractStatus(err);
      const isRetryable = status === 429 || (status !== undefined && status >= 500);
      if (!isRetryable || attempt === maxRetries - 1) {
        throw new Error(`Claude proxy error${status ? ` (${status})` : ''}: ${error.message}`);
      }

      const delay = Math.pow(2, attempt) * 1000;
      await sleep(delay);
    }
  }

  throw lastError ?? new Error('Claude proxy request failed after retries');
}

function extractStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { status?: number } }).response;
    if (resp && typeof resp.status === 'number') return resp.status;
  }
  if (err && typeof err === 'object' && 'status' in err) {
    const s = (err as { status?: number }).status;
    if (typeof s === 'number') return s;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
