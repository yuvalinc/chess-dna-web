import type { MoveFilter } from '@shared/types/skill-config';
import type { GamePhase } from '@shared/types/analysis';
import type { TacticalMotif } from '@shared/types/engine';

const PHASES: GamePhase[] = ['opening', 'middlegame', 'endgame'];

const TACTICS: TacticalMotif[] = [
  'fork', 'pin', 'skewer', 'discovered_attack', 'back_rank',
  'hanging_piece', 'trapped_piece', 'overloaded_piece',
  'deflection', 'removal_of_guard', 'pawn_promotion_threat', 'zwischenzug',
];

interface MoveFilterEditorProps {
  filter: MoveFilter;
  index: number;
  onChange: (index: number, filter: MoveFilter) => void;
  onRemove: (index: number) => void;
}

export default function MoveFilterEditor({ filter, index, onChange, onRemove }: MoveFilterEditorProps) {
  const update = (patch: Partial<MoveFilter>) => onChange(index, { ...filter, ...patch });

  return (
    <div className="bg-chess-overlay/50 rounded-lg p-3 space-y-2.5 border border-chess-border/20">
      <div className="flex items-center justify-between">
        <span className="text-[9px] font-bold text-chess-text-secondary uppercase tracking-wider">
          Filter {index + 1}
        </span>
        <button onClick={() => onRemove(index)} className="text-[9px] text-red-400/60 hover:text-red-400">
          Remove
        </button>
      </div>

      {/* Phase */}
      <div>
        <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">Phase</label>
        <div className="flex gap-1 mt-1">
          {PHASES.map((p) => {
            const active = filter.phases?.includes(p);
            return (
              <button
                key={p}
                onClick={() => {
                  const current = filter.phases ?? [];
                  update({ phases: active ? current.filter((x) => x !== p) : [...current, p] });
                }}
                className={`text-[9px] px-2 py-0.5 rounded-full border transition-colors capitalize ${
                  active
                    ? 'border-chess-accent bg-chess-accent/15 text-chess-accent'
                    : 'border-chess-border/30 text-chess-text-disabled hover:text-chess-text-secondary'
                }`}
              >
                {p}
              </button>
            );
          })}
          {filter.phases && filter.phases.length > 0 && (
            <button
              onClick={() => update({ phases: undefined })}
              className="text-[8px] text-chess-text-disabled hover:text-chess-text-secondary ml-1"
            >
              clear
            </button>
          )}
        </div>
      </div>

      {/* Tactics */}
      <div>
        <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">Tactics</label>
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => update({ hasTactics: filter.hasTactics === true ? undefined : true, tacticalMotifs: undefined })}
            className={`text-[9px] px-2 py-0.5 rounded-full border transition-colors ${
              filter.hasTactics === true
                ? 'border-chess-accent bg-chess-accent/15 text-chess-accent'
                : 'border-chess-border/30 text-chess-text-disabled hover:text-chess-text-secondary'
            }`}
          >
            Any tactic
          </button>
          <button
            onClick={() => update({ hasTactics: filter.hasTactics === false ? undefined : false })}
            className={`text-[9px] px-2 py-0.5 rounded-full border transition-colors ${
              filter.hasTactics === false
                ? 'border-amber-400 bg-amber-400/15 text-amber-400'
                : 'border-chess-border/30 text-chess-text-disabled hover:text-chess-text-secondary'
            }`}
          >
            No tactics
          </button>
        </div>
        {filter.hasTactics !== true && filter.hasTactics !== false && (
          <div className="flex flex-wrap gap-0.5 mt-1">
            {TACTICS.map((t) => {
              const active = filter.tacticalMotifs?.includes(t);
              return (
                <button
                  key={t}
                  onClick={() => {
                    const current = filter.tacticalMotifs ?? [];
                    update({ tacticalMotifs: active ? current.filter((x) => x !== t) : [...current, t] });
                  }}
                  className={`text-[7px] px-1.5 py-0.5 rounded border transition-colors ${
                    active
                      ? 'border-chess-accent bg-chess-accent/10 text-chess-accent'
                      : 'border-chess-border/20 text-chess-text-disabled hover:text-chess-text-secondary'
                  }`}
                >
                  {t.replace(/_/g, ' ')}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Eval range */}
      <div>
        <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">
          Eval Range (player perspective, cp)
        </label>
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            placeholder="min"
            value={filter.evalRange?.min ?? ''}
            onChange={(e) => {
              const min = e.target.value === '' ? undefined : parseInt(e.target.value);
              if (min === undefined && !filter.evalRange?.max) {
                update({ evalRange: undefined });
              } else {
                update({ evalRange: { min: min ?? -10000, max: filter.evalRange?.max ?? 10000 } });
              }
            }}
            className="w-16 bg-chess-overlay text-chess-text text-[9px] rounded px-1.5 py-1 border border-chess-border/30"
          />
          <span className="text-chess-text-disabled text-[9px]">to</span>
          <input
            type="number"
            placeholder="max"
            value={filter.evalRange?.max ?? ''}
            onChange={(e) => {
              const max = e.target.value === '' ? undefined : parseInt(e.target.value);
              if (max === undefined && !filter.evalRange?.min) {
                update({ evalRange: undefined });
              } else {
                update({ evalRange: { min: filter.evalRange?.min ?? -10000, max: max ?? 10000 } });
              }
            }}
            className="w-16 bg-chess-overlay text-chess-text text-[9px] rounded px-1.5 py-1 border border-chess-border/30"
          />
          <span className="text-[7px] text-chess-text-disabled">(-500=losing, 500=winning)</span>
        </div>
      </div>

      {/* Complexity */}
      <div>
        <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">
          Complexity (legal moves)
        </label>
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            placeholder="min"
            value={filter.complexityRange?.min ?? ''}
            onChange={(e) => {
              const min = e.target.value === '' ? undefined : parseInt(e.target.value);
              if (min === undefined) update({ complexityRange: undefined });
              else update({ complexityRange: { min, max: filter.complexityRange?.max ?? 999 } });
            }}
            className="w-14 bg-chess-overlay text-chess-text text-[9px] rounded px-1.5 py-1 border border-chess-border/30"
          />
          <span className="text-chess-text-disabled text-[9px]">to</span>
          <input
            type="number"
            placeholder="max"
            value={filter.complexityRange?.max ?? ''}
            onChange={(e) => {
              const max = e.target.value === '' ? undefined : parseInt(e.target.value);
              if (max === undefined) update({ complexityRange: undefined });
              else update({ complexityRange: { min: filter.complexityRange?.min ?? 1, max } });
            }}
            className="w-14 bg-chess-overlay text-chess-text text-[9px] rounded px-1.5 py-1 border border-chess-border/30"
          />
          <span className="text-[7px] text-chess-text-disabled">(1=forced, 30+=complex)</span>
        </div>
      </div>

      {/* Time range */}
      <div>
        <label className="text-[9px] font-semibold text-chess-text-secondary uppercase">
          Time Spent (seconds)
        </label>
        <div className="flex items-center gap-1 mt-1">
          <input
            type="number"
            placeholder="min"
            value={filter.timeRange?.min ?? ''}
            onChange={(e) => {
              const min = e.target.value === '' ? undefined : parseInt(e.target.value);
              if (min === undefined) update({ timeRange: undefined });
              else update({ timeRange: { min, max: filter.timeRange?.max ?? 9999 } });
            }}
            className="w-14 bg-chess-overlay text-chess-text text-[9px] rounded px-1.5 py-1 border border-chess-border/30"
          />
          <span className="text-chess-text-disabled text-[9px]">to</span>
          <input
            type="number"
            placeholder="max"
            value={filter.timeRange?.max ?? ''}
            onChange={(e) => {
              const max = e.target.value === '' ? undefined : parseInt(e.target.value);
              if (max === undefined) update({ timeRange: undefined });
              else update({ timeRange: { min: filter.timeRange?.min ?? 0, max } });
            }}
            className="w-14 bg-chess-overlay text-chess-text text-[9px] rounded px-1.5 py-1 border border-chess-border/30"
          />
          <span className="text-[7px] text-chess-text-disabled">(requires clock data)</span>
        </div>
      </div>

      {/* Move types + exclude forced */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="flex items-center gap-1 text-[9px] text-chess-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={filter.excludeForced ?? false}
            onChange={(e) => update({ excludeForced: e.target.checked || undefined })}
            className="accent-chess-accent w-3 h-3"
          />
          Exclude forced
        </label>
        {(['capture', 'check', 'castling', 'sacrifice'] as const).map((t) => {
          const active = filter.moveTypes?.includes(t);
          return (
            <label key={t} className="flex items-center gap-1 text-[9px] text-chess-text-secondary cursor-pointer capitalize">
              <input
                type="checkbox"
                checked={active ?? false}
                onChange={(e) => {
                  const current = filter.moveTypes ?? [];
                  update({ moveTypes: e.target.checked ? [...current, t] : current.filter((x) => x !== t) });
                }}
                className="accent-chess-accent w-3 h-3"
              />
              {t}
            </label>
          );
        })}
      </div>
    </div>
  );
}
