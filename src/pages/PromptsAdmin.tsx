import { useState, useMemo, useCallback, useEffect } from 'react';
import { Chess, type Square } from 'chess.js';
import { useTheme } from '@/components/ThemeContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { useEntityList, useEntityCRUD } from '@/hooks/useEntity';
import { getConfiguredProviders, createProvider } from '@/ai/ai-router';
import type { AIResponse } from '@/ai/ai-types';
import type { GameAnalysis, MoveAnalysis } from '@shared/types/analysis';
import ThemedChessboard from '@/components/ThemedChessboard';
import ExplanationText from '@/components/ExplanationText';

// ── Types ──

interface AIPromptEntity {
  id: string;
  label: string;
  systemTemplate: string;
  userTemplate: string;
  isActive: boolean;
  languages: string[]; // e.g. ['en', 'he', 'es'] or [] for all
  notes: string;
}

const AVAILABLE_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'Hebrew' },
  { code: 'es', label: 'Spanish' },
];

interface TestInputs {
  fen: string;
  playerMoveSan: string;
  playerMoveUci: string;
  bestMoveSan: string;
  bestMoveUci: string;
  cpDiff: number;
  playerRating: number;
  bestMovePv: string;
  tacticalMotifs: string;
  language: string;
}

interface ModelResult {
  status: 'loading' | 'done' | 'error';
  text?: string;
  error?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

// ── Constants ──

const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-opus-4-6': { input: 15, output: 75 },
  'claude-opus-4-5-20251101': { input: 15, output: 75 },
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gemini-2.5-flash': { input: 0.15, output: 0.6 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

const V1_SYSTEM_TEMPLATE = `You are a chess coach giving a quick, punchy explanation to a {{level}}-level player (Elo {{elo}}).
{{langStyle}}

Rules:
- Maximum 2 SHORT sentences. Be direct and conversational.
- ALWAYS wrap every square reference in brackets: [e5], [d4], [c3]. Every single square must be in brackets.
- Use piece names + bracketed squares, NOT algebraic notation. Say "knight takes on [e7]" NOT "Nxe7". Say "pawn to [c3]" NOT "b2c3" or "dxc4".
- Focus on the key idea: what the best move DOES and what the player's move MISSES.
- NEVER use markdown, algebraic notation, or UCI notation. Plain {{language}} with [square] references only.
- ONLY describe what you can verify from the FEN and the engine line. Do NOT invent tactics, piece positions, or chess concepts that aren't in the FEN.
- Do NOT invent or fabricate chess terms. Only use standard, well-known chess terminology. Never make up compound terms.
- Read the FEN carefully to know which pieces are on which squares before explaining.
- Piece names in the VERIFIED FACTS are already in {{language}}. Copy them EXACTLY — do NOT translate or substitute piece names.`;

const V1_USER_TEMPLATE = `Position (FEN): {{fen}}
Side to move: {{sideToMove}}
Player played: {{playerMoveSan}}
Best move for {{sideToMove}}: {{bestMoveSan}}
Eval difference: {{cpDiffPawns}} pawns
{{#bestMovePv}}Engine best line: {{bestMovePv}}{{/bestMovePv}}
{{#tacticalMotifs}}Tactical theme: {{tacticalMotifs}}{{/tacticalMotifs}}
{{#positionFacts}}

VERIFIED FACTS (computed by chess engine — you MUST NOT contradict these):
{{positionFacts}}{{/positionFacts}}

IMPORTANT: Generate ALL text in {{language}}. Chess move notation (like Nf3, e4) should stay in standard algebraic notation, but everything else MUST be in {{language}}.

Quick explanation:`;

const V2_SYSTEM_TEMPLATE = `You are a chess coach explaining a move to a player rated {{elo}} Elo.
{{langStyle}}

Your response MUST have exactly two parts, each on its own line:
1. "Your move:" — explain what the player's move does and why it's a problem (1 sentence).
2. "Best move:" — explain what the best move achieves and why it's stronger (1 sentence).

IMPORTANT: Write the labels in {{language}}:
- English: "Your move:" / "Best move:"
- Hebrew: "המהלך שלך:" / "המהלך הטוב:"
- Spanish: "Tu jugada:" / "La mejor jugada:"

Rules:
- Write EVERYTHING in {{language}}, including the section labels.
- ALWAYS wrap every square reference in brackets: [e5], [d4], [c3].
- Use piece names + bracketed squares, NOT algebraic notation. Say "knight to [e7]" NOT "Nxe7".
- ONLY describe what you can verify from the VERIFIED FACTS section. Do NOT invent attacks, forks, or threats that aren't listed there.
- If a fact says a piece does NOT attack something, do NOT claim it does.
- Do NOT invent or fabricate chess terms. Only use standard, well-known chess terminology. Never make up compound terms like "manual castling".
- Piece names in the VERIFIED FACTS are already in {{language}}. Copy them EXACTLY — do NOT translate or substitute piece names.
- Be concise and direct. No markdown.`;

const V2_USER_TEMPLATE = `Position (FEN): {{fen}}
Side to move: {{sideToMove}}
Player played: {{playerMoveSan}}
Best move for {{sideToMove}}: {{bestMoveSan}}
Eval difference: {{cpDiffPawns}} pawns
{{#bestMovePv}}Engine best line: {{bestMovePv}}{{/bestMovePv}}
{{#tacticalMotifs}}Tactical theme: {{tacticalMotifs}}{{/tacticalMotifs}}
{{#positionFacts}}

VERIFIED FACTS (computed by chess engine — you MUST NOT contradict these):
{{positionFacts}}{{/positionFacts}}

IMPORTANT: Generate ALL text in {{language}}. Chess move notation (like Nf3, e4) should stay in standard algebraic notation, but everything else MUST be in {{language}}.

Your move:
Best move:`;

// Default to v2
const DEFAULT_SYSTEM_TEMPLATE = V2_SYSTEM_TEMPLATE;
const DEFAULT_USER_TEMPLATE = V2_USER_TEMPLATE;

const EMPTY_INPUTS: TestInputs = {
  fen: '',
  playerMoveSan: '',
  playerMoveUci: '',
  bestMoveSan: '',
  bestMoveUci: '',
  cpDiff: 0,
  playerRating: 1200,
  bestMovePv: '',
  tacticalMotifs: '',
  language: 'English',
};

// ── Helpers ──

function interpolate(template: string, vars: Record<string, string>): string {
  let result = template;
  // Handle conditional sections: {{#var}}...{{/var}} — include only if var is non-empty
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return vars[key] ? content : '';
  });
  // Replace {{var}} placeholders
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  // Clean up blank lines from removed conditionals
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

