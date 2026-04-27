import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { en, type Translations, type TranslationKey } from './locales/en';

/* ────────────────────────────────────────────────────────────
 *  Lightweight i18n — no dependencies.
 *  - English is the fallback (always loaded synchronously)
 *  - Other locales are dynamically imported on demand
 *  - `useT()` hook returns t(key) function + metadata
 * ──────────────────────────────────────────────────────────── */

export type LanguageCode = 'en' | 'he' | 'es';

export interface SupportedLanguage {
  code: LanguageCode;
  label: string;        // Native name shown in picker
  englishLabel: string;  // English name
  isRTL: boolean;
  ttsName: string;       // Full name for TTS/AI prompts
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', label: 'English', englishLabel: 'English', isRTL: false, ttsName: 'English' },
  { code: 'he', label: 'עברית', englishLabel: 'Hebrew', isRTL: true, ttsName: 'Hebrew' },
  { code: 'es', label: 'Español', englishLabel: 'Spanish', isRTL: false, ttsName: 'Spanish' },
];

/** Simple template interpolation: t('key', { count: 5 }) replaces {count} → 5 */
function interpolate(str: string, params?: Record<string, string | number>): string {
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
}

// ── Context ──

interface I18nContextValue {
  /** Translate a key, with optional interpolation params */
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  /** Current language code */
  language: LanguageCode;
  /** Whether current language is RTL */
  isRTL: boolean;
  /** Full language name for AI/TTS prompts */
  ttsLanguageName: string;
  /** All supported languages */
  languages: SupportedLanguage[];
}

const I18nContext = createContext<I18nContextValue>({
  t: (key) => en[key],
  language: 'en',
  isRTL: false,
  ttsLanguageName: 'English',
  languages: SUPPORTED_LANGUAGES,
});

export function useT() {
  return useContext(I18nContext);
}

// ── Provider (used in App.tsx, wraps children) ──
// NOTE: This is exported as a plain function that returns context value,
// not as a React component — the actual Provider JSX is in App.tsx
// to avoid circular import issues with React.createElement.

export function useI18nProvider(languageCode: LanguageCode | undefined): I18nContextValue {
  const lang = languageCode ?? 'en';
  const [translations, setTranslations] = useState<Translations>(en);
  const [loadedLang, setLoadedLang] = useState<LanguageCode>('en');

  useEffect(() => {
    if (lang === 'en') {
      setTranslations(en);
      setLoadedLang('en');
      document.documentElement.dir = 'ltr';
      return;
    }

    // Dynamic import for non-English locales
    const loaders: Record<string, () => Promise<{ default: Translations }>> = {
      he: () => import('./locales/he').then(m => ({ default: m.he as unknown as Translations })),
      es: () => import('./locales/es').then(m => ({ default: m.es as unknown as Translations })),
    };

    const loader = loaders[lang];
    if (!loader) {
      setTranslations(en);
      setLoadedLang('en');
      return;
    }

    loader()
      .then(({ default: locale }) => {
        setTranslations(locale);
        setLoadedLang(lang);
      })
      .catch(() => {
        console.warn(`[i18n] Failed to load locale "${lang}", falling back to English`);
        setTranslations(en);
        setLoadedLang('en');
      });

    // Set RTL
    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === lang);
    document.documentElement.dir = langInfo?.isRTL ? 'rtl' : 'ltr';
  }, [lang]);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>): string => {
      const value = translations[key] ?? en[key] ?? key;
      return interpolate(value, params);
    },
    [translations],
  );

  return useMemo(() => {
    const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === lang) ?? SUPPORTED_LANGUAGES[0];
    return {
      t,
      language: loadedLang,
      isRTL: langInfo.isRTL,
      ttsLanguageName: langInfo.ttsName,
      languages: SUPPORTED_LANGUAGES,
    };
  }, [t, lang, loadedLang]);
}

/** Translate a tier name using the t function */
export function translateTierName(tierId: string, t: (key: TranslationKey) => string): string {
  const map: Record<string, TranslationKey> = {
    pawn: 'tier_pawn', knight: 'tier_knight', bishop: 'tier_bishop',
    rook: 'tier_rook', queen: 'tier_queen', king: 'tier_king',
  };
  return map[tierId] ? t(map[tierId]) : tierId;
}

/** Translate a tier funTitle using the t function */
export function translateTierTitle(tierId: string, t: (key: TranslationKey) => string): string {
  const map: Record<string, TranslationKey> = {
    pawn: 'tier_pawn_title', knight: 'tier_knight_title', bishop: 'tier_bishop_title',
    rook: 'tier_rook_title', queen: 'tier_queen_title', king: 'tier_king_title',
  };
  return map[tierId] ? t(map[tierId]) : tierId;
}

export { I18nContext };
export type { TranslationKey, Translations };
