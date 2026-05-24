import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";
import { ChessBoard } from "../board/ChessBoard";
import { Background } from "../board/Background";
import type { VsTitleShot as VsTitleShotProps, PlayerCard } from "../storyboard/types";

function resolvePhoto(url?: string): string | null {
  if (!url) return null;
  return url.startsWith("http") ? url : staticFile(url);
}

const PlayerColumn: React.FC<{
  player: PlayerCard;
  enterFromLeft: boolean;
  progress: number;
  nameProgress: number;
  boardSize: number;
  accentColor: string;
}> = ({ player, enterFromLeft, progress, nameProgress, boardSize, accentColor }) => {
  const dir = enterFromLeft ? -1 : 1;
  const slideX = interpolate(progress, [0, 1], [dir * 320, 0]);
  const scale = interpolate(progress, [0, 1], [0.7, 1]);
  const nameY = interpolate(nameProgress, [0, 1], [40, 0]);
  const photoSrc = resolvePhoto(player.photoUrl);
  const photoSize = boardSize * 0.36;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        transform: `translateX(${slideX}px) scale(${scale})`,
        opacity: progress,
      }}
    >
      <div
        style={{
          width: photoSize,
          height: photoSize,
          borderRadius: "50%",
          overflow: "hidden",
          border: `4px solid ${accentColor}`,
          boxShadow: `0 0 30px ${accentColor}, 0 0 60px ${accentColor}88, 0 12px 30px rgba(0,0,0,0.7)`,
          background: "linear-gradient(135deg, #1a1a1a 0%, #050505 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {photoSrc ? (
          <img
            src={photoSrc}
            alt={player.name}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div style={{ fontSize: photoSize * 0.3, color: "#fff", fontWeight: 900 }}>
            {player.name.split(" ").map((w) => w[0]).join("")}
          </div>
        )}
      </div>
      {/* Color indicator under photo */}
      <div
        style={{
          marginTop: 10,
          width: photoSize * 0.22,
          height: photoSize * 0.22,
          borderRadius: 6,
          background: player.color === "white" ? "#fafafa" : "#1a1a1a",
          border: "2px solid #fff",
          boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        }}
      />
      <div
        style={{
          marginTop: 14,
          transform: `translateY(${nameY}px)`,
          opacity: nameProgress,
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "Impact, 'Arial Black', sans-serif",
            color: "white",
            fontSize: boardSize * 0.052,
            fontWeight: 900,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            textShadow: `0 0 12px ${accentColor}, 2px 2px 0 #000, -1px -1px 0 #000`,
            WebkitTextStroke: "1px #000",
            lineHeight: 1.05,
          }}
        >
          {player.name}
        </div>
        {(player.rating || player.title) && (
          <div
            style={{
              marginTop: 4,
              fontFamily: "'Courier New', monospace",
              color: accentColor,
              fontSize: boardSize * 0.034,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textShadow: "0 2px 4px #000",
            }}
          >
            {player.title ? `${player.title}` : ""}
            {player.title && player.rating ? " · " : ""}
            {player.rating ? player.rating : ""}
          </div>
        )}
      </div>
    </div>
  );
};

