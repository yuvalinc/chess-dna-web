import React, { useEffect } from 'react';
import { useTheme } from './ThemeContext';
import { I18nContext, useI18nProvider, type LanguageCode } from '../i18n/index';

const LANG_STORAGE_KEY = 'chess-dna-language';

/** Read persisted language from localStorage */
function getPersistedLanguage(): LanguageCode | undefined {
  try {
    const val = localStorage.getItem(LANG_STORAGE_KEY);
    if (val === 'en' || val === 'he' || val === 'es') return val;
  } catch { /* ignore */ }
  return undefined;
}

/**
 * Reads language from ThemeProvider settings (with localStorage fallback)
 * and provides i18n context to children.
 * Must be nested inside ThemeProvider.
 */
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useTheme();
  const settingsLang = (settings as unknown as Record<string, unknown>).language as LanguageCode | undefined;
  // Use settings language if set, otherwise fall back to localStorage
  const languageCode = settingsLang || getPersistedLanguage() || 'en';
  const value = useI18nProvider(languageCode);

  // Persist language to localStorage whenever it changes
  useEffect(() => {
    if (languageCode) {
      try { localStorage.setItem(LANG_STORAGE_KEY, languageCode); } catch { /* ignore */ }
    }
  }, [languageCode]);

  return React.createElement(I18nContext.Provider, { value }, children);
}
