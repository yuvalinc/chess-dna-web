export type BoardTheme = {
  light: string;
  dark: string;
  border?: string;
};

export const THEMES = {
  pinkBerry: { light: "#f3c7d3", dark: "#c98599", border: "#3a1a24" },
  monoSlate: { light: "#dadada", dark: "#7d7d7d", border: "#1a1a1a" },
  classicGreen: { light: "#eeeed2", dark: "#769656", border: "#2a3a1a" },
  brilliantGold: { light: "#f7e7a3", dark: "#caa14a", border: "#3a2a10" },
  noir: { light: "#3a3a3a", dark: "#1a1a1a", border: "#000000" },
} satisfies Record<string, BoardTheme>;

export type ThemeName = keyof typeof THEMES;
