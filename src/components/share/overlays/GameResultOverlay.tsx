/**
 * Game Result stats overlay — Strava-style hierarchy.
 * Renders sections in user-defined order via elementOrder prop.
 * Uses hardcoded colors for html2canvas compatibility.
 */
import { SHARE_COLORS, getResultColor } from '../share-colors';
import { getTierForScore } from '@/patterns/rank-tiers';
import type { GameRecord } from '@shared/types/game';
import type { GameSummary } from '@shared/types/analysis';
import type { SkillProfile } from '@shared/types/patterns';

interface Props {
  game: GameRecord;
  summary: GameSummary;
  format: 'story' | 'feed';
  hasBackground: boolean;
  visibleElements: Set<string>;
  elementOrder: string[];
  profile?: SkillProfile | null;
  caption?: string | null;
  avatarUrl?: string | null;
  flagUrl?: string | null;
}

const TIER_COLORS: Record<string, string> = {
  pawn: '#64748b', knight: '#f59e0b', bishop: '#eab308',
  rook: '#22d3ee', queen: '#34d399', king: '#4ade80',
};

const TC_ICONS: Record<string, string> = {
  bullet: '⚡', blitz: '🔥', rapid: '⏱️', daily: '📅',
};

/* ── SVG Radar ── */
function MiniRadar({ profile, size }: { profile: SkillProfile; size: number }) {
  const cx = size / 2, cy = size / 2, maxR = size * 0.36;
  const dims = profile.dimensions;
  const n = dims.length;
  const tier = getTierForScore(profile.overallRating);
  const tierColor = TIER_COLORS[tier.id] ?? '#4ade80';
  const points = dims.map((d, i) => {
    const a = (Math.PI * 2 * i) / n - Math.PI / 2;
    const r = (d.score / 99) * maxR;
    return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
  }).join(' ');
  const shortLabels = ['OPN', 'TAC', 'DEF', 'POS', 'END', 'CAL', 'TIM', 'RES'];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1.0].map(pct => {
        const r = maxR * pct;
        const gPts = Array.from({ length: n }, (_, i) => {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
        }).join(' ');
        return <polygon key={pct} points={gPts} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={1} />;
      })}
      {dims.map((_, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        return <line key={`ax${i}`} x1={cx} y1={cy} x2={cx + maxR * Math.cos(a)} y2={cy + maxR * Math.sin(a)} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />;
      })}
      <polygon points={points} fill={tierColor} fillOpacity={0.2} stroke={tierColor} strokeWidth={3} strokeLinejoin="round" />
      {dims.map((d, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        const r = (d.score / 99) * maxR;
        return <circle key={`dot${i}`} cx={cx + r * Math.cos(a)} cy={cy + r * Math.sin(a)} r={5} fill={tierColor} />;
      })}
      {dims.map((_, i) => {
        const a = (Math.PI * 2 * i) / n - Math.PI / 2;
        return (
          <text key={`lbl${i}`} x={cx + (maxR + 28) * Math.cos(a)} y={cy + (maxR + 28) * Math.sin(a)}
            textAnchor="middle" dominantBaseline="central"
            fill="rgba(255,255,255,0.5)" fontSize={15} fontWeight={700} fontFamily="sans-serif">
            {shortLabels[i]}
          </text>
        );
      })}
      <text x={cx} y={cy - 10} textAnchor="middle" dominantBaseline="central" fill={tierColor} fontSize={48} fontFamily="serif">{tier.icon}</text>
      <text x={cx} y={cy + 32} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={28} fontWeight={900} fontFamily="sans-serif">{profile.overallRating}</text>
    </svg>
  );
}

