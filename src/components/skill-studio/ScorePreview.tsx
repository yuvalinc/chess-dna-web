import type { SkillProfile } from '@shared/types/patterns';

interface ScorePreviewProps {
  draftProfile: SkillProfile;
  publishedProfile: SkillProfile;
  selectedDimensionId: string | null;
  matchingMoves?: number;
  totalMoves?: number;
}

export default function ScorePreview({
  draftProfile,
  publishedProfile,
  selectedDimensionId,
  matchingMoves,
  totalMoves,
}: ScorePreviewProps) {
  return (
    <div className="p-3 space-y-4">
      {/* Overall scores */}
      <div className="flex gap-2">
        <div className="flex-1 bg-chess-overlay rounded-lg p-2 text-center">
          <div className="text-[8px] text-chess-text-disabled uppercase">Published</div>
          <div className="text-xl font-bold text-chess-text">{publishedProfile.overallRating}</div>
        </div>
        <div className="flex-1 bg-chess-overlay rounded-lg p-2 text-center border border-chess-accent/30">
          <div className="text-[8px] text-chess-accent uppercase">Draft</div>
          <div className="text-xl font-bold text-chess-accent">{draftProfile.overallRating}</div>
        </div>
        <div className="flex-1 bg-chess-overlay rounded-lg p-2 text-center">
          <div className="text-[8px] text-chess-text-disabled uppercase">Delta</div>
          <div className={`text-xl font-bold ${
            draftProfile.overallRating > publishedProfile.overallRating ? 'text-green-400' :
            draftProfile.overallRating < publishedProfile.overallRating ? 'text-red-400' :
            'text-chess-text-disabled'
          }`}>
            {draftProfile.overallRating - publishedProfile.overallRating >= 0 ? '+' : ''}
            {draftProfile.overallRating - publishedProfile.overallRating}
          </div>
        </div>
      </div>

      {/* Per-dimension table */}
      <div>
        <div className="flex text-[8px] text-chess-text-disabled uppercase tracking-wider pb-1 border-b border-chess-border/20">
          <span className="flex-1">Dimension</span>
          <span className="w-10 text-right">Pub</span>
          <span className="w-10 text-right">Draft</span>
          <span className="w-10 text-right">Δ</span>
        </div>
        {draftProfile.dimensions.map((dim, i) => {
          const pubDim = publishedProfile.dimensions[i];
          const delta = dim.score - (pubDim?.score ?? 0);
          const isSelected = dim.id === selectedDimensionId;
          return (
            <div
              key={dim.id}
              className={`flex items-center py-1.5 border-b border-chess-border/10 ${
                isSelected ? 'bg-chess-accent/5' : ''
              }`}
            >
              <span className={`flex-1 text-xs truncate ${isSelected ? 'text-chess-accent font-semibold' : 'text-chess-text-secondary'}`}>
                {dim.label}
              </span>
              <span className="w-10 text-right text-xs text-chess-text-disabled">{pubDim?.score ?? '-'}</span>
              <span className="w-10 text-right text-xs font-semibold text-chess-accent">{dim.score}</span>
              <span className={`w-10 text-right text-[10px] font-semibold ${
                delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-chess-text-disabled'
              }`}>
                {delta > 0 ? '+' : ''}{delta}
              </span>
            </div>
          );
        })}
      </div>

      {/* Selected dimension detail */}
      {selectedDimensionId && matchingMoves != null && (
        <div className="bg-chess-overlay/50 rounded-lg p-2.5">
          <div className="text-[9px] font-bold text-chess-text-secondary uppercase mb-1">
            {draftProfile.dimensions.find((d) => d.id === selectedDimensionId)?.label ?? 'Selected'}
          </div>
          <div className="text-[10px] text-chess-text-secondary">
            <span className="font-semibold text-chess-text">{matchingMoves}</span> matching moves
            {totalMoves != null && totalMoves > 0 && (
              <span> out of {totalMoves} ({((matchingMoves / totalMoves) * 100).toFixed(1)}%)</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
