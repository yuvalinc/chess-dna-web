import { AbsoluteFill } from "remotion";

export type BackgroundProps = {
  variant?: "noir" | "blueglow" | "redglow" | "warm" | "cool";
  children?: React.ReactNode;
};

const VARIANTS = {
  noir: {
    bg: "radial-gradient(ellipse at center, #1a1a1a 0%, #050505 70%, #000 100%)",
    accent: "transparent",
  },
  blueglow: {
    bg: "radial-gradient(ellipse at center, #0a1a3a 0%, #050a1a 60%, #000 100%)",
    accent: "radial-gradient(ellipse at center, rgba(34,211,238,0.18) 0%, transparent 60%)",
  },
  redglow: {
    bg: "radial-gradient(ellipse at center, #2a0a0f 0%, #0a0205 60%, #000 100%)",
    accent: "radial-gradient(ellipse at center, rgba(220,38,38,0.20) 0%, transparent 60%)",
  },
  warm: {
    bg: "radial-gradient(ellipse at center, #2a1a0a 0%, #0a0500 60%, #000 100%)",
    accent: "radial-gradient(ellipse at center, rgba(245,158,11,0.18) 0%, transparent 60%)",
  },
  cool: {
    bg: "radial-gradient(ellipse at top, #1a0a2a 0%, #050010 60%, #000 100%)",
    accent: "transparent",
  },
} as const;

export const Background: React.FC<BackgroundProps> = ({ variant = "noir", children }) => {
  const v = VARIANTS[variant];
  return (
    <>
      <AbsoluteFill style={{ background: v.bg }} />
      {v.accent !== "transparent" && <AbsoluteFill style={{ background: v.accent }} />}
      {/* Vignette */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.6) 100%)",
          pointerEvents: "none",
        }}
      />
      {/* Subtle grain */}
      <AbsoluteFill
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 numOctaves=%222%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%220.5%22/></svg>")',
          opacity: 0.06,
          mixBlendMode: "overlay",
          pointerEvents: "none",
        }}
      />
      {children}
    </>
  );
};