/* ── Accuracy Ring ── */
function AccRing({ accuracy, size, label, hasBackground }: { accuracy: number; size: number; label?: string; hasBackground: boolean }) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (accuracy / 100) * circumference;
  const color = accuracy >= 90 ? '#4ade80' : accuracy >= 75 ? '#4ade80' : accuracy >= 60 ? '#facc15' : '#ef4444';
  const ts = hasBackground ? '0 2px 6px rgba(0,0,0,0.9)' : 'none';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${progress} ${circumference}`} />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: size * 0.26, fontWeight: 900, color: '#fff', textShadow: ts, lineHeight: 1 }}>{accuracy}%</span>
        {label && <span style={{ fontSize: size * 0.09, color: SHARE_COLORS.textTertiary, marginTop: 4, textShadow: ts, textTransform: 'uppercase', letterSpacing: 2 }}>{label}</span>}
      </div>
    </div>
  );
}

/* ── Strava-style stat block ── */
function StatBlock({ label, value, color, size, textShadow }: { label: string; value: string; color?: string; size: number; textShadow: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: size * 0.06 }}>
      <span style={{ fontSize: size * 0.2, color: SHARE_COLORS.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2, textShadow }}>{label}</span>
      <span style={{ fontSize: size, fontWeight: 900, color: color ?? '#fff', lineHeight: 1, textShadow, letterSpacing: size > 60 ? 4 : 2 }}>{value}</span>
    </div>
  );
}

export default function GameResultOverlay({ game, summary, format, hasBackground, visibleElements, elementOrder, profile, caption, avatarUrl, flagUrl }: Props) {
  const isStory = format === 'story';
  const resultColor = getResultColor(game.player.result);
  const resultLabel = game.player.result.toUpperCase();
  const textShadow = hasBackground ? '0 2px 8px rgba(0,0,0,0.9)' : 'none';
  const shadow = hasBackground ? '0 2px 8px rgba(0,0,0,0.8)' : 'none';
  const show = (id: string) => visibleElements.has(id);

  const qualities = [
    { label: 'Brilliant', count: summary.brilliantMoves, color: SHARE_COLORS.brilliant },
    { label: 'Great', count: summary.greatMoves, color: SHARE_COLORS.great },
    { label: 'Best', count: summary.bestMoves, color: SHARE_COLORS.best },
    { label: 'Mistake', count: summary.mistakes, color: SHARE_COLORS.mistake },
    { label: 'Blunder', count: summary.blunders, color: SHARE_COLORS.blunder },
  ].filter(q => q.count > 0);

  const phases = [
    { label: 'Opening', acc: summary.phaseAccuracy.opening },
    { label: 'Middlegame', acc: summary.phaseAccuracy.middlegame },
    { label: 'Endgame', acc: summary.phaseAccuracy.endgame },
  ];

  const phaseColor = (acc: number) =>
    acc >= 90 ? '#4ade80' : acc >= 75 ? '#22c55e' : acc >= 60 ? '#facc15' : '#ef4444';

  const opponentAccuracy = Math.round(100 - summary.acpl * 0.5);
  const showComparison = show('comparison') && summary.accuracy > 0;

  const S = isStory ? 1 : 0.7;

  // Render a section by its ID
  const renderSection = (id: string) => {
    if (!show(id)) return null;

    switch (id) {
      case 'timeclass':
        return (
          <div key={id} style={{
            fontSize: Math.round(28 * S), fontWeight: 700, color: SHARE_COLORS.accent,
            padding: `${Math.round(8 * S)}px ${Math.round(28 * S)}px`, borderRadius: 14,
            background: hasBackground ? 'rgba(0,0,0,0.35)' : 'rgba(74,222,128,0.08)',
            textTransform: 'uppercase', letterSpacing: 3, textShadow, boxShadow: shadow,
          }}>
            {TC_ICONS[game.timeClass] ?? ''} {game.timeClass}
          </div>
        );

      case 'result':
        return (
          <StatBlock key={id} label="Result" value={resultLabel} color={resultColor} size={Math.round(120 * S)} textShadow={textShadow} />
        );

      case 'accuracy':
        if (showComparison) return null; // comparison replaces accuracy
        return (
          <StatBlock key={id} label="Accuracy" value={`${summary.accuracy}%`} size={Math.round(100 * S)} textShadow={textShadow} />
        );

      case 'comparison':
        if (!showComparison) return null;
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'flex-end', gap: Math.round(50 * S), textShadow }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: Math.round(18 * S), color: SHARE_COLORS.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2 }}>You</span>
              <AccRing accuracy={summary.accuracy} size={Math.round(200 * S)} hasBackground={hasBackground} />
              <span style={{ fontSize: Math.round(18 * S), fontWeight: 600, color: SHARE_COLORS.text }}>{game.player.username}</span>
            </div>
            <div style={{ fontSize: Math.round(22 * S), fontWeight: 700, color: SHARE_COLORS.textTertiary, marginBottom: Math.round(80 * S) }}>vs</div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: Math.round(18 * S), color: SHARE_COLORS.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2 }}>Opponent</span>
              <AccRing accuracy={opponentAccuracy} size={Math.round(200 * S)} hasBackground={hasBackground} />
              <span style={{ fontSize: Math.round(18 * S), fontWeight: 600, color: SHARE_COLORS.textSecondary }}>{game.opponent.username}</span>
            </div>
          </div>
        );

      case 'players':
        if (showComparison) return null; // shown inside comparison
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(6 * S), textShadow }}>
            <span style={{ fontSize: Math.round(18 * S), color: SHARE_COLORS.textTertiary, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 2 }}>Players</span>
            <div style={{ fontSize: Math.round(44 * S), fontWeight: 700, color: SHARE_COLORS.text }}>
              {game.player.username} <span style={{ color: SHARE_COLORS.textTertiary, fontWeight: 400, fontSize: Math.round(30 * S) }}>({game.player.rating})</span>
            </div>
            <span style={{ fontSize: Math.round(18 * S), color: SHARE_COLORS.textTertiary, fontWeight: 600, letterSpacing: 3 }}>VS</span>
            <div style={{ fontSize: Math.round(38 * S), fontWeight: 600, color: SHARE_COLORS.textSecondary }}>
              {game.opponent.username} <span style={{ color: SHARE_COLORS.textTertiary, fontWeight: 400, fontSize: Math.round(26 * S) }}>({game.opponent.rating})</span>
            </div>
          </div>
        );

      case 'avatar':
        if (!show(id) || !avatarUrl) return null;
        return (
          <img
            key={id}
            src={avatarUrl}
            alt=""
            crossOrigin="anonymous"
            style={{
              width: Math.round(140 * S),
              height: Math.round(140 * S),
              borderRadius: '50%',
              objectFit: 'cover',
              border: `${Math.round(4 * S)}px solid ${SHARE_COLORS.accent}`,
              boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            }}
          />
        );

      case 'country':
        if (!show(id) || !flagUrl) return null;
        return (
          <img
            key={id}
            src={flagUrl}
            alt=""
            crossOrigin="anonymous"
            style={{
              width: Math.round(90 * S),
              height: 'auto',
              borderRadius: Math.round(6 * S),
              boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
            }}
          />
        );

      case 'phases':
        return (
          <div key={id} style={{ width: '100%', maxWidth: Math.round(640 * S), display: 'flex', flexDirection: 'column', gap: Math.round(14 * S) }}>
            {phases.map(p => (
              <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: Math.round(20 * S), color: SHARE_COLORS.textTertiary, width: Math.round(150 * S), textShadow, flexShrink: 0 }}>{p.label}</span>
                <div style={{ flex: 1, height: Math.round(14 * S), borderRadius: 7, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                  <div style={{ width: `${p.acc}%`, height: '100%', borderRadius: 7, background: phaseColor(p.acc), opacity: 0.5 + (p.acc / 100) * 0.5 }} />
                </div>
                <span style={{ fontSize: Math.round(24 * S), fontWeight: 700, color: phaseColor(p.acc), width: Math.round(65 * S), textAlign: 'right', textShadow }}>{p.acc}%</span>
              </div>
            ))}
          </div>
        );

      case 'qualities':
        if (qualities.length === 0) return null;
        return (
          <div key={id} style={{ display: 'flex', flexWrap: 'wrap', gap: Math.round(12 * S), justifyContent: 'center' }}>
            {qualities.map(q => (
              <div key={q.label} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: `${Math.round(8 * S)}px ${Math.round(20 * S)}px`, borderRadius: 18,
                background: hasBackground ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.06)', boxShadow: shadow,
              }}>
                <span style={{ fontSize: Math.round(26 * S), fontWeight: 700, color: q.color }}>{q.count}</span>
                <span style={{ fontSize: Math.round(20 * S), color: SHARE_COLORS.textSecondary }}>{q.label}</span>
              </div>
            ))}
          </div>
        );

      case 'opening':
        return (
          <div key={id} style={{ fontSize: Math.round(22 * S), color: SHARE_COLORS.textSecondary, textAlign: 'center', textShadow }}>
            {game.opening.name}
          </div>
        );

      case 'radar':
        if (!profile || profile.gamesUsed <= 0) return null;
        return <MiniRadar key={id} profile={profile} size={Math.round(380 * S)} />;

      case 'caption':
        if (!caption) return null;
        return (
          <div key={id} style={{ maxWidth: Math.round(680 * S), textAlign: 'center', padding: `${Math.round(20 * S)}px ${Math.round(20 * S)}px 0` }}>
            <div style={{
              fontSize: Math.round(24 * S), fontStyle: 'italic',
              color: 'rgba(255,255,255,0.75)', lineHeight: 1.5,
              textShadow: hasBackground ? '0 2px 8px rgba(0,0,0,0.9)' : '0 1px 2px rgba(0,0,0,0.3)',
              letterSpacing: 0.5, fontFamily: 'Georgia, "Times New Roman", serif',
            }}>
              &ldquo;{caption}&rdquo;
            </div>
          </div>
        );

      case 'branding':
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(4 * S), textShadow, marginTop: Math.round(20 * S) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(12 * S) }}>
              <img
                src="/favicon.png"
                alt=""
                crossOrigin="anonymous"
                style={{
                  width: Math.round(56 * S),
                  height: Math.round(56 * S),
                  borderRadius: Math.round(12 * S),
                  objectFit: 'cover',
                }}
              />
              <span style={{ fontSize: Math.round(34 * S), fontWeight: 900, color: SHARE_COLORS.text, letterSpacing: 1 }}>
                ChessDNA
              </span>
            </div>
            <span style={{
              fontSize: Math.round(13 * S),
              color: SHARE_COLORS.textTertiary,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Download on the App Store
            </span>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      padding: isStory ? '100px 64px 100px' : '40px 40px 50px',
      gap: Math.round(32 * S),
    }}>
      {elementOrder.map(id => renderSection(id))}
    </div>
  );
}
