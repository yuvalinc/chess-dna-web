import type { AIProvider, AIProviderType, AIProviderConfig, AIMessage } from './ai-types';
import { AllProvidersFailedError } from './ai-types';
import { ClaudeClient } from './claude-client';
import { OpenAIClient } from './openai-client';
import { GeminiClient } from './gemini-client';
import type { UserSettings } from '@shared/types/storage';
import { base44 } from '../api/base44Client';

/** Default priority if settings don't have it (migration from old schema) */
const DEFAULT_PRIORITY: AIProviderType[] = ['claude', 'openai', 'gemini'];

/** Fix known invalid model names from old settings */
function fixModelName(model: string): string {
  // claude-haiku-4-20250514 was never a real model; map to correct Haiku 4.5
  if (model === 'claude-haiku-4-20250514') return 'claude-haiku-4-5-20251001';
  return model;
}

/**
 * Create a concrete AIProvider from a config.
 */
function createProvider(config: AIProviderConfig): AIProvider {
  switch (config.type) {
    case 'claude':
      return new ClaudeClient(config.apiKey, config.model);
    case 'openai':
      return new OpenAIClient(config.apiKey, config.model);
    case 'gemini':
      return new GeminiClient(config.apiKey, config.model);
    default:
      throw new Error(`Unknown AI provider: ${config.type}`);
  }
}

/**
 * Get the ordered list of configured providers from user settings.
 * Returns providers in priority order — only those with valid API keys.
 */
export function getConfiguredProviders(settings: UserSettings): AIProviderConfig[] {
  const configs: AIProviderConfig[] = [];

  // Build in priority order (fallback for old settings without this field)
  const priority = Array.isArray(settings.aiProviderPriority)
    ? settings.aiProviderPriority
    : DEFAULT_PRIORITY;
  for (const providerType of priority) {
    switch (providerType) {
      case 'claude':
        if (settings.claudeApiKey) {
          configs.push({
            type: 'claude',
            apiKey: settings.claudeApiKey,
            model: fixModelName(settings.claudeModel),
          });
        }
        break;
      case 'openai':
        if (settings.openaiApiKey) {
          configs.push({
            type: 'openai',
            apiKey: settings.openaiApiKey,
            model: settings.openaiModel,
          });
        }
        break;
      case 'gemini':
        if (settings.geminiApiKey) {
          configs.push({
            type: 'gemini',
            apiKey: settings.geminiApiKey,
            model: settings.geminiModel,
          });
        }
        break;
    }
  }

  return configs;
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
      console.warn(`[Chess Tutor] Provider ${config.type} failed:`, error.message);
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
