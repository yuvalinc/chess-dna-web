/**
 * Settings store — adapted for Base44 entities.
 * Replaces Chrome extension's storageGet/storageSet with Base44 SDK.
 */
import { base44 } from '../api/base44Client';
import type { UserSettings, TokenUsage } from '@shared/types/storage';
import { DEFAULT_SETTINGS, DEFAULT_TOKEN_USAGE } from '@shared/types/storage';

let _cachedSettings: UserSettings | null = null;
let _settingsId: string | null = null;

export async function getSettings(): Promise<UserSettings> {
  if (_cachedSettings) return _cachedSettings;

  try {
    // RLS handles user scoping server-side
    const list = await (base44.entities as any).UserPreferences.list();
    if (Array.isArray(list) && list.length > 0) {
      _settingsId = list[0].id;
      _cachedSettings = { ...DEFAULT_SETTINGS, ...list[0] } as UserSettings;
      return _cachedSettings;
    }
  } catch {
    // Fall through to defaults
  }
  return DEFAULT_SETTINGS;
}

export async function updateSettings(partial: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getSettings();
  const updated = { ...current, ...partial };
  _cachedSettings = updated;

  try {
    if (_settingsId) {
      await (base44.entities as any).UserPreferences.update(_settingsId, partial);
    }
  } catch (err) {
    console.error('[settings-store] Failed to update:', err);
  }
  return updated;
}

// Token usage tracking — persisted to localStorage so data survives page reloads
const TOKEN_USAGE_KEY = 'chess-dna-token-usage';

function loadTokenUsage(): TokenUsage {
  try {
    const stored = localStorage.getItem(TOKEN_USAGE_KEY);
    if (stored) {
      return { ...DEFAULT_TOKEN_USAGE, ...JSON.parse(stored) };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_TOKEN_USAGE };
}

let _tokenUsage: TokenUsage = loadTokenUsage();

export async function getTokenUsage(): Promise<TokenUsage> {
  return _tokenUsage;
}

export async function addTokenUsage(inputTokens: number, outputTokens: number): Promise<void> {
  _tokenUsage = {
    totalInputTokens: _tokenUsage.totalInputTokens + inputTokens,
    totalOutputTokens: _tokenUsage.totalOutputTokens + outputTokens,
    requestCount: _tokenUsage.requestCount + 1,
    lastReset: _tokenUsage.lastReset,
  };
  try {
    localStorage.setItem(TOKEN_USAGE_KEY, JSON.stringify(_tokenUsage));
  } catch {
    // localStorage might be full; silently ignore
  }
}

export async function resetTokenUsage(): Promise<void> {
  _tokenUsage = { ...DEFAULT_TOKEN_USAGE, lastReset: Date.now() };
  try {
    localStorage.setItem(TOKEN_USAGE_KEY, JSON.stringify(_tokenUsage));
  } catch {
    // Silently ignore
  }
}
