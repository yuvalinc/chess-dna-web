import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import type { MoveAnalysis } from '@shared/types/analysis';

interface EvalChartProps {
  moves: MoveAnalysis[];
  currentMoveIndex: number;
  onMoveClick: (index: number) => void;
}

export default function EvalChart({ moves, currentMoveIndex, onMoveClick }: EvalChartProps) {
  const data = moves.map((move, index) => {
    const cp = move.evalAfter.scoreType === 'mate'
      ? (move.evalAfter.score > 0 ? 1000 : -1000)
      : Math.max(-600, Math.min(600, move.evalAfter.score));

    return {
      index,
      moveNum: move.color === 'white'
        ? `${move.moveNumber}.`
        : `${move.moveNumber}...`,
      eval: cp / 100,
      quality: move.quality,
      phase: move.phase,
    };
  });

  // Find phase boundaries
  const phaseBoundaries = findPhaseBoundaries(moves);

  return (
    <div className="w-full h-16 bg-chess-surface rounded-lg p-1.5">
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <LineChart
          data={data}
          onClick={(e) => {
            if (e?.activeTooltipIndex !== undefined) {
              onMoveClick(e.activeTooltipIndex);
            }
          }}
        >
          {/* Phase background areas */}
          {phaseBoundaries.map((boundary, i) => (
            <ReferenceArea
              key={i}
              x1={boundary.start}
              x2={boundary.end}
              fill={
                boundary.phase === 'opening'
                  ? '#3b82f620'
                  : boundary.phase === 'endgame'
                    ? '#6b728020'
                    : 'transparent'
              }
            />
          ))}

          <XAxis dataKey="index" hide />
          <YAxis
            domain={[-6, 6]}
            ticks={[-4, 0, 4]}
            width={20}
            tick={{ fill: 'rgb(var(--chess-text-secondary))', fontSize: 9 }}
          />
          <ReferenceLine y={0} stroke="rgb(var(--chess-text-tertiary))" strokeDasharray="3 3" />

          {/* Current move indicator */}
          {currentMoveIndex >= 0 && (
            <ReferenceLine
              x={currentMoveIndex}
              stroke="rgb(var(--chess-accent))"
              strokeWidth={2}
            />
          )}

          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.[0]) return null;
              const d = payload[0].payload;
              return (
                <div className="bg-chess-bg border border-chess-border rounded px-2 py-1 text-xs">
                  <div className="text-chess-text">
                    {d.moveNum} {moves[d.index]?.moveSan}
                  </div>
                  <div className="text-gray-400">
                    Eval: {d.eval > 0 ? '+' : ''}{d.eval.toFixed(2)}
                  </div>
                </div>
              );
            }}
          />

          <Line
            type="monotone"
            dataKey="eval"
            stroke="rgb(var(--chess-accent))"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 4, fill: 'rgb(var(--chess-accent))' }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface PhaseBoundary {
  phase: string;
  start: number;
  end: number;
}

function findPhaseBoundaries(moves: MoveAnalysis[]): PhaseBoundary[] {
  if (moves.length === 0) return [];

  const boundaries: PhaseBoundary[] = [];
  let currentPhase = moves[0].phase;
  let start = 0;

  for (let i = 1; i < moves.length; i++) {
    if (moves[i].phase !== currentPhase) {
      boundaries.push({ phase: currentPhase, start, end: i - 1 });
      currentPhase = moves[i].phase;
      start = i;
    }
  }
  boundaries.push({ phase: currentPhase, start, end: moves.length - 1 });

  return boundaries;
}
