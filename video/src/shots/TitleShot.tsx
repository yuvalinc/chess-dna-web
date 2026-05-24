import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";
import { ChessBoard } from "../board/ChessBoard";
import { Background } from "../board/Background";
import type { TitleShot as TitleShotProps } from "../storyboard/types";

function build3DText(fontSize: number, hueShift = 0): React.CSSProperties {
  const layers: string[] = [];
  for (let i = 1; i <= 14; i++) {
    layers.push(`${i}px ${i}px 0 hsl(${220 + hueShift} 95% ${Math.max(8, 30 - i * 1.5)}%)`);
  }
  const glow = [
    "0 0 4px #a8e9ff",
    "0 0 12px #5cd5ff",
    "0 0 28px #2a8cff",
    "0 0 60px #1d4ed8",
    "0 0 100px #1d4ed8",
  ];
  return {
    fontFamily: "Impact, 'Arial Black', 'Anton', sans-serif",
    fontSize,
    fontWeight: 900,
    color: "#e7faff",
    letterSpacing: "0.03em",
    textShadow: [...glow, ...layers].join(", "),
    WebkitTextStroke: "2px #061534",
  };
}

const KingSilhouette: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 200 200" style={{ filter: "drop-shadow(0 25px 40px rgba(0,0,0,0.85))" }}>
    <defs>
      <linearGradient id="kingGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#3a3a3a" />
        <stop offset="100%" stopColor="#0a0a0a" />
      </linearGradient>
    </defs>
    <g fill="url(#kingGrad)" stroke="#222" strokeWidth="2">
      <rect x="60" y="160" width="80" height="20" rx="4" />
      <rect x="50" y="140" width="100" height="20" rx="4" />
      <path d="M 70 140 L 70 80 Q 70 60 100 60 Q 130 60 130 80 L 130 140 Z" />
      <circle cx="100" cy="55" r="14" />
      <rect x="92" y="20" width="16" height="40" rx="2" />
      <rect x="78" y="32" width="44" height="10" rx="2" />
    </g>
  </svg>
);

export const TitleShot: React.FC<TitleShotProps> = ({
  text,
  subtitle,
  fen,
  playerPhotoUrl,
  playerName,
  playerHandle,
  theme = "monoSlate",
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const boardSize = Math.min(width * 0.95, 900);

  const slamProgress = spring({
    frame,
    fps,
    config: { damping: 9, stiffness: 140, mass: 0.9 },
  });
  const slamY = interpolate(slamProgress, [0, 1], [-160, 0]);
  const slamScale = interpolate(slamProgress, [0, 1], [0.55, 1]);
  const slamRot = interpolate(slamProgress, [0, 1], [-12, -8]);
  const flicker = 0.85 + 0.15 * Math.sin((frame / fps) * 14);

  const photoProgress = spring({
    frame: frame - fps * 0.18,
    fps,
    config: { damping: 16, stiffness: 90 },
  });
  const photoScale = interpolate(photoProgress, [0, 1], [0.85, 1]);

  const microZoom = 1 + 0.04 * (frame / fps);

  const subtitleOpacity = interpolate(frame, [fps * 0.6, fps * 1.0], [0, 1], {
    extrapolateRight: "clamp",
  });

  const nameProgress = spring({
    frame: frame - fps * 0.4,
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const nameY = interpolate(nameProgress, [0, 1], [40, 0]);

  const photoSize = boardSize * 0.88;
  const photoSrc = playerPhotoUrl
    ? (playerPhotoUrl.startsWith("http") ? playerPhotoUrl : staticFile(playerPhotoUrl))
    : null;

  return (
    <AbsoluteFill>
      <Background variant="blueglow" />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ position: "relative", transform: `scale(${microZoom})` }}>
          <ChessBoard
            fen={fen}
            size={boardSize}
            theme={theme}
            grayscale={1}
            brightness={0.55}
            saturate={0}
            tilt={6}
          />

          {/* Player photo with vignette mask + glow */}
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "62%",
              transform: `translate(-50%, -50%) scale(${photoScale})`,
              opacity: photoProgress,
              width: photoSize,
              height: photoSize,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            {photoSrc ? (
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: "100%",
                  // Soft circular mask + bottom fade-out so portrait blends into board
                  WebkitMaskImage:
                    "radial-gradient(ellipse 70% 75% at 50% 42%, #000 55%, transparent 92%), linear-gradient(to bottom, #000 60%, transparent 95%)",
                  maskImage:
                    "radial-gradient(ellipse 70% 75% at 50% 42%, #000 55%, transparent 92%), linear-gradient(to bottom, #000 60%, transparent 95%)",
                  WebkitMaskComposite: "source-in",
                  maskComposite: "intersect",
                  filter: "drop-shadow(0 30px 50px rgba(0,0,0,0.95)) drop-shadow(0 0 60px rgba(42,140,255,0.45))",
                }}
              >
                <img
                  src={photoSrc}
                  alt={playerName ?? "player"}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "50% 22%",
                  }}
                />
              </div>
            ) : (
              <KingSilhouette size={photoSize} />
            )}
          </div>

          {/* Neon title — chunky 3D extrusion */}
          <div
            style={{
              position: "absolute",
              top: -boardSize * 0.04,
              left: -40,
              right: -40,
              textAlign: "center",
              transform: `translateY(${slamY}px) scale(${slamScale}) rotate(${slamRot}deg) skewX(-6deg)`,
              opacity: slamProgress,
              filter: `brightness(${flicker})`,
            }}
          >
            <div style={build3DText(boardSize * 0.16)}>{text}</div>
            {subtitle && (
              <div
                style={{
                  fontFamily: "Impact, 'Arial Black', sans-serif",
                  fontSize: boardSize * 0.045,
                  fontWeight: 700,
                  color: "#fff",
                  letterSpacing: "0.25em",
                  marginTop: 14,
                  textShadow: "0 0 12px #2a8cff, 0 0 28px #1d4ed8, 2px 2px 0 #000",
                  opacity: subtitleOpacity,
                }}
              >
                {subtitle}
              </div>
            )}
          </div>

          {/* Player name plate (anchored under the photo) */}
          {playerName && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: -boardSize * 0.06,
                textAlign: "center",
                transform: `translateY(${nameY}px)`,
                opacity: nameProgress,
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  background: "linear-gradient(135deg, #0c1f4a 0%, #1d4ed8 100%)",
                  border: "2px solid rgba(168,233,255,0.6)",
                  borderRadius: 14,
                  padding: `${boardSize * 0.022}px ${boardSize * 0.05}px`,
                  fontFamily: "'Helvetica Neue', 'Arial', sans-serif",
                  color: "white",
                  fontSize: boardSize * 0.06,
                  fontWeight: 800,
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  boxShadow:
                    "0 12px 30px rgba(0,0,0,0.6), 0 0 30px rgba(42,140,255,0.45)",
                  textShadow: "0 0 10px #5cd5ff",
                }}
              >
                {playerName}
              </div>
              {playerHandle && (
                <div
                  style={{
                    marginTop: 8,
                    color: "#a8e9ff",
                    fontFamily: "'Courier New', monospace",
                    fontSize: boardSize * 0.032,
                    letterSpacing: "0.1em",
                    textShadow: "0 0 8px #2a8cff, 0 2px 4px #000",
                  }}
                >
                  @{playerHandle}
                </div>
              )}
            </div>
          )}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
