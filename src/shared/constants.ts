// ── chess.com-style Expected Points classification ──
// Win chance loss thresholds (0.0 = perfect, 1.0 = game-losing)
// Based on chess.com's Expected Points Model
export const WIN_CHANCE_THRESHOLDS = {
  BEST: 0.0,        // Exactly the engine's top choice
  EXCELLENT: 0.02,   // Negligible win chance loss
  GOOD: 0.05,        // Minor win chance loss
  INACCURACY: 0.10,  // Noticeable loss of winning chances
  MISTAKE: 0.20,     // Significant worsening
  // Anything above MISTAKE threshold is a blunder
} as const;

// ── Quality Bucket Scoring ──
// Default score (0-99) for each move quality category.
// null = exclude from average (e.g. forced moves).
export const DEFAULT_BUCKET_SCORES: Record<string, number | null> = {
  brilliant: 99,
  great: 99,
  best: 99,
  excellent: 75,
  good: 50,
  book: 65,
  inaccuracy: 15,
  mistake: 3,
  miss: 1,
  blunder: 0,
  forced: null, // excluded from scoring
} as const;

// Legacy centipawn thresholds — still used for cpLoss-based accuracy calc
export const CP_THRESHOLDS = {
  BEST: 10,
  EXCELLENT: 15,
  GOOD: 25,
  OK: 50,
  INACCURACY: 100,
  MISTAKE: 200,
} as const;

// Eval threshold above which cp loss classifications are relaxed
export const WINNING_POSITION_THRESHOLD = 500;

// Brilliant move: sacrifice threshold — must give up at least this much material
export const BRILLIANT_SACRIFICE_MIN_CP = 100;
// Great move: all alternatives must be worse by at least this much win chance
export const GREAT_MOVE_ALTERNATIVE_GAP = 0.15;

// Default Stockfish analysis depth
export const DEFAULT_ANALYSIS_DEPTH = 18;

// Stockfish validation for AI-generated content
export const VALIDATION_DEPTH = 16;           // Slightly faster than game analysis — sufficient for move validation
export const VALIDATION_TOLERANCE_CP = 50;    // Moves within 50cp of best are accepted as correct
export const VALIDATION_MAX_RETRIES = 2;      // 3 total attempts (1 original + 2 retries with Stockfish feedback)

// TimeMachine challenge scoring
export const TM_ANALYSIS_DEPTH = DEFAULT_ANALYSIS_DEPTH; // Match game analysis for consistency
export const TM_PERFECT_THRESHOLD = 0.005;   // <0.5% win chance loss = score 100
export const TM_EXCELLENT_THRESHOLD = 90;
export const TM_GOOD_THRESHOLD = 70;

// Pattern recognition settings
export const PATTERN_MIN_GAMES = 3;
export const DEFAULT_WINDOW_SIZE = 50;

// Phase detection material weights (Fruit-style)
export const PHASE_WEIGHTS = {
  p: 0,
  n: 1,
  b: 1,
  r: 2,
  q: 4,
} as const;

export const TOTAL_PHASE_MATERIAL = 4 * 1 + 4 * 1 + 4 * 2 + 2 * 4; // 24

// Storage key prefixes
export const STORAGE_KEYS = {
  GAME: 'games:',
  ANALYSIS: 'analysis:',
  PATTERN_SNAPSHOTS: 'patterns:snapshots',
  PATTERN_CURRENT: 'patterns:current',
  PATTERN_EXAMPLES: 'patterns:examples',
  INSIGHT: 'insights:',
  LESSON: 'lessons:',
  EXERCISE: 'exercises:',
  SETTINGS: 'settings:user',
  TOKEN_USAGE: 'settings:tokens',
  GCP_TOKENS: 'settings:gcp_tokens',
  TRAINING_PLAN: 'training:plan',
  TRAINING_PLAN_STATE: 'training:planState',
  TRAINING_SESSION_VIEW: 'training:active-session',
  SCHEMA_VERSION: 'meta:schema_version',
} as const;

// Chess.com game URL pattern — matches both /game/live/123 and /live/game/123 formats
export const CHESS_COM_GAME_URL_REGEX = /chess\.com\/(?:game\/(?:live|daily)|(?:live|daily)\/game)\/(\d+)/;

// Chess.com public API base
export const CHESS_COM_API_BASE = 'https://api.chess.com/pub';

// Lichess game URL pattern — matches lichess.org/abcd1234
export const LICHESS_GAME_URL_REGEX = /lichess\.org\/(\w{8})/;

// Lichess API base
export const LICHESS_API_BASE = 'https://lichess.org/api';

// Claude API
export const CLAUDE_API_BASE = 'https://api.anthropic.com/v1/messages';
export const CLAUDE_API_VERSION = '2023-06-01';
export const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const CLAUDE_MAX_TOKENS = 2048;

// OpenAI API
export const OPENAI_API_BASE = 'https://api.openai.com/v1/chat/completions';
export const OPENAI_MAX_TOKENS = 2048;

// OpenAI TTS API
export const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech';
export const OPENAI_TTS_MODEL = 'gpt-4o-mini-tts';
export const OPENAI_TTS_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
  'nova', 'onyx', 'sage', 'shimmer',
] as const;
export const OPENAI_TTS_COST_PER_1K_CHARS = 0.015;

// Speaker persona instructions for gpt-4o-mini-tts
export const TTS_SPEAKER_A_INSTRUCTIONS =
  'Voice: Warm, confident, and articulate. Tone: Analytical yet approachable, like a seasoned chess commentator on a podcast. Pacing: Moderate, clear enunciation. Emotion: Enthusiastic about good moves, empathetic about mistakes. Personality: Knowledgeable host who makes complex chess ideas accessible.';

export const TTS_SPEAKER_B_INSTRUCTIONS =
  'Voice: HIGH energy, explosive, wildly enthusiastic — like a sports commentator calling a championship play. Pacing: Fast and punchy with dramatic pauses for effect. Speak with INTENSITY and genuine passion. Emotion: THRILLED by brilliant moves, SHOCKED by blunders — react like every move matters. Personality: The hype-man who makes every game feel like the World Championship final. Use vivid metaphors, exclamations, and infectious excitement.';

export const TTS_NARRATOR_INSTRUCTIONS =
  'Voice: Calm, authoritative, and reflective. Tone: Thoughtful narrator reviewing a chess game, like a documentary voiceover. Pacing: Measured and deliberate with natural pauses. Emotion: Understated but warm. Personality: Wise teacher sharing insights.';

// Gemini API
export const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
export const GEMINI_MAX_TOKENS = 2048;

// Auto-sync polling interval (3 minutes)
export const SYNC_INTERVAL_MS = 180_000;

// Admin emails allowed to access /skill and /affiliate
export const ADMIN_EMAILS = ['yuval.inc@gmail.com', 'nitzansteinberg18@gmail.com'];

// Google Cloud Podcast API (NotebookLM backend)
export const GCP_PODCAST_API_BASE = 'https://discoveryengine.googleapis.com/v1';
export const GCP_PODCAST_POLL_INTERVAL_MS = 5000;        // Poll every 5 seconds
export const GCP_PODCAST_MAX_POLL_ATTEMPTS = 120;         // 10 minutes max (120 × 5s)
export const GCP_OAUTH_SCOPES = ['https://www.googleapis.com/auth/cloud-platform'];
export const GCP_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GCP_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
