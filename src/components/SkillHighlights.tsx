/* SkillHighlights — three small cards under the radar:
 *   Strongest  → highest-scoring dimension
 *   Weakness   → lowest-scoring dimension
 *   Improving  → dimension with the largest positive delta
 *                between the older half and recent half of analyses.
 *                Falls back to the second-strongest dimension when
 *                there isn't enough data to detect a trend.
 */
import { useMemo } from 'react';
import type { SkillProfile, SkillDimension } from '@shared/types/patterns';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import {
  calculateSkillProfile,
  getStrongestDimensions,
  getWeakestDimensions,
} from '@/patterns/skill-calculator';
import { useT } from '@/i18n/index';
import type { TranslationKey } from '@/i18n/locales/en';

const SKILL_LABEL_KEYS: Record<string, TranslationKey> = {
  openings: 'skill_openings',
  tactics: 'skill_tactics',
  defense: 'skill_defense',
  positional: 'skill_positional',
  endgame: 'skill_endgame',
  calculation: 'skill_calculation',
  time_management: 'skill_time_management',
  resilience: 'skill_resilience',
};

interface SkillHighlightsProps {
  profile: SkillProfile;
  games: GameRecord[];
  analyses: GameAnalysis[];
}

export default function SkillHighlights({ profile, games, analyses }: SkillHighlightsProps) {
  const { t } = useT();

  const { strongest, weakness, improving } = useMemo(() => {
    const strongest = getStrongestDimensions(profile, 1)[0] ?? null;
    const weakness = getWeakestDimensions(profile, 1)[0] ?? null;

    let improving: SkillDimension | null = null;

    // Need at least 6 dated analyses to split into older/recent halves.
    if (analyses.length >= 6 && games.length >= 6) {
      const gameById = new Map(games.map((g) => [g.id, g]));
      const dated = analyses
        .map((a) => ({ a, t: gameById.get(a.gameId)?.playedAt ?? 0 }))
        .filter((x) => x.t > 0)
        .sort((a, b) => a.t - b.t);

      if (dated.length >= 6) {
        const mid = Math.floor(dated.length / 2);
        const olderA = dated.slice(0, mid).map((x) => x.a);
        const recentA = dated.slice(mid).map((x) => x.a);
        const olderIds = new Set(olderA.map((x) => x.gameId));
        const recentIds = new Set(recentA.map((x) => x.gameId));
        const olderG = games.filter((g) => olderIds.has(g.id));
        const recentG = games.filter((g) => recentIds.has(g.id));

        const olderProfile = calculateSkillProfile(null, olderG, olderA);
        const recentProfile = calculateSkillProfile(null, recentG, recentA);

        const ranked = profile.dimensions
          .map((d) => {
            const recent = recentProfile.dimensions.find((x) => x.id === d.id)?.score ?? d.score;
            const older = olderProfile.dimensions.find((x) => x.id === d.id)?.score ?? d.score;
            return { dim: d, delta: recent - older };
          })
          .sort((a, b) => b.delta - a.delta);

        if (ranked[0] && ranked[0].delta > 0) improving = ranked[0].dim;
      }
    }

    // Fallback: if no real "improving" signal, surface the second-strongest dim.
    if (!improving) {
      const top2 = getStrongestDimensions(profile, 2);
      improving = top2[1] ?? top2[0] ?? null;
    }

    return { strongest, weakness, improving };
  }, [profile, games, analyses]);

  if (!strongest || !weakness || !improving) return null;

  const dimLabel = (id: string, fallback: string): string => {
    const key = SKILL_LABEL_KEYS[id];
    return key ? t(key) : fallback;
  };

  const Card = ({
    icon,
    iconColor,
    title,
    dim,
  }: {
    icon: React.ReactNode;
    iconColor: string;
    title: string;
    dim: SkillDimension;
  }) => {
    return (
      <div
        className="bg-chess-surface rounded-xl border border-chess-border/20 p-3 min-w-0"
        title={title}
        aria-label={`${title}: ${dimLabel(dim.id, dim.label)} ${dim.score}`}
      >
        <div style={{ color: iconColor }} aria-hidden="true">
          {icon}
        </div>
        <div className="mt-1.5 text-[13px] font-semibold text-chess-text leading-tight break-words">
          {dimLabel(dim.id, dim.label)}
        </div>
        <div className="mt-0.5 text-2xl font-extrabold tabular-nums leading-none text-chess-text">
          {dim.score}
        </div>
      </div>
    );
  };

  // Stroke-only geometric SVGs in the same style as the bottom-nav icons
  // (strokeWidth 1.8, no fill, square viewBox).
  const ICON_PROPS = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  // Star — Strongest
  const StarIcon = (
    <svg {...ICON_PROPS}>
      <polygon points="12 2 15 9 22 9 17 14 19 22 12 18 5 22 7 14 2 9 9 9 12 2" />
    </svg>
  );

  // Alert triangle — Weakness
  const AlertIcon = (
    <svg {...ICON_PROPS}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );

  // Trending-up — Improving
  const TrendingUpIcon = (
    <svg {...ICON_PROPS}>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="14 7 21 7 21 14" />
    </svg>
  );

  return (
    <div className="grid grid-cols-3 gap-2 mt-3">
      <Card
        icon={StarIcon}
        iconColor="#facc15" /* amber */
        title={t('highlight_strongest')}
        dim={strongest}
      />
      <Card
        icon={AlertIcon}
        iconColor="#f87171" /* red */
        title={t('highlight_weakness')}
        dim={weakness}
      />
      <Card
        icon={TrendingUpIcon}
        iconColor="#4ade80" /* green */
        title={t('highlight_improving')}
        dim={improving}
      />
    </div>
  );
}
