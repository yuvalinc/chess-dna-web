// Inline SVG meme-icon library. Stylized renderings that capture the vibe
// of common chess-meme overlays without depending on copyrighted assets.

export type MemeKind =
  | "ogre"
  | "cryingCat"
  | "shockHead"
  | "fire"
  | "skull"
  | "explosion"
  | "lightning"
  | "alarm"
  | "thumbsDown"
  | "trophy";

export type MemeIconProps = {
  kind: MemeKind;
  size: number;
};

const OgreFace: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <radialGradient id="ogre-skin" cx="0.5" cy="0.4" r="0.6">
        <stop offset="0%" stopColor="#9bcf65" />
        <stop offset="70%" stopColor="#6fa83a" />
        <stop offset="100%" stopColor="#3d6b1c" />
      </radialGradient>
    </defs>
    {/* Head */}
    <ellipse cx="50" cy="55" rx="38" ry="36" fill="url(#ogre-skin)" stroke="#1a3408" strokeWidth="2" />
    {/* Ears (trumpet-style) */}
    <ellipse cx="14" cy="50" rx="6" ry="10" fill="url(#ogre-skin)" stroke="#1a3408" strokeWidth="1.5" />
    <ellipse cx="86" cy="50" rx="6" ry="10" fill="url(#ogre-skin)" stroke="#1a3408" strokeWidth="1.5" />
    {/* Eyes */}
    <ellipse cx="38" cy="48" rx="6" ry="5" fill="#fff" stroke="#1a3408" strokeWidth="1" />
    <ellipse cx="62" cy="48" rx="6" ry="5" fill="#fff" stroke="#1a3408" strokeWidth="1" />
    <circle cx="39" cy="49" r="2.5" fill="#1a1a1a" />
    <circle cx="63" cy="49" r="2.5" fill="#1a1a1a" />
    {/* Brows */}
    <path d="M 30 38 Q 38 33 46 38" fill="none" stroke="#1a3408" strokeWidth="3" strokeLinecap="round" />
    <path d="M 54 38 Q 62 33 70 38" fill="none" stroke="#1a3408" strokeWidth="3" strokeLinecap="round" />
    {/* Nose */}
    <ellipse cx="50" cy="62" rx="6" ry="4" fill="#5a8a2e" stroke="#1a3408" strokeWidth="1" />
    {/* Mouth (smug) */}
    <path d="M 38 76 Q 50 72 62 76" fill="none" stroke="#1a3408" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

const CryingCat: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <radialGradient id="cat-fur" cx="0.5" cy="0.4" r="0.6">
        <stop offset="0%" stopColor="#fafafa" />
        <stop offset="100%" stopColor="#c8c8c8" />
      </radialGradient>
    </defs>
    {/* Head */}
    <ellipse cx="50" cy="58" rx="36" ry="34" fill="url(#cat-fur)" stroke="#3a3a3a" strokeWidth="1.5" />
    {/* Ears (triangular) */}
    <polygon points="20,32 24,12 38,30" fill="url(#cat-fur)" stroke="#3a3a3a" strokeWidth="1.5" />
    <polygon points="80,32 76,12 62,30" fill="url(#cat-fur)" stroke="#3a3a3a" strokeWidth="1.5" />
    <polygon points="24,28 26,18 33,28" fill="#ffb3c1" />
    <polygon points="76,28 74,18 67,28" fill="#ffb3c1" />
    {/* Eyes — big and watery */}
    <ellipse cx="36" cy="55" rx="9" ry="10" fill="#fff" stroke="#3a3a3a" strokeWidth="1.5" />
    <ellipse cx="64" cy="55" rx="9" ry="10" fill="#fff" stroke="#3a3a3a" strokeWidth="1.5" />
    <circle cx="36" cy="56" r="5" fill="#1a1a1a" />
    <circle cx="64" cy="56" r="5" fill="#1a1a1a" />
    <circle cx="37.5" cy="54" r="1.5" fill="#fff" />
    <circle cx="65.5" cy="54" r="1.5" fill="#fff" />
    {/* Tear drops */}
    <path d="M 30 67 Q 28 76 32 80 Q 36 76 34 67 Z" fill="#5eb8ff" stroke="#1d4ed8" strokeWidth="0.8" />
    <path d="M 70 67 Q 68 76 72 80 Q 76 76 74 67 Z" fill="#5eb8ff" stroke="#1d4ed8" strokeWidth="0.8" />
    {/* Mouth (frown) */}
    <path d="M 42 78 Q 50 73 58 78" fill="none" stroke="#3a3a3a" strokeWidth="2" strokeLinecap="round" />
    {/* Whiskers */}
    <line x1="5" y1="62" x2="20" y2="60" stroke="#3a3a3a" strokeWidth="1" />
    <line x1="5" y1="68" x2="20" y2="68" stroke="#3a3a3a" strokeWidth="1" />
    <line x1="80" y1="60" x2="95" y2="62" stroke="#3a3a3a" strokeWidth="1" />
    <line x1="80" y1="68" x2="95" y2="68" stroke="#3a3a3a" strokeWidth="1" />
  </svg>
);

