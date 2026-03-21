import { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useSingletonEntity } from '../hooks/useEntity';
import type { UserSettings } from '@shared/types/storage';
import { DEFAULT_SETTINGS } from '@shared/types/storage';
import { useAuth } from '../contexts/AuthContext';

interface ThemeContextValue {
  theme: 'dark' | 'light';
  boardTheme: string;
  setTheme: (theme: 'dark' | 'light') => void;
  setBoardTheme: (boardTheme: string) => void;
  settings: UserSettings;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  settingsLoading: boolean;
  isAdmin: boolean | null; // null = still loading
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  boardTheme: 'classic',
  setTheme: () => {},
  setBoardTheme: () => {},
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => {},
  settingsLoading: true,
  isAdmin: null,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin, authResolved } = useAuth();

  // RLS handles user scoping server-side. null = still loading (skip), undefined = fetch without filter.
  const singletonUserId = authResolved ? undefined : null;

  const [rawSettings, updateSettings, loading] = useSingletonEntity<UserSettings & Record<string, unknown>>(
    'UserPreferences',
    DEFAULT_SETTINGS as UserSettings & Record<string, unknown>,
    undefined,
    undefined,
    singletonUserId,
  );

  // Inject fallback API keys from env vars when user has no personal key set
  const settings = useMemo(() => ({
    ...rawSettings,
    claudeApiKey: rawSettings.claudeApiKey || import.meta.env.VITE_FALLBACK_CLAUDE_KEY || null,
    openaiApiKey: rawSettings.openaiApiKey || import.meta.env.VITE_FALLBACK_OPENAI_KEY || null,
  }), [rawSettings]);

  const theme = settings.theme ?? 'dark';
  const boardTheme = settings.boardTheme ?? 'classic';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setTheme = useCallback((t: 'dark' | 'light') => {
    updateSettings({ theme: t });
  }, [updateSettings]);

  const setBoardTheme = useCallback((bt: string) => {
    updateSettings({ boardTheme: bt });
  }, [updateSettings]);

  const contextValue = useMemo(() => ({
    theme,
    boardTheme,
    setTheme,
    setBoardTheme,
    settings,
    updateSettings,
    settingsLoading: loading,
    isAdmin,
  }), [theme, boardTheme, setTheme, setBoardTheme, settings, updateSettings, loading, isAdmin]);

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
