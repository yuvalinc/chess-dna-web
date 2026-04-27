import { useState, useMemo } from 'react';
import type { DimensionConfig, MoveFilter } from '@shared/types/skill-config';
import MoveFilterEditor from './MoveFilterEditor';
import { DEFAULT_BUCKET_SCORES } from '@shared/constants';

const BUCKET_QUALITIES = [
  { key: 'best', label: 'Best' },
  { key: 'excellent', label: 'Excl' },
  { key: 'good', label: 'Good' },
  { key: 'inaccuracy', label: 'Inac' },
  { key: 'mistake', label: 'Mist' },
  { key: 'blunder', label: 'Blun' },
  { key: 'brilliant', label: 'Bril' },
  { key: 'forced', label: 'Forc' },
] as const;

interface DimensionStats {
  matching: number;
  total: number;
  avgAccuracy: number;
  score: number;
}

interface DimensionCardProps {
  config: DimensionConfig;
  stats: DimensionStats;
  publishedScore: number | null;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (updated: DimensionConfig) => void;
  onRemove: () => void;
}

function summarizeFilters(filters: MoveFilter[]): string {
  if (filters.length === 0) return 'All moves';
  const parts: string[] = [];
  for (const f of filters) {
    const p: string[] = [];
    if (f.phases?.length) p.push(f.phases.join('/'));
    if (f.hasTactics === true) p.push('has tactics');
    if (f.hasTactics === false) p.push('no tactics');
    if (f.tacticalMotifs?.length) p.push(f.tacticalMotifs.slice(0, 2).join(', ') + (f.tacticalMotifs.length > 2 ? '...' : ''));
    if (f.evalRange) p.push(`eval ${f.evalRange.min} to ${f.evalRange.max}`);
    if (f.complexityRange) p.push(`${f.complexityRange.min}+ options`);
    if (f.timeRange) p.push(`${f.timeRange.min}-${f.timeRange.max}s`);
    if (f.excludeForced) p.push('excl forced');
    parts.push(p.join(', ') || 'any');
  }
  return parts.join(' OR ');
}

