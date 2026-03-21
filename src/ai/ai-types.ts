/**
 * Unified AI provider types.
 * All providers conform to the same message interface.
 */

export type AIProviderType = 'claude' | 'openai' | 'gemini';

/** Text content block in a multimodal message */
export interface AITextContent {
  type: 'text';
  text: string;
}

/** Image content block in a multimodal message */
export interface AIImageContent {
  type: 'image';
  mediaType: string;   // e.g. 'image/png', 'image/jpeg'
  base64Data: string;  // base64-encoded image data (no data: prefix)
}

/** Message content can be a plain string (backward compat) or an array of content blocks */
export type AIMessageContent = string | Array<AITextContent | AIImageContent>;

export interface AIMessage {
  role: 'user' | 'assistant';
  content: AIMessageContent;
}

/**
 * Every AI provider implements this interface.
 */
export interface AIProvider {
  readonly type: AIProviderType;
  sendMessage(
    system: string,
    messages: AIMessage[],
    maxTokens?: number,
  ): Promise<string>;
}

/**
 * Configuration for a single provider.
 */
export interface AIProviderConfig {
  type: AIProviderType;
  apiKey: string;
  model: string;
}

/**
 * Error thrown when all providers fail.
 */
export class AllProvidersFailedError extends Error {
  public readonly errors: Array<{ provider: AIProviderType; error: Error }>;

  constructor(errors: Array<{ provider: AIProviderType; error: Error }>) {
    const summary = errors
      .map((e) => `${e.provider}: ${e.error.message}`)
      .join('; ');
    super(`All AI providers failed — ${summary}`);
    this.name = 'AllProvidersFailedError';
    this.errors = errors;
  }
}
