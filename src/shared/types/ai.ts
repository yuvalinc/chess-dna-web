import type { WeaknessTheme } from './patterns';

export interface Insight {
  id: string;
  generatedAt: number;
  gameIds: string[];
  text: string;
  themes: WeaknessTheme[];
  priority: 'high' | 'medium' | 'low';
  isRead: boolean;
}