export default function DimensionCard({
  config,
  stats,
  publishedScore,
  isSelected,
  onSelect,
  onChange,
  onRemove,
}: DimensionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const filterSummary = useMemo(() => summarizeFilters(config.filters), [config.filters]);

  const delta = publishedScore != null ? stats.score - publishedScore : null;

  const handleToggle = () => {
    setExpanded(!expanded);
    if (!expanded) onSelect();
  };

  const handleFilterChange = (index: number, filter: MoveFilter) => {
    const newFilters = [...config.filters];
    newFilters[index] = filter;
    onChange({ ...config, filters: newFilters });
  };

  const handleFilterRemove = (index: number) => {
    onChange({ ...config, filters: config.filters.filter((_, i) => i !== index) });
  };

  const handleAddFilter = () => {
    onChange({ ...config, filters: [...config.filters, { excludeForced: true }] });
  };

  return (
    <div
      className={`bg-chess-surface rounded-xl border transition-all ${
        isSelected ? 'border-chess-accent/50' : 'border-chess-border/30'
      }`}
    >
      {/* Collapsed header */}
      <button onClick={handleToggle} className="w-full text-left px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-chess-text">{config.label}</span>
            <span className="text-[9px] font-semibold text-chess-accent bg-chess-accent/10 px-1.5 py-0.5 rounded-full">
              {(config.weight * 100).toFixed(0)}%
            </span>
          </div>
          <div className="text-[10px] text-chess-text-secondary mt-0.5 truncate">{filterSummary}</div>
        </div>

        <div className="flex items-center gap-3 text-right shrink-0">
          <div>
            <div className="text-[9px] text-chess-text-disabled uppercase">Potential</div>
            <div className="text-xs font-semibold text-chess-text">{stats.matching}</div>
          </div>
          <div>
            <div className="text-[9px] text-chess-text-disabled uppercase">Score</div>
            <div className="text-xs font-bold text-chess-accent">{stats.score}</div>
          </div>
          {delta != null && delta !== 0 && (
            <span className={`text-[10px] font-semibold ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
              {delta > 0 ? '+' : ''}{delta}
            </span>
          )}
          <span className="text-chess-text-disabled text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-chess-border/20 pt-3">
          {/* Label & weight */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">Label</label>
              <input
                value={config.label}
                onChange={(e) => onChange({ ...config, label: e.target.value })}
                className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
              />
            </div>
            <div className="w-24">
              <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">
                Weight: {(config.weight * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0"
                max="0.5"
                step="0.01"
                value={config.weight}
                onChange={(e) => onChange({ ...config, weight: parseFloat(e.target.value) })}
                className="w-full mt-1 accent-chess-accent"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">Description</label>
            <input
              value={config.description}
              onChange={(e) => onChange({ ...config, description: e.target.value })}
              className="w-full mt-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
            />
          </div>

          {/* Filters */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[9px] font-bold text-chess-text-secondary uppercase tracking-wider">
                Move Filters
              </label>
              <span className="text-[8px] text-chess-text-disabled">OR logic: matches any filter</span>
            </div>
            <div className="space-y-2">
              {config.filters.map((f, i) => (
                <MoveFilterEditor
                  key={i}
                  filter={f}
                  index={i}
                  onChange={handleFilterChange}
                  onRemove={handleFilterRemove}
                />
              ))}
            </div>
            <button
              onClick={handleAddFilter}
              className="mt-2 text-[10px] text-chess-accent hover:underline"
            >
              + Add Filter
            </button>
          </div>

          {/* Scoring Buckets */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[9px] font-bold text-chess-text-secondary uppercase tracking-wider">
                Scoring Buckets
              </label>
              <button
                onClick={() => onChange({ ...config, scoring: undefined })}
                className="text-[8px] text-chess-accent hover:underline"
              >
                Reset defaults
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {BUCKET_QUALITIES.map(({ key, label }) => {
                const buckets = config.scoring?.buckets ?? {};
                const val = buckets[key as keyof typeof buckets] ?? DEFAULT_BUCKET_SCORES[key];
                const isExcluded = val === null;

                return (
                  <div key={key} className="flex items-center gap-1">
                    <span className="text-[8px] text-chess-text-secondary w-7">{label}</span>
                    {isExcluded ? (
                      <button
                        onClick={() => {
                          const newBuckets = { ...buckets, [key]: DEFAULT_BUCKET_SCORES[key] ?? 50 };
                          onChange({ ...config, scoring: { buckets: newBuckets } });
                        }}
                        className="text-[8px] text-chess-text-disabled italic hover:text-chess-accent"
                      >
                        skip
                      </button>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        max="99"
                        value={val ?? 0}
                        onChange={(e) => {
                          const newBuckets = { ...buckets, [key]: parseInt(e.target.value) || 0 };
                          onChange({ ...config, scoring: { buckets: newBuckets } });
                        }}
                        className="w-10 bg-chess-overlay text-chess-text text-[9px] rounded px-1 py-0.5 border border-chess-border/30 text-center"
                      />
                    )}
                    {key === 'forced' && !isExcluded && (
                      <button
                        onClick={() => {
                          const newBuckets = { ...buckets, [key]: null };
                          onChange({ ...config, scoring: { buckets: newBuckets } });
                        }}
                        className="text-[7px] text-chess-text-disabled hover:text-red-400"
                        title="Exclude from scoring"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Options */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-[10px] text-chess-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={config.opponentAdjust}
                onChange={(e) => onChange({ ...config, opponentAdjust: e.target.checked })}
                className="accent-chess-accent w-3 h-3"
              />
              Adjust by opponent accuracy
            </label>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-chess-text-disabled">Range:</span>
              <input
                type="number"
                value={config.clampMin}
                onChange={(e) => onChange({ ...config, clampMin: parseInt(e.target.value) || 0 })}
                className="w-10 bg-chess-overlay text-chess-text text-[9px] rounded px-1 py-0.5 border border-chess-border/30"
              />
              <span className="text-[9px] text-chess-text-disabled">-</span>
              <input
                type="number"
                value={config.clampMax}
                onChange={(e) => onChange({ ...config, clampMax: parseInt(e.target.value) || 99 })}
                className="w-10 bg-chess-overlay text-chess-text text-[9px] rounded px-1 py-0.5 border border-chess-border/30"
              />
            </div>
          </div>

          {/* Live preview */}
          <div className="bg-chess-overlay/50 rounded-lg p-2.5 text-[10px]">
            <div className="font-semibold text-chess-text-secondary uppercase tracking-wider mb-1">Live Preview</div>
            <div className="flex gap-4">
              <div>
                <span className="text-chess-text-disabled">Matching:</span>{' '}
                <span className="text-chess-text font-semibold">{stats.matching}</span>
                <span className="text-chess-text-disabled"> / {stats.total}</span>
                <span className="text-chess-text-disabled"> ({stats.total > 0 ? ((stats.matching / stats.total) * 100).toFixed(1) : 0}%)</span>
              </div>
              <div>
                <span className="text-chess-text-disabled">Avg bucket score:</span>{' '}
                <span className="text-chess-accent font-semibold">{stats.avgAccuracy.toFixed(1)}</span>
              </div>
              <div>
                <span className="text-chess-text-disabled">Score:</span>{' '}
                <span className="text-chess-accent font-bold">{stats.score}</span>
              </div>
            </div>
          </div>

          {/* Remove dimension */}
          <button
            onClick={onRemove}
            className="text-[10px] text-red-400/60 hover:text-red-400"
          >
            Remove dimension
          </button>
        </div>
      )}
    </div>
  );
}
