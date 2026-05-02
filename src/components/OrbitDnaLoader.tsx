/* ────────────────────────────────────────────────────────────────────────
 *  OrbitDnaLoader — DNA glyph in the center, four chess pieces orbiting,
 *  ambient pulsing halo. Used as the brand loading indicator across the
 *  app (replaces plain spinners).
 *
 *  All sizes scale relative to `size`, so a 168px hero version and a 64px
 *  inline loader both look right.
 * ──────────────────────────────────────────────────────────────────────── */
import { useId } from 'react';

interface Props {
  /** Outer diameter in px. Default 168 (matches the Decoding screen). */
  size?: number;
  /** Optional caption rendered below the loader. */
  caption?: string;
  className?: string;
}

const PIECES = [
  { piece: '♔', angle: -90 }, // ♔
  { piece: '♕', angle: 0 },   // ♕
  { piece: '♗', angle: 90 },  // ♗
  { piece: '♘', angle: 180 }, // ♘
];

export default function OrbitDnaLoader({ size = 168, caption, className = '' }: Props) {
  // Stable per-instance keyframe names so multiple loaders on the same page
  // animate independently (and at potentially different durations later).
  const uid = useId().replace(/:/g, '_');
  const orbitName = `orbit_${uid}`;
  const counterName = `counter_${uid}`;
  const pulseName = `pulse_${uid}`;

  // All distances scale from `size` so the loader looks right at any diameter.
  const center = size / 2;
  const satRadius = size * 0.464;       // ~78 at size=168
  const satBox = Math.max(20, size * 0.167); // ~28 at size=168, min 20
  const halfSat = satBox / 2;
  const ringInset = Math.max(1, Math.round(size * 0.006));
  const dotsInset = Math.max(8, Math.round(size * 0.107));
  const haloInset = Math.max(8, Math.round(size * 0.143));
  const coreInset = Math.max(10, Math.round(size * 0.190));
  const dnaSize = Math.max(16, Math.round(size * 0.262));
  const pieceFont = Math.max(10, Math.round(size * 0.089));
  const orbitDuration = Math.max(7, Math.round(size / 24));

  return (
    <div className={`inline-flex flex-col items-center ${className}`}>
      <style>{`
        @keyframes ${orbitName} { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }
        @keyframes ${counterName} { from { transform: rotate(0deg);} to { transform: rotate(-360deg);} }
        @keyframes ${pulseName} { 0%,100%{opacity:.45} 50%{opacity:1} }
      `}</style>
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="status"
        aria-label={caption ?? 'Loading'}
      >
        {/* Outer dashed ring */}
        <div
          className="absolute rounded-full opacity-50 pointer-events-none"
          style={{ inset: ringInset, border: '1px dashed rgba(30,58,95,0.55)' }}
        />
        {/* Inner dotted ring */}
        <div
          className="absolute rounded-full opacity-35 pointer-events-none"
          style={{ inset: dotsInset, border: '1px dotted rgba(30,58,95,0.33)' }}
        />
        {/* Pulsing accent halo */}
        <div
          className="absolute rounded-full pointer-events-none"
          style={{
            inset: haloInset,
            background: 'radial-gradient(circle, rgba(74,222,128,0.22), transparent 70%)',
            filter: 'blur(6px)',
            animation: `${pulseName} 2.4s ease-in-out infinite`,
          }}
        />

        {/* Rotating satellite cluster */}
        <div
          className="absolute inset-0"
          style={{ animation: `${orbitName} ${orbitDuration}s linear infinite`, transformOrigin: '50% 50%' }}
        >
          {PIECES.map((o, i) => {
            const cx = center + satRadius * Math.cos((o.angle * Math.PI) / 180);
            const cy = center + satRadius * Math.sin((o.angle * Math.PI) / 180);
            return (
              <div
                key={i}
                className="absolute rounded-md bg-chess-surface flex items-center justify-center"
                style={{
                  left: cx - halfSat,
                  top: cy - halfSat,
                  width: satBox,
                  height: satBox,
                  border: '1px solid rgba(30,58,95,0.4)',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                  animation: `${counterName} ${orbitDuration}s linear infinite`,
                  transformOrigin: '50% 50%',
                }}
              >
                <span className="text-chess-text leading-none" style={{ fontSize: pieceFont }}>
                  {o.piece}
                </span>
              </div>
            );
          })}
        </div>

        {/* Center DNA badge */}
        <div
          className="absolute rounded-full flex items-center justify-center"
          style={{
            inset: coreInset,
            background: 'radial-gradient(circle, rgb(var(--chess-surface)), rgb(var(--chess-bg)))',
            border: '1px solid rgba(74,222,128,0.3)',
            filter: 'drop-shadow(0 0 16px rgba(74,222,128,0.4))',
          }}
        >
          <svg
            width={dnaSize}
            height={dnaSize}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-chess-accent"
          >
            <g transform="rotate(45 12 12)">
              <path d="M8 2c0 6.5 8 12.5 8 19" />
              <path d="M16 2c0 6.5-8 12.5-8 19" />
              <line x1="9.2" y1="5.5" x2="14.8" y2="5.5" />
              <line x1="11" y1="8.5" x2="13" y2="8.5" />
              <line x1="11" y1="14.5" x2="13" y2="14.5" />
              <line x1="9.2" y1="17.5" x2="14.8" y2="17.5" />
            </g>
          </svg>
        </div>
      </div>
      {caption && (
        <p className="text-chess-text-secondary text-sm mt-3">{caption}</p>
      )}
    </div>
  );
}
