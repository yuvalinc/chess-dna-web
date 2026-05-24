import { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useSmartSingletonEntity } from '../hooks/useEntity';
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
  boardTheme: 'green',
  setTheme: () => {},
  setBoardTheme: () => {},
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => {},
  settingsLoading: true,
  isAdmin: null,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { isAdmin, userId } = useAuth();

  const [rawSettings, updateSettings, loading] = useSmartSingletonEntity<UserSettings & Record<string, unknown>>(
    'UserPreferences',
    DEFAULT_SETTINGS as UserSettings & Record<string, unknown>,
    undefined,
    undefined,
    userId,
  );

  // Claude calls go through the Base44 `claude-proxy` function; the key lives
  // server-side as a Base44 secret. The placeholder values below keep the
  // existing UserSettings shape valid for stored records without leaking
  // anything into the public bundle.
  const settings = useMemo(() => ({
    ...rawSettings,
    claudeApiKey: 'base44-proxy',
    openaiApiKey: null,
  }), [rawSettings]);

  const theme = settings.theme ?? 'dark';
  const boardTheme = settings.boardTheme ?? 'green';

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
