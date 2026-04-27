import { useMemo } from 'react';
import { useAffiliateApps, rankAppsForContext } from '@/hooks/useAffiliateApps';
import type { SkillDimensionId } from '@shared/types/patterns';
import { WeaknessTheme } from '@shared/types/patterns';

interface AffiliateRecommendationsProps {
  dimensionId?: SkillDimensionId;
  theme?: WeaknessTheme;
  /** Label shown in the header */
  contextLabel?: string;
  onClose: () => void;
}

export default function AffiliateRecommendations({
  dimensionId,
  theme,
  contextLabel,
  onClose,
}: AffiliateRecommendationsProps) {
  const { apps, loading } = useAffiliateApps();

  const ranked = useMemo(
    () => rankAppsForContext(apps, dimensionId, theme),
    [apps, dimensionId, theme],
  );

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-chess-surface rounded-2xl border border-chess-border/30 shadow-2xl w-full max-w-md mx-4 max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-chess-border/20">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-chess-text">
              Best apps to improve{contextLabel ? ` your ${contextLabel}` : ''}
            </h2>
            <button onClick={onClose} className="text-chess-text-secondary hover:text-chess-text text-lg">
              ×
            </button>
          </div>
          <p className="text-[10px] text-chess-text-secondary mt-0.5">
            Ranked by match to your specific areas for improvement
          </p>
        </div>

        {/* App list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="text-center py-8 text-chess-text-secondary text-sm">Loading recommendations...</div>
          ) : ranked.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-chess-text-secondary text-sm">No recommendations available yet.</p>
              <p className="text-chess-text-disabled text-xs mt-1">Check back soon!</p>
            </div>
          ) : (
            ranked.map((app) => (
              <div
                key={app.id}
                className="bg-chess-overlay rounded-xl p-3 flex items-start gap-3 hover:bg-chess-overlay/80 transition-colors"
              >
                {app.logoUrl ? (
                  <img src={app.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-chess-muted/40 flex items-center justify-center text-lg flex-shrink-0">
                    {app.name[0]?.toUpperCase() ?? '?'}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-chess-text">{app.name}</span>
                    {app.matchScore > 0 && (
                      <span className="text-[9px] bg-chess-accent/15 text-chess-accent px-1.5 py-0.5 rounded-full font-semibold">
                        {app.matchScore}% match
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-chess-text-secondary mt-0.5 line-clamp-2">{app.description}</p>
                </div>

                <a
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 bg-chess-accent text-black text-[10px] font-semibold px-3 py-1.5 rounded-lg hover:bg-chess-accent/80 transition-colors"
                >
                  Open
                </a>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