const ShockHead: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    {/* Yellow circle background */}
    <circle cx="50" cy="50" r="44" fill="#fbbf24" stroke="#7c2d12" strokeWidth="2.5" />
    {/* Wide-eyed shock */}
    <circle cx="36" cy="46" r="9" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
    <circle cx="64" cy="46" r="9" fill="#fff" stroke="#1a1a1a" strokeWidth="1.5" />
    <circle cx="36" cy="46" r="4" fill="#1a1a1a" />
    <circle cx="64" cy="46" r="4" fill="#1a1a1a" />
    {/* Open mouth (O shape) */}
    <ellipse cx="50" cy="72" rx="9" ry="11" fill="#1a1a1a" />
    <ellipse cx="50" cy="76" rx="5" ry="4" fill="#dc2626" />
    {/* Eyebrows (raised) */}
    <path d="M 26 30 Q 36 24 46 32" fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
    <path d="M 54 32 Q 64 24 74 30" fill="none" stroke="#1a1a1a" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

const Fire: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <linearGradient id="flame-g" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="50%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#dc2626" />
      </linearGradient>
    </defs>
    <path
      d="M 50 95 Q 18 80 24 50 Q 32 60 36 52 Q 30 30 50 8 Q 56 30 64 38 Q 70 30 76 42 Q 84 70 50 95 Z"
      fill="url(#flame-g)"
      stroke="#7c2d12"
      strokeWidth="1.5"
    />
    <path d="M 50 80 Q 36 70 42 55 Q 46 62 50 56 Q 54 64 58 56 Q 62 64 58 75 Q 54 82 50 80 Z" fill="#fde047" />
  </svg>
);

const Skull: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <ellipse cx="50" cy="44" rx="32" ry="34" fill="#f5f5f5" stroke="#1a1a1a" strokeWidth="2" />
    <rect x="38" y="72" width="24" height="14" fill="#f5f5f5" stroke="#1a1a1a" strokeWidth="2" rx="2" />
    {/* Eye sockets */}
    <ellipse cx="36" cy="44" rx="8" ry="10" fill="#1a1a1a" />
    <ellipse cx="64" cy="44" rx="8" ry="10" fill="#1a1a1a" />
    {/* Nose */}
    <polygon points="50,52 46,62 54,62" fill="#1a1a1a" />
    {/* Teeth */}
    <line x1="44" y1="74" x2="44" y2="86" stroke="#1a1a1a" strokeWidth="1.5" />
    <line x1="50" y1="74" x2="50" y2="86" stroke="#1a1a1a" strokeWidth="1.5" />
    <line x1="56" y1="74" x2="56" y2="86" stroke="#1a1a1a" strokeWidth="1.5" />
  </svg>
);

const Explosion: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <radialGradient id="boom-g" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0%" stopColor="#fef3c7" />
        <stop offset="30%" stopColor="#fbbf24" />
        <stop offset="65%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#dc2626" />
      </radialGradient>
    </defs>
    {/* Jagged star burst */}
    <polygon
      points="50,5 58,30 85,15 65,40 95,50 65,60 85,85 58,70 50,95 42,70 15,85 35,60 5,50 35,40 15,15 42,30"
      fill="url(#boom-g)"
      stroke="#7c2d12"
      strokeWidth="1.5"
    />
    {/* Inner highlight */}
    <circle cx="50" cy="50" r="12" fill="#fff" opacity="0.7" />
    <text
      x="50"
      y="60"
      textAnchor="middle"
      fontFamily="Impact, sans-serif"
      fontSize="22"
      fontWeight="900"
      fill="#7c2d12"
    >
      BOOM
    </text>
  </svg>
);

