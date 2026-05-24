import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";
import { Background } from "../board/Background";
import type { OutroShot as OutroShotProps } from "../storyboard/types";

function resolveSrc(url: string): string {
  return url.startsWith("http") ? url : staticFile(url);
}

const FOLLOW_GREEN = "#4ade80";
const FOLLOW_GREEN_DEEP = "#16a34a";

export const OutroShot: React.FC<OutroShotProps> = ({
  iconUrl,
  brandName,
  cta = "follow for more",
  creditName,
  creditPhotoUrl,
  creditPrefix = "made by",
  transparent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const iconSize = Math.min(width * 0.55, 540);

  const iconProgress = spring({
    frame,
    fps,
    config: { damping: 9, stiffness: 110, mass: 0.9 },
  });
  const iconScale = interpolate(iconProgress, [0, 1], [0.4, 1]);
  const iconRotate = interpolate(iconProgress, [0, 1], [-12, 0]);

  const brandProgress = spring({
    frame: frame - fps * 0.18,
    fps,
    config: { damping: 14, stiffness: 110 },
  });
  const brandY = interpolate(brandProgress, [0, 1], [50, 0]);

  const ctaProgress = spring({
    frame: frame - fps * 0.4,
    fps,
    config: { damping: 12, stiffness: 130 },
  });
  const ctaScale = interpolate(ctaProgress, [0, 1], [0.7, 1]);
  const ctaPulse = 1 + 0.04 * Math.sin((frame / fps) * Math.PI * 3);

  const creditProgress = spring({
    frame: frame - fps * 0.65,
    fps,
    config: { damping: 16, stiffness: 100 },
  });

  // Subtle continuous glow halo behind icon
  const halo = 0.7 + 0.3 * Math.sin((frame / fps) * Math.PI * 1.4);

  return (
    <AbsoluteFill>
      {!transparent && <Background variant="cool" />}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 60 }}>
        {/* Halo behind icon */}
        <div
          style={{
            position: "absolute",
            width: iconSize * 1.6,
            height: iconSize * 1.6,
            top: "50%",
            left: "50%",
            transform: `translate(-50%, calc(-50% - ${iconSize * 0.18}px)) scale(${0.9 + 0.1 * halo})`,
            background: `radial-gradient(circle, ${FOLLOW_GREEN}55 0%, transparent 60%)`,
            filter: "blur(10px)",
            pointerEvents: "none",
            opacity: iconProgress * halo,
          }}
        />

        {/* App icon */}
        <img
          src={resolveSrc(iconUrl)}
          alt={brandName}
          style={{
            width: iconSize,
            height: iconSize,
            objectFit: "contain",
            transform: `scale(${iconScale}) rotate(${iconRotate}deg)`,
            opacity: iconProgress,
            filter: `drop-shadow(0 20px 40px rgba(0,0,0,0.7)) drop-shadow(0 0 40px ${FOLLOW_GREEN}88)`,
            marginBottom: iconSize * 0.08,
          }}
        />

        {/* Brand name */}
        <div
          style={{
            fontFamily: "'Helvetica Neue', 'Arial', sans-serif",
            fontSize: iconSize * 0.17,
            fontWeight: 800,
            color: FOLLOW_GREEN,
            letterSpacing: "-0.01em",
            textShadow: `0 0 16px ${FOLLOW_GREEN}66, 0 4px 12px rgba(0,0,0,0.6)`,
            transform: `translateY(${brandY}px)`,
            opacity: brandProgress,
            marginBottom: 24,
          }}
        >
          {brandName}
        </div>

        {/* CTA pill */}
        <div
          style={{
            background: `linear-gradient(135deg, ${FOLLOW_GREEN} 0%, ${FOLLOW_GREEN_DEEP} 100%)`,
            border: `3px solid rgba(255,255,255,0.85)`,
            borderRadius: 999,
            padding: `${iconSize * 0.04}px ${iconSize * 0.1}px`,
            fontFamily: "'Helvetica Neue', 'Arial', sans-serif",
            fontSize: iconSize * 0.085,
            fontWeight: 800,
            color: "#0b1220",
            letterSpacing: "0.02em",
            textTransform: "lowercase",
            transform: `scale(${ctaScale * ctaPulse})`,
            opacity: ctaProgress,
            boxShadow: `0 14px 30px ${FOLLOW_GREEN_DEEP}88, 0 0 30px ${FOLLOW_GREEN}88`,
          }}
        >
          ▶ {cta}
        </div>

        {/* Credit row at bottom — ~half the Chess DNA icon size */}
        {creditName && (
          <div
            style={{
              position: "absolute",
              bottom: 80,
              display: "flex",
              alignItems: "center",
              gap: 22,
              padding: `${iconSize * 0.025}px ${iconSize * 0.07}px ${iconSize * 0.025}px ${iconSize * 0.025}px`,
              background: "rgba(0,0,0,0.7)",
              border: `2px solid ${FOLLOW_GREEN}`,
              borderRadius: 999,
              opacity: creditProgress,
              transform: `translateY(${interpolate(creditProgress, [0, 1], [30, 0])}px)`,
              boxShadow: `0 16px 36px rgba(0,0,0,0.6), 0 0 30px ${FOLLOW_GREEN}66`,
            }}
          >
            {creditPhotoUrl ? (
              <img
                src={resolveSrc(creditPhotoUrl)}
                alt={creditName}
                style={{
                  width: iconSize * 0.42,
                  height: iconSize * 0.42,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: `4px solid ${FOLLOW_GREEN}`,
                  boxShadow: `0 0 18px ${FOLLOW_GREEN}aa`,
                }}
              />
            ) : (
              <div
                style={{
                  width: iconSize * 0.42,
                  height: iconSize * 0.42,
                  borderRadius: "50%",
                  background: `linear-gradient(135deg, ${FOLLOW_GREEN} 0%, ${FOLLOW_GREEN_DEEP} 100%)`,
                  border: "4px solid white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#0b1220",
                  fontWeight: 900,
                  fontSize: iconSize * 0.14,
                }}
              >
                {creditName
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
              <div
                style={{
                  fontFamily: "'Helvetica Neue', sans-serif",
                  fontSize: iconSize * 0.052,
                  color: "rgba(255,255,255,0.7)",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {creditPrefix}
              </div>
              <div
                style={{
                  fontFamily: "'Helvetica Neue', sans-serif",
                  fontSize: iconSize * 0.092,
                  fontWeight: 800,
                  color: "white",
                  letterSpacing: "-0.005em",
                  textShadow: "0 2px 8px rgba(0,0,0,0.6)",
                }}
              >
                {creditName}
              </div>
            </div>
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
