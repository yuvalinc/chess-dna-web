// Standalone "card" compositions for export as GIF stickers. These reuse the
// existing OutroShot for the Chess DNA brand and a dedicated CreditCard for the
// "made by Reegan Palmer" pill (scaled up and centered).

import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";
import { Background } from "../board/Background";
import { OutroShot } from "../shots/OutroShot";

const FOLLOW_GREEN = "#4ade80";
const FOLLOW_GREEN_DEEP = "#16a34a";

function resolveSrc(url: string): string {
  return url.startsWith("http") ? url : staticFile(url);
}

export const BrandCard: React.FC<{ transparent?: boolean }> = ({ transparent = false }) => {
  return (
    <OutroShot
      type="outro"
      iconUrl="brand/chess-dna-icon.png"
      brandName="Chess DNA"
      cta="follow for more"
      transparent={transparent}
      durationSec={3}
    />
  );
};

export const BrandCardTransparent: React.FC = () => <BrandCard transparent />;

export type CreditCardProps = {
  name: string;
  prefix?: string;
  photoUrl?: string;
  transparent?: boolean;
};

export const CreditCard: React.FC<CreditCardProps> = ({
  name,
  prefix = "made by",
  photoUrl,
  transparent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Springs in, then gentle breathing animation
  const enter = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 100 },
  });
  const breath = 1 + 0.02 * Math.sin((frame / fps) * Math.PI * 1.4);

  // Sizes scaled relative to viewport width. Tuned so the pill (auto-sized to
  // content) sits comfortably inside a 1080-wide canvas with breathing room.
  const photoSize = width * 0.28;
  const padding = width * 0.038;
  const borderWidth = width * 0.007;
  const pillFontSize = width * 0.062;
  const prefixFontSize = width * 0.032;

  return (
    <AbsoluteFill>
      {!transparent && <Background variant="cool" />}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: width * 0.04,
            padding: `${padding * 0.7}px ${padding * 1.2}px ${padding * 0.7}px ${padding * 0.55}px`,
            background: "rgba(0,0,0,0.78)",
            border: `${borderWidth}px solid ${FOLLOW_GREEN}`,
            borderRadius: 9999,
            opacity: enter,
            transform: `translateY(${interpolate(enter, [0, 1], [60, 0])}px) scale(${breath})`,
            boxShadow: `0 30px 60px rgba(0,0,0,0.7), 0 0 80px ${FOLLOW_GREEN}66, inset 0 0 30px rgba(74,222,128,0.05)`,
          }}
        >
          {photoUrl ? (
            <img
              src={resolveSrc(photoUrl)}
              alt={name}
              style={{
                width: photoSize,
                height: photoSize,
                borderRadius: "50%",
                objectFit: "cover",
                border: `${borderWidth}px solid ${FOLLOW_GREEN}`,
                boxShadow: `0 0 30px ${FOLLOW_GREEN}aa, 0 12px 30px rgba(0,0,0,0.6)`,
              }}
            />
          ) : (
            <div
              style={{
                width: photoSize,
                height: photoSize,
                borderRadius: "50%",
                background: `linear-gradient(135deg, ${FOLLOW_GREEN} 0%, ${FOLLOW_GREEN_DEEP} 100%)`,
                border: `${borderWidth}px solid white`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#0b1220",
                fontWeight: 900,
                fontSize: photoSize * 0.35,
              }}
            >
              {name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.05 }}>
            <div
              style={{
                fontFamily: "'Helvetica Neue', sans-serif",
                fontSize: prefixFontSize,
                color: "rgba(255,255,255,0.7)",
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              {prefix}
            </div>
            <div
              style={{
                fontFamily: "'Helvetica Neue', sans-serif",
                fontSize: pillFontSize,
                fontWeight: 800,
                color: "white",
                letterSpacing: "-0.005em",
                textShadow: `0 0 14px ${FOLLOW_GREEN}66, 0 2px 8px rgba(0,0,0,0.7)`,
                whiteSpace: "nowrap",
              }}
            >
              {name}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const ReeganCreditCard: React.FC<{ transparent?: boolean }> = ({ transparent = false }) => (
  <CreditCard name="Reegan Palmer" prefix="made by" photoUrl="photos/reegan.jpg" transparent={transparent} />
);

export const ReeganCreditCardTransparent: React.FC = () => <ReeganCreditCard transparent />;