const Lightning: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <linearGradient id="bolt-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fef3c7" />
        <stop offset="50%" stopColor="#fde047" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
    <polygon
      points="55,5 25,52 45,52 35,95 75,42 55,42 70,5"
      fill="url(#bolt-g)"
      stroke="#7c2d12"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  </svg>
);

const AlarmBell: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <linearGradient id="bell-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#dc2626" />
        <stop offset="100%" stopColor="#7f1d1d" />
      </linearGradient>
    </defs>
    {/* Bell body */}
    <path
      d="M 50 18 Q 25 18 25 60 L 18 70 L 82 70 L 75 60 Q 75 18 50 18 Z"
      fill="url(#bell-g)"
      stroke="#1a1a1a"
      strokeWidth="2"
    />
    {/* Handle on top */}
    <circle cx="50" cy="14" r="5" fill="#1a1a1a" />
    {/* Clapper */}
    <circle cx="50" cy="78" r="6" fill="#1a1a1a" />
    {/* Vibration lines */}
    <path d="M 10 35 Q 6 45 10 55" stroke="#fbbf24" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M 90 35 Q 94 45 90 55" stroke="#fbbf24" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M 4 30 Q -2 45 4 60" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M 96 30 Q 102 45 96 60" stroke="#fbbf24" strokeWidth="2" fill="none" strokeLinecap="round" />
  </svg>
);

const ThumbsDown: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <linearGradient id="td-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#f97316" />
        <stop offset="100%" stopColor="#7c2d12" />
      </linearGradient>
    </defs>
    <g stroke="#1a1a1a" strokeWidth="2" strokeLinejoin="round" fill="url(#td-g)">
      {/* Wristband */}
      <rect x="15" y="18" width="20" height="22" rx="2" />
      {/* Fist (rotated thumbs down) */}
      <path d="M 35 22 L 70 22 Q 88 22 88 38 Q 88 52 75 52 L 60 52 L 60 70 Q 60 88 48 88 Q 38 88 38 78 L 38 52 L 35 52 Z" />
      {/* Knuckle lines */}
      <line x1="50" y1="58" x2="50" y2="78" />
      <line x1="60" y1="35" x2="74" y2="35" />
    </g>
  </svg>
);

const Trophy: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100">
    <defs>
      <linearGradient id="trophy-g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#fde047" />
        <stop offset="100%" stopColor="#a16207" />
      </linearGradient>
    </defs>
    <g stroke="#5c3a05" strokeWidth="2" strokeLinejoin="round" fill="url(#trophy-g)">
      {/* Cup */}
      <path d="M 28 18 L 72 18 L 70 50 Q 70 64 50 64 Q 30 64 30 50 Z" />
      {/* Handles */}
      <path d="M 28 22 Q 14 22 14 36 Q 14 48 28 48" fill="none" />
      <path d="M 72 22 Q 86 22 86 36 Q 86 48 72 48" fill="none" />
      {/* Stem */}
      <rect x="44" y="64" width="12" height="14" />
      {/* Base */}
      <rect x="30" y="78" width="40" height="8" rx="1" />
      <rect x="22" y="86" width="56" height="6" rx="1" />
    </g>
    {/* Star on cup */}
    <polygon
      points="50,30 53,38 62,38 55,43 58,52 50,47 42,52 45,43 38,38 47,38"
      fill="#fff"
      stroke="#5c3a05"
      strokeWidth="1"
    />
  </svg>
);

export const MemeIcon: React.FC<MemeIconProps> = ({ kind, size }) => {
  switch (kind) {
    case "ogre":
      return <OgreFace size={size} />;
    case "cryingCat":
      return <CryingCat size={size} />;
    case "shockHead":
      return <ShockHead size={size} />;
    case "fire":
      return <Fire size={size} />;
    case "skull":
      return <Skull size={size} />;
    case "explosion":
      return <Explosion size={size} />;
    case "lightning":
      return <Lightning size={size} />;
    case "alarm":
      return <AlarmBell size={size} />;
    case "thumbsDown":
      return <ThumbsDown size={size} />;
    case "trophy":
      return <Trophy size={size} />;
    default:
      return null;
  }
};
