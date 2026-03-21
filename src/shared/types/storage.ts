import type { AIProviderType } from '../../ai/ai-types';
import type { TimeClass } from './game';
import type { PodcastLength } from './podcast';

export interface UserSettings {
  // Claude
  claudeApiKey: string | null;
  claudeModel: string;
  // OpenAI
  openaiApiKey: string | null;
  openaiModel: string;
  // Gemini
  geminiApiKey: string | null;
  geminiModel: string;
  // Provider priority (first = preferred, fallback in order)
  aiProviderPriority: AIProviderType[];
  // Analysis
  analysisDepth: number;
  autoAnalyze: boolean;
  notificationsEnabled: boolean;
  chesscomUsername: string | null;
  windowSize: number;
  schemaVersion: number;
  // Game type filter -- null means "all"
  selectedTimeClass: TimeClass | null;
  // Onboarding journey tracking
  radarRevealedAt: number | null;
  patternsUnlockedAt: number | null;
  aiChoiceMade: boolean;
  guidedWalkthroughDone: boolean;
  bulkImportDone: boolean;
  onboardingGameIds: string[];
  onboardingTimeClass: string | null;
  friendUsernames: string[];
  // Appearance
  theme: 'dark' | 'light';
  boardTheme: string;
  // TTS (OpenAI)
  ttsVoiceA: string;
  ttsVoiceB: string;
  ttsModel: string;
  ttsLanguage: string;
  // Google Cloud Podcast API
  gcpProjectId: string | null;
  gcpOAuthClientId: string | null;
  gcpConnected: boolean;
  podcastLength: PodcastLength;
  audioProvider: 'auto' | 'podcast' | 'tts';
}

export const DEFAULT_SETTINGS: UserSettings = {
  claudeApiKey: null,
  claudeModel: 'claude-sonnet-4-20250514',
  openaiApiKey: null,
  openaiModel: 'gpt-4o',
  geminiApiKey: null,
  geminiModel: 'gemini-2.0-flash',
  aiProviderPriority: ['claude', 'openai', 'gemini'],
  analysisDepth: 18,
  autoAnalyze: true,
  notificationsEnabled: true,
  chesscomUsername: null,
  windowSize: 50,
  schemaVersion: 1,
  selectedTimeClass: null,
  radarRevealedAt: null,
  patternsUnlockedAt: null,
  aiChoiceMade: false,
  guidedWalkthroughDone: false,
  bulkImportDone: false,
  onboardingGameIds: [],
  onboardingTimeClass: null,
  friendUsernames: [],
  theme: 'dark',
  boardTheme: 'classic',
  ttsVoiceA: 'nova',
  ttsVoiceB: 'alloy',
  ttsModel: 'gpt-4o-mini-tts',
  ttsLanguage: 'English',
  gcpProjectId: null,
  gcpOAuthClientId: null,
  gcpConnected: false,
  podcastLength: 'STANDARD',
  audioProvider: 'auto',
};

export interface TokenUsage {
  totalInputTokens: number;
  totalOutputTokens: number;
  requestCount: number;
  lastReset: number;
}

export const DEFAULT_TOKEN_USAGE: TokenUsage = {
  totalInputTokens: 0,
  totalOutputTokens: 0,
  requestCount: 0,
  lastReset: Date.now(),
};
