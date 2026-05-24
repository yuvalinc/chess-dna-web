import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";
import { Background } from "../board/Background";
import type { StreakShot as StreakShotProps } from "../storyboard/types";

function resolveSrc(url: string): string {
  return url.startsWith("http") ? url : staticFile(url);
}

export const StreakShot: React.FC<StreakShotProps> = ({
  from = 0,
  to,
  crashTo = 0,
  topLabel,
  counterLabel,
  dateRange,
  milestone,
  crashText,
  crashSubText,
  crashPhotoUrl,
  durationSec,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const total = Math.round(durationSec * fps);

  // Four phases (without milestone, the milestone window collapses to zero):
  //   0–45%: counter ticks up from `from` to `to` with deceleration
  //   45–55%: brief pause while sitting at `to`
  //   55–70%: milestone flash — counter shrinks, magnitude text flies in
  //   70–100%: dramatic crash to `crashTo` with shake + flash + overlay
  const tickEnd = total * 0.45;
  const holdEnd = total * (milestone ? 0.55 : 0.7);
  const milestoneEnd = total * 0.7;

  // Phase 1: tick
  const tickT = Math.min(1, frame / tickEnd);
  // Ease-out: ticks fast at start, slows as it nears `to` (anticipation).
  const tickEased = 1 - Math.pow(1 - tickT, 2.4);
  const tickValue = Math.round(from + (to - from) * tickEased);

  // Phase 3 (optional): milestone callout
  const inMilestone = !!milestone && frame >= holdEnd && frame < milestoneEnd;
  const milestoneT = Math.min(1, Math.max(0, (frame - holdEnd) / (milestoneEnd - holdEnd)));

  // Phase 4: crash
  const crashStart = milestone ? milestoneEnd : holdEnd;
  const inCrash = frame >= crashStart;
  const crashT = Math.min(1, Math.max(0, (frame - crashStart) / (total - crashStart)));
  // Ease-in: counter falls slowly at first, then SLAMS to crashTo.
  const crashEased = crashT * crashT * (3 - 2 * crashT);

  let displayValue = tickValue;
  if (inCrash) {
    displayValue = Math.round(to + (crashTo - to) * crashEased);
  } else if (frame >= tickEnd) {
    displayValue = to;
  }

  // Camera shake intensifies during crash
  const shakeAmp = inCrash ? interpolate(crashT, [0, 0.3, 1], [0, 18, 4]) : 0;
  const shakeX = shakeAmp * Math.sin(frame * 2.9);
  const shakeY = shakeAmp * Math.cos(frame * 3.3);

  // Counter scale: anticipation hover at peak, then huge slam
  let counterScale = 1;
  if (inCrash) {
    // Crash: stretch up (anticipation) → squash down at impact
    if (crashT < 0.2) counterScale = interpolate(crashT, [0, 0.2], [1.05, 1.2]);
    else if (crashT < 0.5) counterScale = interpolate(crashT, [0.2, 0.5], [1.2, 0.45]);
    else counterScale = interpolate(crashT, [0.5, 1], [0.45, 0.8]);
  } else if (inMilestone) {
    // Milestone phase: shrink counter aside so the magnitude text can take stage
    counterScale = interpolate(milestoneT, [0, 0.4, 1], [1.05, 0.7, 0.65]);
  } else if (frame >= tickEnd) {
    // Tiny pulse during the hold (anticipation)
    counterScale = 1 + 0.05 * Math.sin((frame - tickEnd) * 0.8);
  } else {
    counterScale = interpolate(tickT, [0, 0.3, 1], [0.6, 1.05, 1]);
  }

  // Color transition: warm/gold during streak, red during crash
  const goldR = 251, goldG = 191, goldB = 36;
  const redR = 220, redG = 38, redB = 38;
  const colorBlend = inCrash ? Math.min(1, crashT * 2) : 0;
  const r = Math.round(goldR + (redR - goldR) * colorBlend);
  const g = Math.round(goldG + (redG - goldG) * colorBlend);
  const b = Math.round(goldB + (redB - goldB) * colorBlend);
  const counterColor = `rgb(${r},${g},${b})`;

  // Red flash at the moment of impact
  const flashOpacity = inCrash
    ? interpolate(crashT, [0.35, 0.5, 0.75], [0, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : 0;

  // Crash text reveal
  const crashTextProgress = inCrash
    ? spring({ frame: frame - holdEnd - fps * 0.35, fps, config: { damping: 8, stiffness: 200 } })
    : 0;
  const crashTextScale = interpolate(crashTextProgress, [0, 1], [3, 1]);

  const subTextProgress = inCrash
    ? spring({ frame: frame - holdEnd - fps * 0.7, fps, config: { damping: 12, stiffness: 130 } })
    : 0;

  // Subtle ground-bounce: page jolts down at impact
  const groundJolt = inCrash && crashT > 0.4 && crashT < 0.65
    ? interpolate(crashT, [0.4, 0.5, 0.65], [0, 12, 0])
    : 0;

  const counterFontSize = Math.min(width * 0.6, 700);

  return (
    <AbsoluteFill>
      <Background variant={inCrash ? "redglow" : "warm"} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            transform: `translate(${shakeX}px, ${shakeY + groundJolt}px)`,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          {/* Top label — fades during crash */}
          <div
            style={{
              fontFamily: "Impact, 'Arial Black', sans-serif",
              fontSize: width * 0.07,
              fontWeight: 900,
              color: "white",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              textShadow: "0 4px 10px rgba(0,0,0,0.7), 2px 2px 0 #000",
              opacity: inCrash ? Math.max(0, 1 - crashT * 1.4) : 1,
              marginBottom: 4,
            }}
          >
            {topLabel}
          </div>

          {/* The counter */}
          <div
            style={{
              fontFamily: "'Helvetica Neue', 'Arial Black', sans-serif",
              fontSize: counterFontSize,
              fontWeight: 900,
              color: counterColor,
              letterSpacing: "-0.02em",
              lineHeight: 0.85,
              transform: `scale(${counterScale})`,
              transformOrigin: "center center",
              textShadow: inCrash
                ? `0 0 30px ${counterColor}, 0 0 80px ${counterColor}, 8px 8px 0 #000`
                : `0 0 24px ${counterColor}aa, 0 0 60px ${counterColor}66, 6px 6px 0 #1a0f00`,
              WebkitTextStroke: inCrash ? "3px #4a0606" : "2px #2a1500",
              filter: inCrash && crashT > 0.45 && crashT < 0.6 ? "blur(2px)" : undefined,
            }}
          >
            {displayValue}
          </div>

          {/* Counter caption */}
          <div
            style={{
              fontFamily: "Impact, 'Arial Black', sans-serif",
              fontSize: width * 0.05,
              fontWeight: 900,
              color: inCrash ? "#fca5a5" : "#fde68a",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              textShadow: "0 3px 8px rgba(0,0,0,0.8), 2px 2px 0 #000",
              opacity: inCrash ? Math.max(0, 1 - crashT * 1.4) : 1,
              marginTop: 6,
            }}
          >
            {counterLabel}
          </div>

          {dateRange && (
            <div
              style={{
                fontFamily: "'Courier New', monospace",
                fontSize: width * 0.028,
                color: "rgba(255,255,255,0.65)",
                letterSpacing: "0.2em",
                marginTop: 12,
                opacity: inCrash ? Math.max(0, 1 - crashT * 1.4) : 1,
              }}
            >
              {dateRange}
            </div>
          )}
        </div>
      </AbsoluteFill>

      {/* Red flash overlay at impact */}
      <AbsoluteFill
        style={{
          background: "radial-gradient(ellipse at center, rgba(220,38,38,0.9) 0%, rgba(220,38,38,0.4) 40%, transparent 80%)",
          opacity: flashOpacity,
          pointerEvents: "none",
        }}
      />

      {/* Milestone flash — magnitude callout between hold and crash */}
      {milestone && inMilestone && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.18 }}>
          <div
            style={{
              transform: `scale(${interpolate(milestoneT, [0, 0.25, 0.85, 1], [2.4, 1, 1, 0.94])}) rotate(${interpolate(milestoneT, [0, 1], [-4, 0])}deg)`,
              opacity: interpolate(milestoneT, [0, 0.15, 0.85, 1], [0, 1, 1, 0.85]),
              fontFamily: "Impact, 'Arial Black', sans-serif",
              fontSize: width * 0.085,
              fontWeight: 900,
              color: "#fde68a",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              textShadow: [
                "0 0 14px #fbbf24",
                "0 0 36px #f59e0b",
                "0 0 80px #f59e0b",
                "4px 4px 0 #4a2500",
                "8px 8px 0 #000",
              ].join(", "),
              WebkitTextStroke: "2px #000",
              textAlign: "center",
              padding: "0 30px",
              lineHeight: 1.05,
              whiteSpace: "pre-line",
            }}
          >
            {milestone}
          </div>
        </AbsoluteFill>
      )}

      {/* Crash overlay — STREAK BROKEN + sub-text + photo */}
      {inCrash && crashTextProgress > 0 && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.15 }}>
          <div
            style={{
              transform: `scale(${crashTextScale}) rotate(${interpolate(crashTextProgress, [0, 1], [-6, -3])}deg)`,
              fontFamily: "Impact, 'Arial Black', sans-serif",
              fontSize: width * 0.13,
              fontWeight: 900,
              color: "white",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              textShadow: [
                "0 0 14px #dc2626",
                "0 0 40px #dc2626",
                "4px 4px 0 #4a0606",
                "8px 8px 0 #000",
              ].join(", "),
              WebkitTextStroke: "2px #000",
              opacity: crashTextProgress,
            }}
          >
            {crashText}
          </div>

          {crashSubText && (
            <div
              style={{
                marginTop: 24,
                display: "flex",
                alignItems: "center",
                gap: 18,
                opacity: subTextProgress,
                transform: `translateY(${interpolate(subTextProgress, [0, 1], [30, 0])}px)`,
              }}
            >
              {crashPhotoUrl && (
                <img
                  src={resolveSrc(crashPhotoUrl)}
                  alt={crashSubText}
                  style={{
                    width: width * 0.13,
                    height: width * 0.13,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: "4px solid #4ade80",
                    boxShadow: "0 0 18px rgba(74,222,128,0.7)",
                  }}
                />
              )}
              <div
                style={{
                  fontFamily: "Impact, 'Arial Black', sans-serif",
                  fontSize: width * 0.07,
                  fontWeight: 900,
                  color: "white",
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  textShadow: "0 0 14px #4ade80, 2px 2px 0 #000",
                }}
              >
                {crashSubText}
              </div>
            </div>
          )}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};
