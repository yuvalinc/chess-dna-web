export type StickerKind =
  | "brilliant"   // !!
  | "blunder"    // ??
  | "good"       // !
  | "mistake"    // ?
  | "interesting" // !?
  | "dubious"    // ?!
  | "fire"       // 🔥
  | "skull"      // 💀
  | "wow"        // 🤯
  | "shock"      // 😱
  | "crown"      // 👑
  | "lightning"  // ⚡
  | "warning"    // +18
  | "resign";    // RESIGNS

const PRESETS: Record<
  StickerKind,
  {
    bg: string;
    fg: string;
    border: string;
    shape: "circle" | "triangle" | "diamond";
    fontWeight: number;
    letterSpacing: string;
    fontSize: number;
    kerning?: number;
  }
> = {
  brilliant: {
    bg: "linear-gradient(135deg, #1e9b4d 0%, #0a6b2a 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "-0.05em",
    fontSize: 0.55,
  },
  blunder: {
    bg: "linear-gradient(135deg, #dc2626 0%, #7a0d0d 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "-0.05em",
    fontSize: 0.55,
  },
  good: {
    bg: "linear-gradient(135deg, #4ade80 0%, #166534 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.65,
  },
  mistake: {
    bg: "linear-gradient(135deg, #f59e0b 0%, #92400e 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.65,
  },
  interesting: {
    bg: "linear-gradient(135deg, #38bdf8 0%, #075985 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "-0.06em",
    fontSize: 0.5,
  },
  dubious: {
    bg: "linear-gradient(135deg, #a78bfa 0%, #5b21b6 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "-0.06em",
    fontSize: 0.5,
  },
  fire: {
    bg: "linear-gradient(135deg, #f97316 0%, #7c2d12 100%)",
    fg: "#fff",
    border: "#fde047",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.6,
  },
  skull: {
    bg: "linear-gradient(135deg, #1f2937 0%, #000 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.6,
  },
  wow: {
    bg: "linear-gradient(135deg, #ec4899 0%, #831843 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.6,
  },
  shock: {
    bg: "linear-gradient(135deg, #facc15 0%, #854d0e 100%)",
    fg: "#000",
    border: "#000",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.6,
  },
  crown: {
    bg: "linear-gradient(135deg, #fbbf24 0%, #78350f 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.6,
  },
  lightning: {
    bg: "linear-gradient(135deg, #38bdf8 0%, #0c4a6e 100%)",
    fg: "#fff",
    border: "#fde047",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0",
    fontSize: 0.6,
  },
  warning: {
    bg: "linear-gradient(135deg, #dc2626 0%, #4a0606 100%)",
    fg: "#fff",
    border: "#fff",
    shape: "triangle",
    fontWeight: 900,
    letterSpacing: "-0.03em",
    fontSize: 0.32,
  },
  resign: {
    bg: "linear-gradient(135deg, #1f2937 0%, #000 100%)",
    fg: "#fff",
    border: "#dc2626",
    shape: "circle",
    fontWeight: 900,
    letterSpacing: "0.04em",
    fontSize: 0.22,
  },
};

const KIND_DEFAULT_LABELS: Partial<Record<StickerKind, string>> = {
  brilliant: "!!",
  blunder: "??",
  good: "!",
  mistake: "?",
  interesting: "!?",
  dubious: "?!",
  fire: "🔥",
  skull: "💀",
  wow: "🤯",
  shock: "😱",
  crown: "👑",
  lightning: "⚡",
  warning: "+18",
  resign: "RESIGNS",
};

export type StickerProps = {
  kind: StickerKind;
  label?: string;
  size: number;
  scale?: number;
};

export const Sticker: React.FC<StickerProps> = ({ kind, label, size, scale = 1 }) => {
  const preset = PRESETS[kind];
  const text = label ?? KIND_DEFAULT_LABELS[kind] ?? "!";

  const baseStyle: React.CSSProperties = {
    width: size,
    height: size,
    background: preset.bg,
    color: preset.fg,
    fontSize: size * preset.fontSize,
    fontWeight: preset.fontWeight,
    letterSpacing: preset.letterSpacing,
    fontFamily: "Impact, 'Arial Black', 'Helvetica Neue', sans-serif",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transform: `scale(${scale}) rotate(-8deg)`,
    transformOrigin: "center center",
    boxShadow: "0 8px 24px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.4)",
    textShadow: "2px 2px 0 rgba(0,0,0,0.4)",
    lineHeight: 1,
    paddingBottom: 2,
  };

  if (preset.shape === "circle") {
    return (
      <div
        style={{
          ...baseStyle,
          borderRadius: "50%",
          border: `${Math.max(2, size * 0.06)}px solid ${preset.border}`,
        }}
      >
        {text}
      </div>
    );
  }

  if (preset.shape === "triangle") {
    // Parental-advisory style triangle
    return (
      <div
        style={{
          width: size,
          height: size,
          position: "relative",
          transform: `scale(${scale}) rotate(-6deg)`,
          transformOrigin: "center center",
          filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.5))",
        }}
      >
        <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute", inset: 0 }}>
          <defs>
            <linearGradient id={`tg-${kind}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#dc2626" />
              <stop offset="100%" stopColor="#4a0606" />
            </linearGradient>
          </defs>
          <polygon
            points="50,5 95,90 5,90"
            fill={`url(#tg-${kind})`}
            stroke={preset.border}
            strokeWidth="5"
            strokeLinejoin="round"
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            paddingTop: size * 0.18,
            color: preset.fg,
            fontWeight: preset.fontWeight,
            fontSize: size * preset.fontSize,
            fontFamily: "Impact, 'Arial Black', sans-serif",
            letterSpacing: preset.letterSpacing,
            textShadow: "2px 2px 0 #000",
            lineHeight: 1,
          }}
        >
          {text}
        </div>
      </div>
    );
  }

  // diamond
  return (
    <div
      style={{
        ...baseStyle,
        transform: `scale(${scale}) rotate(45deg)`,
        border: `${Math.max(2, size * 0.06)}px solid ${preset.border}`,
      }}
    >
      <span style={{ transform: "rotate(-45deg)" }}>{text}</span>
    </div>
  );
};