function getLangStyle(language: string): string {
  if (!language || language === 'English')
    return 'Speak like a friendly English-speaking GM commentator — clear, direct, and insightful.';
  if (language === 'Hebrew')
    return 'דבר כמו גרוסמייסטר ישראלי — ישיר, תכליתי, בשפה טבעית של שחמטאי מקומי. השתמש במונחי שחמט עבריים מקובלים (למשל: כלי תלוי, מזלג, סיכה, שפוד, קידום, הפעלה, רוכדה). אל תתרגם מאנגלית — כתוב כאילו שחמט הוא שפת האם שלך.';
  if (language === 'Spanish')
    return 'Habla como un GM hispanohablante — directo, preciso, usando terminología ajedrecística natural en español.';
  return `Speak like a local chess GM commentator fluent in ${language}. Use natural chess terminology in ${language}.`;
}

function getLevel(rating: number): string {
  if (rating < 800) return 'beginner';
  if (rating < 1200) return 'intermediate';
  if (rating < 1800) return 'advanced';
  return 'expert';
}

function buildVars(inputs: TestInputs): { system: Record<string, string>; user: Record<string, string> } {
  const sideToMove = inputs.fen ? (inputs.fen.split(' ')[1] === 'w' ? 'White' : 'Black') : 'White';

  // Compute position facts from FEN + move UCIs
  let positionFacts = '';
  if (inputs.fen && inputs.bestMoveUci) {
    positionFacts = computePositionFacts(inputs.fen, inputs.bestMoveUci, inputs.playerMoveUci);
  }

  return {
    system: {
      level: getLevel(inputs.playerRating),
      elo: String(inputs.playerRating),
      langStyle: getLangStyle(inputs.language),
      language: inputs.language || 'English',
    },
    user: {
      fen: inputs.fen,
      sideToMove,
      playerMoveSan: inputs.playerMoveSan,
      bestMoveSan: inputs.bestMoveSan,
      cpDiffPawns: (inputs.cpDiff / 100).toFixed(1),
      bestMovePv: inputs.bestMovePv,
      tacticalMotifs: inputs.tacticalMotifs,
      positionFacts,
      language: inputs.language || 'English',
    },
  };
}

const PIECE_NAMES: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function computePositionFacts(fen: string, bestMoveUci: string, playerMoveUci?: string): string {
  const facts: string[] = [];

  const describeMove = (chess: Chess, uci: string, label: string, addThreats: boolean) => {
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promo = uci.length > 4 ? uci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
    const movingPiece = chess.get(from);
    const capturedPiece = chess.get(to);
    if (!movingPiece) return;
    const movingName = PIECE_NAMES[movingPiece.type] ?? movingPiece.type;

    if (capturedPiece) {
      let defended = false;
      try {
        const tmp = new Chess(fen);
        tmp.move({ from, to, promotion: promo });
        defended = tmp.moves({ verbose: true }).some(m => m.to === to);
      } catch { /* ignore */ }
      const capturedName = PIECE_NAMES[capturedPiece.type] ?? capturedPiece.type;
      const defNote = defended ? 'DEFENDED — opponent can recapture' : 'NOT defended — free capture';
      facts.push(`${label}: ${movingName} on [${from}] captures ${capturedName} on [${to}]. The ${capturedName} is ${defNote}.`);
    } else {
      facts.push(`${label}: ${movingName} on [${from}] moves to [${to}] (no capture).`);
    }

    // After the move, describe what the moved piece attacks and what threats exist
    if (addThreats) {
      try {
        const afterChess = new Chess(fen);
        afterChess.move({ from, to, promotion: promo });
        const isCheck = afterChess.isCheck();
        if (isCheck) facts.push(`After ${label}: gives CHECK.`);

        // To find what the moved piece attacks, we temporarily flip the turn
        // so chess.js generates moves for the piece that just moved
        const fenAfter = afterChess.fen().split(' ');
        fenAfter[1] = fenAfter[1] === 'w' ? 'b' : 'w'; // flip turn
        const flipped = new Chess(fenAfter.join(' '));
        const pieceMoves = flipped.moves({ square: to as Square, verbose: true });

        const attackedPieces: string[] = [];
        for (const m of pieceMoves) {
          const target = flipped.get(m.to as Square);
          if (target && target.color !== movingPiece.color) {
            attackedPieces.push(`${PIECE_NAMES[target.type]} on [${m.to}]`);
          }
        }

        if (attackedPieces.length > 0) {
          facts.push(`After ${label}: ${movingName} on [${to}] attacks: ${attackedPieces.join(', ')}.`);
        } else {
          facts.push(`After ${label}: ${movingName} on [${to}] does NOT directly attack any opponent pieces.`);
        }
      } catch { /* ignore */ }
    }
  };

  try {
    const chess = new Chess(fen);
    describeMove(chess, bestMoveUci, 'Best move', true);
    if (playerMoveUci && playerMoveUci.length >= 4 && playerMoveUci !== bestMoveUci) {
      describeMove(chess, playerMoveUci, "Player's move", true);
    }
  } catch { /* position facts are optional */ }
  return facts.join('\n');
}

