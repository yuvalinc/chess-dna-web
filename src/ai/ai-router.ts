import type { AIProvider, AIProviderType, AIProviderConfig, AIMessage } from './ai-types';
import { AllProvidersFailedError } from './ai-types';
import { ClaudeClient } from './claude-client';
import type { UserSettings } from '@shared/types/storage';
import { base44 } from '../api/base44Client';

function fixModelName(model: string): string {
  if (model === 'claude-haiku-4-20250514') return 'claude-haiku-4-5-20251001';
  return model;
}

export function createProvider(config: AIProviderConfig): AIProvider {
  if (config.type !== 'claude') {
    throw new Error(`Only the Claude provider is supported (got: ${config.type})`);
  }
  return new ClaudeClient(config.apiKey, config.model);
}

/**
 * Returns the Claude provider config (the only supported one).
 * Claude calls are proxied through the Base44 `claude-proxy` function — the
 * API key lives server-side as the CLAUDE_API_KEY Base44 secret.
 */
export function getConfiguredProviders(settings: UserSettings): AIProviderConfig[] {
  if (!settings.claudeApiKey) return [];
  return [{
    type: 'claude',
    apiKey: settings.claudeApiKey,
    model: fixModelName(settings.claudeModel),
  }];
}

/**
 * Check if at least one AI provider is configured.
 */
export function hasAnyProvider(settings: UserSettings): boolean {
  return getConfiguredProviders(settings).length > 0;
}

/**
 * Send a message using the AI router.
 * Tries providers in priority order; falls back to the next on failure.
 */
export async function sendWithFallback(
  settings: UserSettings,
  system: string,
  messages: AIMessage[],
  maxTokens?: number,
): Promise<string> {
  const configs = getConfiguredProviders(settings);

  if (configs.length === 0) {
    throw new Error('No AI providers configured. Add at least one API key in Settings.');
  }

  const errors: Array<{ provider: AIProviderType; error: Error }> = [];

  for (const config of configs) {
    try {
      const provider = createProvider(config);
      console.log(`[Chess Tutor] Trying AI provider: ${config.type} (${config.model})`);
      const result = await provider.sendMessage(system, messages, maxTokens);
      // Track AI usage for analytics
      try {
        base44.analytics?.track({
          eventName: 'ai_request',
          properties: { provider: config.type, model: config.model },
        });
      } catch { /* analytics tracking is best-effort */ }
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[Chess Tutor] Provider ${config.type} failed:`, error.message);
      errors.push({ provider: config.type, error });

      // Don't fallback on auth errors for remaining providers if they'd have the same issue
      // But DO fallback to other providers since they use different keys
      continue;
    }
  }

  throw new AllProvidersFailedError(errors);
}

/**
 * Convenience: create a single provider from settings (first available).
 * Used when you need a provider object rather than the fallback chain.
 */
export function createProviderFromSettings(settings: UserSettings): AIProvider | null {
  const configs = getConfiguredProviders(settings);
  if (configs.length === 0) return null;
  return createProvider(configs[0]);
}

/**
 * Streaming variant of `sendWithFallback`. Calls `onDelta` with each
 * incremental text chunk; resolves with the full text when the stream
 * completes. `signal` lets the caller cancel in-flight requests (e.g.
 * when the user navigates to a different move mid-stream).
 *
 * Only Claude supports streaming through this codebase right now — the
 * fallback chain is single-provider, so this just unwraps the first config.
 */
export async function sendWithFallbackStream(
  settings: UserSettings,
  system: string,
  messages: AIMessage[],
  maxTokens: number,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const configs = getConfiguredProviders(settings);
  if (configs.length === 0) {
    throw new Error('No AI providers configured.');
  }
  const provider = createProvider(configs[0]);
  if (!(provider instanceof ClaudeClient)) {
    throw new Error('Streaming requires the Claude provider.');
  }
  return await provider.sendMessageStream(system, messages, maxTokens, onDelta, signal);
}