export const VsTitleShot: React.FC<VsTitleShotProps> = ({
  eventName,
  subtitle,
  fen,
  whitePlayer,
  blackPlayer,
  theme = "monoSlate",
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const boardSize = Math.min(width * 0.95, 900);

  const whiteProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const blackProgress = spring({
    frame: frame - fps * 0.12,
    fps,
    config: { damping: 12, stiffness: 100 },
  });
  const vsProgress = spring({
    frame: frame - fps * 0.3,
    fps,
    config: { damping: 6, stiffness: 220 },
  });
  const nameProgress = spring({
    frame: frame - fps * 0.5,
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const titleProgress = spring({
    frame: frame - fps * 0.05,
    fps,
    config: { damping: 10, stiffness: 140 },
  });
  const titleY = interpolate(titleProgress, [0, 1], [-120, 0]);
  const titleScale = interpolate(titleProgress, [0, 1], [0.6, 1]);
  const flicker = 0.85 + 0.15 * Math.sin((frame / fps) * 14);

  const vsScale = interpolate(vsProgress, [0, 1], [3, 1]);
  const vsRotate = interpolate(vsProgress, [0, 1], [-40, 0]);

  const layers: string[] = [];
  for (let i = 1; i <= 10; i++) {
    layers.push(`${i}px ${i}px 0 hsl(220 95% ${Math.max(8, 30 - i * 2)}%)`);
  }

  // Instagram Reels safe area: ~260px top (status bar + header) and ~360px
  // bottom (caption + action buttons). Keep all foreground content inside that.
  const SAFE_TOP = 260;
  const SAFE_BOTTOM = 360;

  return (
    <AbsoluteFill>
      <Background variant="blueglow" />

      {/* Faint board centered behind everything */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ opacity: 0.35 }}>
          <ChessBoard
            fen={fen}
            size={boardSize}
            theme={theme}
            grayscale={1}
            brightness={0.4}
            saturate={0}
            tilt={8}
          />
        </div>
      </AbsoluteFill>

      {/* Foreground content — title + players centered in the safe area */}
      <AbsoluteFill
        style={{
          paddingTop: SAFE_TOP,
          paddingBottom: SAFE_BOTTOM,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 50,
          zIndex: 3,
        }}
      >
        {/* Event title */}
        <div
          style={{
            textAlign: "center",
            transform: `translateY(${titleY}px) scale(${titleScale}) skewX(-4deg)`,
            opacity: titleProgress,
            filter: `brightness(${flicker})`,
          }}
        >
          <div
            style={{
              fontFamily: "Impact, 'Arial Black', sans-serif",
              fontSize: boardSize * 0.09,
              fontWeight: 900,
              color: "#e7faff",
              letterSpacing: "0.04em",
              textShadow: [
                "0 0 4px #a8e9ff",
                "0 0 12px #5cd5ff",
                "0 0 28px #2a8cff",
                "0 0 60px #1d4ed8",
                ...layers,
              ].join(", "),
              WebkitTextStroke: "2px #061534",
              textTransform: "uppercase",
            }}
          >
            {eventName}
          </div>
          {subtitle && (
            <div
              style={{
                marginTop: 10,
                fontFamily: "Impact, sans-serif",
                fontSize: boardSize * 0.038,
                color: "#fff",
                letterSpacing: "0.22em",
                textShadow: "0 0 12px #2a8cff, 0 0 24px #1d4ed8, 2px 2px 0 #000",
                opacity: nameProgress,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>

        {/* Players row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: boardSize * 0.05,
          }}
        >
          <PlayerColumn
            player={whitePlayer}
            enterFromLeft={true}
            progress={whiteProgress}
            nameProgress={nameProgress}
            boardSize={boardSize}
            accentColor="#fbbf24"
          />

          {/* VS bolt */}
          <div
            style={{
              transform: `scale(${vsScale}) rotate(${vsRotate}deg)`,
              opacity: vsProgress,
              fontFamily: "Impact, 'Arial Black', sans-serif",
              fontSize: boardSize * 0.13,
              fontWeight: 900,
              color: "#fff",
              letterSpacing: "-0.05em",
              textShadow: [
                "0 0 10px #ef4444",
                "0 0 30px #dc2626",
                "0 0 60px #7f1d1d",
                "4px 4px 0 #000",
                "8px 8px 0 #4a0606",
              ].join(", "),
              WebkitTextStroke: "2px #000",
            }}
          >
            VS
          </div>

          <PlayerColumn
            player={blackPlayer}
            enterFromLeft={false}
            progress={blackProgress}
            nameProgress={nameProgress}
            boardSize={boardSize}
            accentColor="#22d3ee"
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
