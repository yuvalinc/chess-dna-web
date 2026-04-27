import type { SkillDimensionId } from './patterns';
import { WeaknessTheme } from './patterns';

/* ────────────────────────────────────────────────────────────
 *  Affiliate App entity (stored in Base44)
 * ──────────────────────────────────────────────────────────── */

export interface AffiliateApp {
  id: string;
  name: string;
  logoUrl: string;
  description: string;
  url: string;
  /** Which skill dimensions this app helps improve */
  dimensions: SkillDimensionId[];
  /** Which weakness themes this app addresses */
  themes: WeaknessTheme[];
  /** Free-form tags for search/filtering */
  tags: string[];
  /** Manual sort order (lower = higher priority) */
  priority: number;
  /** Whether this app is shown to users */
  active: boolean;
  createdAt: number;
  updatedAt: number;
}