function estimateCost(model: string, inputTokens: number, outputTokens: number): string {
  const p = PRICING[model];
  if (!p) return '?';
  const cost = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
  if (cost < 0.001) return `$${(cost * 1000).toFixed(2)}m`; // show in milli-dollars
  return `$${cost.toFixed(4)}`;
}

// ── Component ──

export default function PromptsAdmin() {
  const { settings, isAdmin } = useTheme();
  const { allGames, allAnalyses } = useChessData();

  // Entity data
  const [prompts, promptsLoading, , refetchPrompts] = useEntityList<AIPromptEntity>('AIPrompt');
  const { create, update, remove } = useEntityCRUD('AIPrompt');

  // Editor state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [systemTemplate, setSystemTemplate] = useState(DEFAULT_SYSTEM_TEMPLATE);
  const [userTemplate, setUserTemplate] = useState(DEFAULT_USER_TEMPLATE);
  const [notes, setNotes] = useState('');
  const [languages, setLanguages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Test state
  const [testInputs, setTestInputs] = useState<TestInputs>(EMPTY_INPUTS);
  const [selectedGame, setSelectedGame] = useState<string>('');
  const [selectedMoveIdx, setSelectedMoveIdx] = useState<number>(-1);
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Map<string, ModelResult>>(new Map());
  const [isRunning, setIsRunning] = useState(false);
  const [highlightedSquare, setHighlightedSquare] = useState<string | null>(null);

  // Resolved prompt overrides (when user edits in preview)
  const [systemOverride, setSystemOverride] = useState('');
  const [userOverride, setUserOverride] = useState('');

  // Board navigation state
  const [boardMoveIdx, setBoardMoveIdx] = useState<number>(-1); // -1 = starting position
  const [boardPlayerColor, setBoardPlayerColor] = useState<'white' | 'black'>('white');

  // Seed missing prompt versions
  useEffect(() => {
    if (promptsLoading) return;
    (async () => {
      let seeded = false;
      try {
        const labels = new Set(prompts.map(p => p.label));
        if (prompts.length === 0) {
          // First time — seed both
          await create<AIPromptEntity>({
            label: 'v1 — Single explanation',
            systemTemplate: V1_SYSTEM_TEMPLATE,
            userTemplate: V1_USER_TEMPLATE,
            isActive: false,
            notes: 'Original single-paragraph style from buildMoveExplanationPrompt()',
          });
          seeded = true;
        }
        if (!labels.has('v2 — Your move + Best move')) {
          await create<AIPromptEntity>({
            label: 'v2 — Your move + Best move',
            systemTemplate: V2_SYSTEM_TEMPLATE,
            userTemplate: V2_USER_TEMPLATE,
            isActive: true,
            notes: 'Two-part format: what you did wrong + what was best. Uses Elo instead of level labels.',
          });
          seeded = true;
        }
        if (seeded) {
          console.log('[Prompt Lab] Seeded missing prompt versions');
          refetchPrompts();
        }
      } catch (err) {
        console.error('[Prompt Lab] Failed to seed prompts:', err);
      }
    })();
  }, [promptsLoading, prompts.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load active prompt into editor when prompts load
  useEffect(() => {
    if (prompts.length === 0) return;
    if (activeId && prompts.find(p => p.id === activeId)) return; // already loaded
    const active = prompts.find(p => p.isActive) ?? prompts[0];
    loadPrompt(active);
  }, [prompts]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadPrompt = useCallback((p: AIPromptEntity) => {
    setActiveId(p.id);
    setLabel(p.label);
    setSystemTemplate(p.systemTemplate);
    setUserTemplate(p.userTemplate);
    setNotes(p.notes ?? '');
    setLanguages(p.languages ?? []);
  }, []);

  // ── Game/Move selectors ──

  const analyzedGames = useMemo(() =>
    allGames.filter(g => g.analysisStatus === 'complete')
      .sort((a, b) => b.playedAt - a.playedAt),
  [allGames]);

  const analysisMap = useMemo(() => {
    const map = new Map<string, GameAnalysis>();
    for (const a of allAnalyses) map.set(a.gameId, a);
    return map;
  }, [allAnalyses]);

  const selectedAnalysis = useMemo(() => {
    if (!selectedGame) return null;
    // Game entity id vs gameId field
    const game = analyzedGames.find(g => g.id === selectedGame);
    if (!game) return null;
    return analysisMap.get(game.id) ?? null;
  }, [selectedGame, analyzedGames, analysisMap]);

  const mistakeMoves = useMemo(() => {
    if (!selectedAnalysis || !selectedGame) return [];
    const game = analyzedGames.find(g => g.id === selectedGame);
    if (!game) return [];
    return selectedAnalysis.moves.filter(m =>
      m.color === game.player.color &&
      m.cpLoss > 30 &&
      m.bestMoveSan &&
      m.moveSan !== m.bestMoveSan
    );
  }, [selectedAnalysis, selectedGame, analyzedGames]);

  const handleGameSelect = useCallback((gameId: string) => {
    setSelectedGame(gameId);
    setSelectedMoveIdx(-1);
  }, []);

  const handleMoveSelect = useCallback((moveIdx: number) => {
    setSelectedMoveIdx(moveIdx);
    const move = mistakeMoves.find(m => m.halfMoveIndex === moveIdx);
    const game = analyzedGames.find(g => g.id === selectedGame);
    if (!move || !game) return;
    setTestInputs({
      fen: move.fenBefore,
      playerMoveSan: move.moveSan,
      playerMoveUci: move.moveUci ?? '',
      bestMoveSan: move.bestMoveSan,
      bestMoveUci: move.bestMoveUci ?? '',
      cpDiff: move.cpLoss,
      playerRating: game.opponent.rating,
      bestMovePv: move.pvSan?.slice(0, 5).join(' ') ?? '',
      tacticalMotifs: move.tacticalMotifs?.join(', ') ?? '',
      language: testInputs.language,
    });
    // Set board to the move BEFORE the mistake so user sees the position
    setBoardMoveIdx(moveIdx);
    setBoardPlayerColor(game.player.color);
  }, [mistakeMoves, analyzedGames, selectedGame, testInputs.language]);

  // ── Providers — show all models per provider that has an API key ──

  const allModels = useMemo(() => {
    if (!settings) return [];
    const models: Array<{ type: string; model: string; apiKey: string; available: boolean }> = [];

    // Claude models
    const claudeModels = [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-20250514',
    ];
    for (const m of claudeModels) {
      models.push({ type: 'claude', model: m, apiKey: settings.claudeApiKey ?? '', available: !!settings.claudeApiKey });
    }

    // OpenAI models
    const openaiModels = ['gpt-4o', 'gpt-4o-mini'];
    for (const m of openaiModels) {
      models.push({ type: 'openai', model: m, apiKey: settings.openaiApiKey ?? '', available: !!settings.openaiApiKey });
    }

    // Gemini models
    const geminiModels = ['gemini-2.5-flash', 'gemini-2.5-pro'];
    for (const m of geminiModels) {
      models.push({ type: 'gemini', model: m, apiKey: settings.geminiApiKey ?? '', available: !!settings.geminiApiKey });
    }

    return models;
  }, [settings]);

  // For running tests, build provider configs from allModels
  const configuredProviders = useMemo(() =>
    settings ? getConfiguredProviders(settings) : [],
  [settings]);

  const toggleModel = useCallback((key: string) => {
    setSelectedModels(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Auto-select available models on mount
  useEffect(() => {
    if (allModels.length > 0 && selectedModels.size === 0) {
      setSelectedModels(new Set(allModels.filter(m => m.available).map(m => `${m.type}:${m.model}`)));
    }
  }, [allModels]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Run test ──

  const runTest = useCallback(async () => {
    if (isRunning || !testInputs.fen) return;
    setIsRunning(true);
    setResults(new Map());

    // Use overrides if user edited the resolved preview, otherwise interpolate from template
    const vars = buildVars(testInputs);
    const system = systemOverride || interpolate(systemTemplate, vars.system);
    const user = userOverride || interpolate(userTemplate, vars.user);

    // Build provider configs for selected models
    const providers = allModels
      .filter(m => m.available && selectedModels.has(`${m.type}:${m.model}`))
      .map(m => ({ type: m.type as 'claude' | 'openai' | 'gemini', apiKey: m.apiKey, model: m.model }));

    // Initialize loading states
    const initialResults = new Map<string, ModelResult>();
    for (const p of providers) {
      initialResults.set(`${p.type}:${p.model}`, { status: 'loading' });
    }
    setResults(new Map(initialResults));

    // Fire all in parallel
    await Promise.allSettled(providers.map(async (config) => {
      const key = `${config.type}:${config.model}`;
      const start = performance.now();
      try {
        const provider = createProvider(config);
        const response: AIResponse = await provider.sendMessageWithUsage(
          system,
          [{ role: 'user', content: user }],
          300,
        );
        setResults(prev => new Map(prev).set(key, {
          status: 'done',
          text: response.text,
          durationMs: Math.round(performance.now() - start),
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        }));
      } catch (err) {
        setResults(prev => new Map(prev).set(key, {
          status: 'error',
          error: err instanceof Error ? err.message : String(err),
          durationMs: Math.round(performance.now() - start),
        }));
      }
    }));

    setIsRunning(false);
  }, [isRunning, testInputs, systemTemplate, userTemplate, configuredProviders, selectedModels]);

  // ── Save / CRUD ──

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (!label.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (activeId) {
        await update(activeId, { label, systemTemplate, userTemplate, notes, languages });
      } else {
        const created = await create({ label, systemTemplate, userTemplate, isActive: false, notes, languages });
        setActiveId((created as AIPromptEntity).id);
      }
      await refetchPrompts();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Save failed:', msg);
      setSaveError(msg);
    }
    setSaving(false);
  }, [activeId, label, systemTemplate, userTemplate, notes, create, update, refetchPrompts]);

  const handleSaveAsNew = useCallback(async () => {
    if (!label.trim()) return;
    setSaving(true);
    try {
      const newLabel = `${label} (copy)`;
      await create({ label: newLabel, systemTemplate, userTemplate, isActive: false, notes, languages });
      await refetchPrompts();
    } catch (e) {
      console.error('Save as new failed:', e);
    }
    setSaving(false);
  }, [label, systemTemplate, userTemplate, notes, create, refetchPrompts]);

  const handleDelete = useCallback(async () => {
    if (!activeId || prompts.length <= 1) return;
    setSaving(true);
    try {
      await remove(activeId);
      setActiveId(null);
      await refetchPrompts();
    } catch (e) {
      console.error('Delete failed:', e);
    }
    setSaving(false);
  }, [activeId, prompts.length, remove, refetchPrompts]);

  // ── Render ──

  if (!isAdmin) {
    return (
      <div className="text-center py-16 text-gray-400">
        <div className="text-4xl mb-3 opacity-50">🔒</div>
        <p>Admin access required</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-4 px-3 space-y-5">
      <h1 className="text-lg font-bold text-chess-text">Prompt Lab</h1>

      {/* ── SECTION 1: Prompt Editor ── */}
      <section className="bg-chess-surface rounded-xl border border-chess-border/30 p-4">
        <div className="flex items-center gap-2 mb-3">
          <select
            value={activeId ?? ''}
            onChange={e => {
              const p = prompts.find(p => p.id === e.target.value);
              if (p) loadPrompt(p);
            }}
            className="flex-1 bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
          >
            {prompts.map(p => (
              <option key={p.id} value={p.id}>
                {p.label} {p.isActive ? '(active)' : ''}
              </option>
            ))}
          </select>
          <button onClick={handleSave} disabled={saving} className="bg-chess-accent text-black text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-chess-accent/80 disabled:opacity-50">
            {saving ? '...' : 'Save'}
          </button>
          <button onClick={handleSaveAsNew} disabled={saving} className="bg-chess-overlay text-chess-text text-xs font-semibold px-3 py-1.5 rounded-lg border border-chess-border/30 hover:bg-chess-overlay/80 disabled:opacity-50">
            Save as New
          </button>
          {prompts.length > 1 && (
            <button onClick={handleDelete} disabled={saving} className="text-red-400 text-xs font-semibold px-2 py-1.5 hover:text-red-300 disabled:opacity-50">
              Delete
            </button>
          )}
        </div>

        {saveError && (
          <p className="text-xs text-red-400 mb-2">{saveError}</p>
        )}

        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Version label..."
          className="w-full bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30 mb-3"
        />

        {/* Language assignment + active toggle */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Languages:</span>
          {AVAILABLE_LANGUAGES.map(lang => {
            const selected = languages.length === 0 || languages.includes(lang.code);
            return (
              <button
                key={lang.code}
                onClick={() => {
                  if (languages.length === 0) {
                    // Currently "all" — switch to only this one
                    setLanguages([lang.code]);
                  } else if (selected && languages.length === 1) {
                    // Last one — go back to "all"
                    setLanguages([]);
                  } else if (selected) {
                    setLanguages(languages.filter(l => l !== lang.code));
                  } else {
                    setLanguages([...languages, lang.code]);
                  }
                }}
                className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-all ${
                  selected
                    ? 'bg-chess-accent/15 text-chess-accent border-chess-accent/30'
                    : 'text-gray-600 border-chess-border/20'
                }`}
              >
                {lang.label}
              </button>
            );
          })}
          <span className="text-[9px] text-gray-600 ml-1">
            {languages.length === 0 ? '(all languages)' : ''}
          </span>
        </div>

        <div className="mb-3">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">System Prompt</label>
          <textarea
            value={systemTemplate}
            onChange={e => setSystemTemplate(e.target.value)}
            rows={10}
            className="w-full bg-chess-overlay text-chess-text text-[11px] font-mono rounded px-2 py-1.5 border border-chess-border/30 resize-y"
          />
          <p className="text-[9px] text-gray-600 mt-0.5">{'Variables: {{level}}, {{elo}}, {{langStyle}}, {{language}}'}</p>
        </div>

        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">User Prompt</label>
          <textarea
            value={userTemplate}
            onChange={e => setUserTemplate(e.target.value)}
            rows={10}
            className="w-full bg-chess-overlay text-chess-text text-[11px] font-mono rounded px-2 py-1.5 border border-chess-border/30 resize-y"
          />
          <p className="text-[9px] text-gray-600 mt-0.5">{'Variables: {{fen}}, {{sideToMove}}, {{playerMoveSan}}, {{bestMoveSan}}, {{cpDiffPawns}}, {{bestMovePv}}, {{tacticalMotifs}}, {{positionFacts}}'}</p>
          <p className="text-[9px] text-gray-600">{'Conditionals: {{#bestMovePv}}...{{/bestMovePv}} — only included if non-empty'}</p>
        </div>

        <div className="mt-3">
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="What changed in this version..."
            className="w-full bg-chess-overlay text-chess-text text-[11px] rounded px-2 py-1.5 border border-chess-border/30 resize-y"
          />
        </div>
      </section>

      {/* ── Resolved Preview — shows the actual prompt that will be sent ── */}
      {testInputs.fen && (
        <ResolvedPreview
          systemTemplate={systemTemplate}
          userTemplate={userTemplate}
          testInputs={testInputs}
          onSystemOverride={setSystemOverride}
          onUserOverride={setUserOverride}
        />
      )}

      {/* ── SECTION 2: Test Position ── */}
      <section className="bg-chess-surface rounded-xl border border-chess-border/30 p-4">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-3">Test Position</h2>

        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="col-span-2">
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Game</label>
            <select
              value={selectedGame}
              onChange={e => handleGameSelect(e.target.value)}
              className="w-full bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
            >
              <option value="">Select a game...</option>
              {analyzedGames.map(g => (
                <option key={g.id} value={g.id}>
                  vs {g.opponent.username} ({g.opponent.rating}) — {g.timeClass} — {new Date(g.playedAt).toLocaleDateString()}
                </option>
              ))}
            </select>
          </div>

          {selectedGame && mistakeMoves.length > 0 && (
            <div className="col-span-2">
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">
                Mistake Move ({mistakeMoves.length} found)
              </label>
              <select
                value={selectedMoveIdx}
                onChange={e => handleMoveSelect(Number(e.target.value))}
                className="w-full bg-chess-overlay text-chess-text text-xs rounded px-2 py-1.5 border border-chess-border/30"
              >
                <option value={-1}>Select a move...</option>
                {mistakeMoves.map(m => (
                  <option key={m.halfMoveIndex} value={m.halfMoveIndex}>
                    #{m.moveNumber} {m.moveSan} (best: {m.bestMoveSan}, -{m.cpLoss}cp, {m.quality})
                  </option>
                ))}
              </select>
            </div>
          )}

          {selectedGame && mistakeMoves.length === 0 && selectedAnalysis && (
            <div className="col-span-2 text-xs text-gray-500 italic">No mistakes found in this game.</div>
          )}
        </div>

        {/* Show filled test data with board */}
        {testInputs.fen && selectedAnalysis && (() => {
          const moves = selectedAnalysis.moves;
          const currentMove = moves[boardMoveIdx] as MoveAnalysis | undefined;
          const displayFen = currentMove?.fenBefore ?? moves[0]?.fenBefore ?? testInputs.fen;
          const isSelectedMistake = boardMoveIdx === selectedMoveIdx;

          // Arrows: green = best move, red = played move (only on the mistake move)
          const arrows: Array<[Square, Square, string]> = [];
          if (isSelectedMistake && currentMove) {
            if (currentMove.bestMoveUci?.length >= 4) {
              arrows.push([currentMove.bestMoveUci.slice(0, 2) as Square, currentMove.bestMoveUci.slice(2, 4) as Square, 'rgba(74,222,128,0.8)']);
            }
            if (currentMove.moveUci?.length >= 4 && currentMove.moveUci !== currentMove.bestMoveUci) {
              arrows.push([currentMove.moveUci.slice(0, 2) as Square, currentMove.moveUci.slice(2, 4) as Square, 'rgba(239,68,68,0.6)']);
            }
          }

          return (
            <div className="space-y-2">
              {/* Board + navigation */}
              <div className="flex flex-col items-center gap-2">
                <ThemedChessboard
                  position={displayFen}
                  boardOrientation={boardPlayerColor}
                  boardWidth={280}
                  arePiecesDraggable={false}
                  customArrows={arrows}
                  customSquareStyles={highlightedSquare ? { [highlightedSquare]: { backgroundColor: 'rgba(59,130,246,0.45)' } } : undefined}
                />
                {/* Navigation controls */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setBoardMoveIdx(0)}
                    disabled={boardMoveIdx <= 0}
                    className="text-gray-400 hover:text-white disabled:opacity-20 transition-colors px-1.5 py-1 text-sm"
                  >⏮</button>
                  <button
                    onClick={() => setBoardMoveIdx(i => Math.max(0, i - 1))}
                    disabled={boardMoveIdx <= 0}
                    className="text-gray-400 hover:text-white disabled:opacity-20 transition-colors px-2 py-1 text-lg"
                  >◀</button>
                  <span className="text-[10px] text-gray-500 font-mono min-w-[60px] text-center">
                    {currentMove ? `${currentMove.moveNumber}. ${currentMove.moveSan}` : 'start'}
                    {isSelectedMistake && <span className="ml-1 text-red-400">← mistake</span>}
                  </span>
                  <button
                    onClick={() => setBoardMoveIdx(i => Math.min(moves.length - 1, i + 1))}
                    disabled={boardMoveIdx >= moves.length - 1}
                    className="text-gray-400 hover:text-white disabled:opacity-20 transition-colors px-2 py-1 text-lg"
                  >▶</button>
                  <button
                    onClick={() => setBoardMoveIdx(moves.length - 1)}
                    disabled={boardMoveIdx >= moves.length - 1}
                    className="text-gray-400 hover:text-white disabled:opacity-20 transition-colors px-1.5 py-1 text-sm"
                  >⏭</button>
                  {boardMoveIdx !== selectedMoveIdx && (
                    <button
                      onClick={() => setBoardMoveIdx(selectedMoveIdx)}
                      className="text-[10px] text-chess-accent hover:underline ml-2"
                    >Go to mistake</button>
                  )}
                </div>
              </div>

              {/* Move data chips */}
              <div className="flex gap-2 flex-wrap">
                <Chip label="Played" value={testInputs.playerMoveSan} color="text-red-400" />
                <Chip label="Best" value={testInputs.bestMoveSan} color="text-chess-accent" />
                <Chip label="CP Loss" value={String(testInputs.cpDiff)} color="text-amber-400" />
                <Chip label="Rating" value={String(testInputs.playerRating)} color="text-gray-400" />
                {testInputs.tacticalMotifs && <Chip label="Tactics" value={testInputs.tacticalMotifs} color="text-purple-400" />}
              </div>
              <div className="flex gap-2 items-center">
                <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Language</label>
                <select
                  value={testInputs.language}
                  onChange={e => setTestInputs(prev => ({ ...prev, language: e.target.value }))}
                  className="bg-chess-overlay text-chess-text text-xs rounded px-2 py-1 border border-chess-border/30"
                >
                  <option value="English">English</option>
                  <option value="Hebrew">Hebrew</option>
                  <option value="Spanish">Spanish</option>
                </select>
              </div>
            </div>
          );
        })()}
      </section>

      {/* ── SECTION 3: Model Selection + Run ── */}
      <section className="bg-chess-surface rounded-xl border border-chess-border/30 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Models</h2>
          <button
            onClick={runTest}
            disabled={isRunning || !testInputs.fen || selectedModels.size === 0}
            className="bg-chess-accent text-black text-xs font-bold px-4 py-2 rounded-lg hover:bg-chess-accent/80 disabled:opacity-40 transition-all"
          >
            {isRunning ? 'Running...' : 'Run Test'}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {allModels.map(m => {
            const key = `${m.type}:${m.model}`;
            const checked = selectedModels.has(key);
            return (
              <button
                key={key}
                onClick={() => m.available && toggleModel(key)}
                disabled={!m.available}
                className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border transition-all ${
                  !m.available
                    ? 'text-gray-600 border-chess-border/10 opacity-40 cursor-not-allowed'
                    : checked
                      ? 'bg-chess-accent/15 text-chess-accent border-chess-accent/30'
                      : 'text-gray-500 border-chess-border/20 hover:text-gray-300'
                }`}
              >
                {m.model}
                {!m.available && <span className="ml-1 text-[9px] text-gray-600">(no key)</span>}
              </button>
            );
          })}
          {configuredProviders.length === 0 && (
            <p className="text-xs text-gray-500 italic">No AI providers configured. Add API keys in Settings.</p>
          )}
        </div>
      </section>

      {/* ── SECTION 4: Results ── */}
      {results.size > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Results</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Array.from(results.entries()).map(([key, result]) => (
              <ResultCard key={key} modelKey={key} result={result} onSquareClick={setHighlightedSquare} />
            ))}
          </div>
        </section>
      )}

      {/* ── SECTION 5: All Versions ── */}
      {prompts.length > 0 && (
        <section className="bg-chess-surface rounded-xl border border-chess-border/30 p-4">
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">All Versions ({prompts.length})</h2>
          <div className="space-y-1.5">
            {prompts.map(p => {
              const langs = p.languages ?? [];
              const langLabels = langs.length === 0
                ? 'all'
                : langs.map(c => AVAILABLE_LANGUAGES.find(l => l.code === c)?.label ?? c).join(', ');
              return (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all cursor-pointer ${
                    p.id === activeId
                      ? 'bg-chess-accent/10 text-chess-accent border border-chess-accent/20'
                      : 'text-gray-400 hover:bg-white/[0.03] hover:text-gray-300'
                  }`}
                >
                  <div className="flex-1 min-w-0" onClick={() => loadPrompt(p)}>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.label}</span>
                      {p.isActive && <span className="text-[9px] bg-chess-accent/20 text-chess-accent px-1.5 py-0.5 rounded shrink-0">active</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-gray-600">{langLabels}</span>
                      {p.notes && <span className="text-[9px] text-gray-600 truncate">· {p.notes}</span>}
                    </div>
                  </div>
                  {/* Active toggle */}
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await update(p.id, { isActive: !p.isActive });
                        refetchPrompts();
                      } catch (err) {
                        console.error('Toggle active failed:', err);
                      }
                    }}
                    className={`text-[9px] font-semibold px-2 py-1 rounded border shrink-0 transition-all ${
                      p.isActive
                        ? 'bg-chess-accent/15 text-chess-accent border-chess-accent/30'
                        : 'text-gray-600 border-chess-border/20 hover:text-gray-400'
                    }`}
                    title={p.isActive ? 'Click to deactivate' : 'Click to activate'}
                  >
                    {p.isActive ? 'Active' : 'Inactive'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Sub-components ──

function ResolvedPreview({ systemTemplate, userTemplate, testInputs, onSystemOverride, onUserOverride }: {
  systemTemplate: string;
  userTemplate: string;
  testInputs: TestInputs;
  onSystemOverride: (text: string) => void;
  onUserOverride: (text: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const vars = buildVars(testInputs);
  const resolvedSystem = interpolate(systemTemplate, vars.system);
  const resolvedUser = interpolate(userTemplate, vars.user);
  const [editedSystem, setEditedSystem] = useState(resolvedSystem);
  const [editedUser, setEditedUser] = useState(resolvedUser);

  // Sync when resolved changes (new move selected, template changed)
  useEffect(() => {
    setEditedSystem(resolvedSystem);
    setEditedUser(resolvedUser);
  }, [resolvedSystem, resolvedUser]);

  // Push edits up when user modifies
  useEffect(() => {
    if (editMode) {
      onSystemOverride(editedSystem);
      onUserOverride(editedUser);
    }
  }, [editedSystem, editedUser, editMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="bg-chess-surface rounded-xl border border-chess-border/30 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-white/[0.02] transition-colors"
      >
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wide">Resolved Prompt Preview</h2>
        <span className="text-gray-500 text-xs">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.04]">
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] text-gray-600">
              {editMode ? 'Editing resolved prompts — changes apply to the next Run Test only' : 'Read-only preview of what gets sent to the AI'}
            </span>
            <button
              onClick={() => {
                if (editMode) {
                  // Reset to template-resolved values
                  setEditedSystem(resolvedSystem);
                  setEditedUser(resolvedUser);
                  onSystemOverride('');
                  onUserOverride('');
                }
                setEditMode(!editMode);
              }}
              className={`text-[10px] font-semibold px-2 py-1 rounded transition-all ${
                editMode ? 'bg-amber-500/15 text-amber-400' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {editMode ? 'Reset to template' : 'Edit before run'}
            </button>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-amber-400/70 uppercase tracking-wide block mb-1">System Prompt (resolved)</label>
            {editMode ? (
              <textarea
                value={editedSystem}
                onChange={e => setEditedSystem(e.target.value)}
                rows={8}
                className="w-full text-[10px] text-gray-300 bg-chess-overlay/50 rounded p-2.5 border border-amber-500/30 font-mono leading-relaxed resize-y"
              />
            ) : (
              <pre className="text-[10px] text-gray-300 bg-chess-overlay/50 rounded p-2.5 border border-chess-border/20 whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-y-auto">{resolvedSystem}</pre>
            )}
          </div>
          <div>
            <label className="text-[10px] font-semibold text-blue-400/70 uppercase tracking-wide block mb-1">User Prompt (resolved)</label>
            {editMode ? (
              <textarea
                value={editedUser}
                onChange={e => setEditedUser(e.target.value)}
                rows={8}
                className="w-full text-[10px] text-gray-300 bg-chess-overlay/50 rounded p-2.5 border border-blue-500/30 font-mono leading-relaxed resize-y"
              />
            ) : (
              <pre className="text-[10px] text-gray-300 bg-chess-overlay/50 rounded p-2.5 border border-chess-border/20 whitespace-pre-wrap font-mono leading-relaxed max-h-[200px] overflow-y-auto">{resolvedUser}</pre>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <span className={`text-[10px] font-mono px-2 py-1 rounded bg-white/[0.04] ${color}`}>
      <span className="text-gray-600 uppercase text-[8px] mr-1">{label}</span>{value}
    </span>
  );
}

function ResultCard({ modelKey, result, onSquareClick }: {
  modelKey: string;
  result: ModelResult;
  onSquareClick: (sq: string) => void;
}) {
  const [type, ...modelParts] = modelKey.split(':');
  const model = modelParts.join(':');

  return (
    <div className="bg-chess-overlay rounded-lg border border-chess-border/20 p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase">{type}</span>
          <span className="text-[10px] text-gray-600">{model}</span>
        </div>
        {result.status === 'loading' && (
          <span className="w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin" />
        )}
        {result.status === 'done' && result.durationMs !== undefined && (
          <span className="text-[10px] font-mono text-gray-500">{(result.durationMs / 1000).toFixed(1)}s</span>
        )}
        {result.status === 'error' && (
          <span className="text-[10px] text-red-400 font-semibold">ERROR</span>
        )}
      </div>

      {/* Body */}
      {result.status === 'loading' && (
        <div className="text-xs text-gray-600 italic">Waiting for response...</div>
      )}
      {result.status === 'error' && (
        <div className="text-xs text-red-400/80 break-all">{result.error}</div>
      )}
      {result.status === 'done' && result.text && (
        <div className="text-xs text-chess-text leading-relaxed" dir="auto">
          <ExplanationText text={result.text} onSquareClick={onSquareClick} />
        </div>
      )}

      {/* Performance metrics */}
      {result.status === 'done' && (
        <div className="flex gap-3 mt-2 pt-2 border-t border-white/[0.04]">
          {result.inputTokens !== undefined && (
            <span className="text-[9px] text-gray-600">
              <span className="text-gray-500 font-semibold">In:</span> {result.inputTokens}
            </span>
          )}
          {result.outputTokens !== undefined && (
            <span className="text-[9px] text-gray-600">
              <span className="text-gray-500 font-semibold">Out:</span> {result.outputTokens}
            </span>
          )}
          {result.inputTokens !== undefined && result.outputTokens !== undefined && (
            <span className="text-[9px] text-gray-600">
              <span className="text-gray-500 font-semibold">Cost:</span> {estimateCost(model, result.inputTokens, result.outputTokens)}
            </span>
          )}
          {result.durationMs !== undefined && (
            <span className="text-[9px] text-gray-600">
              <span className="text-gray-500 font-semibold">Time:</span> {(result.durationMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
      )}
    </div>
  );
}
