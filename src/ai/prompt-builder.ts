import type { GameSummary, GamePhase } from '@shared/types/analysis';
import type { WeaknessPattern } from '@shared/types/patterns';
import { getThemesForPhase, isValidThemeSlug, MOTIF_TO_THEME } from '@shared/theme-catalog';

export const SYSTEM_PROMPT = `You are an expert chess coach providing personalized analysis and training.
You adapt your language and explanations to the player's rating level.
You are encouraging but honest about weaknesses.
You focus on actionable advice, not generic platitudes.
Reference specific positions and patterns when possible.
Always respond in the requested JSON format.`;

/** Append language instruction to a prompt when language is not English */
function withLanguage(prompt: string, language?: string): string {
  if (!language || language === 'English') return prompt;
  return prompt + `\n\nIMPORTANT: Generate ALL text in ${language}. Chess move notation (like Nf3, e4) should stay in standard algebraic notation, but everything else must be in ${language}.`;
}

/**
 * Build the controlled-vocabulary block injected into move-explanation prompts.
 * Returns a string ready to append to the system prompt — includes the THEMES:
 * output-format instruction and the phase-scoped slug list.
 */
export function buildThemeVocabBlock(
  phase: GamePhase | undefined,
  tacticalMotifs: string[] | undefined,
): string {
  const vocabPhase: GamePhase = phase ?? 'middlegame';
  const phaseVocab = getThemesForPhase(vocabPhase).map((t) => t.slug);
  const confirmedSlugs = (tacticalMotifs ?? [])
    .map((m) => MOTIF_TO_THEME[m] ?? m)
    .filter((s) => isValidThemeSlug(s));

  return `\n\nAt the very TOP of your response, on its own line, emit:
THEMES: slug1, slug2, slug3
— up to 3 theme slugs from the vocabulary below, comma-separated, that actually apply to THIS move. If none clearly apply, write "THEMES: none". Theme slugs stay in English regardless of the response language.

Whenever you mention any of these themes in your Your move / Best move sentences, use the exact NOUN FORM of the theme (not a verb), so the user can tap it for a definition. For example: say "this is a fork" (not "this forks"); say "the rook is a hanging piece" (not "the rook hangs"); say "a back-rank mate" (not "mate on the back rank"). In Hebrew and Spanish, use the natural noun form (e.g. "מזלג", "horquilla").

Controlled theme vocabulary (use slugs from this list only):
${phaseVocab.join(', ')}${confirmedSlugs.length ? `\n\nEngine-confirmed themes for this position (prefer these): ${confirmedSlugs.join(', ')}` : ''}`;
}

/**
 * Build prompt for generating personalized insights from recent games.
 */
export function buildInsightPrompt(
  playerRating: number,
  recentGames: GameSummary[],
  patterns: WeaknessPattern[],
  language?: string,
): string {
  const context = {
    playerRating,
    gamesAnalyzed: recentGames.length,
    averageAccuracy: avg(recentGames.map((g) => g.accuracy)),
    topWeaknesses: patterns.slice(0, 5).map((p) => ({
      theme: p.id,
      frequency: p.frequency,
      avgCpLoss: p.severity,
      trend: p.trend,
      gamesAffected: p.gamesAffected,
      exampleFen: p.examplePositions[0]?.fen,
      examplePlayed: p.examplePositions[0]?.movePlayed,
      exampleBest: p.examplePositions[0]?.bestMove,
    })),
    phaseBreakdown: {
      opening: avg(recentGames.map((g) => g.phaseAccuracy.opening)),
      middlegame: avg(recentGames.map((g) => g.phaseAccuracy.middlegame)),
      endgame: avg(recentGames.map((g) => g.phaseAccuracy.endgame)),
    },
  };

  const prompt = `Analyze this chess player's recent performance and generate personalized insights.

Player data:
${JSON.stringify(context, null, 2)}

Respond with JSON in this exact format:
{
  "insights": [
    {
      "text": "Your personalized observation (use 'you' form, be specific)",
      "themes": ["theme_id_1"],
      "priority": "high"
    }
  ]
}

Generate 2-3 insights. Focus on the most impactful, actionable observations.
Prioritize patterns that are worsening. Reference specific phases or openings when relevant.`;
  return withLanguage(prompt, language);
}

/**
 * Build prompt for explaining a chess move in TimeMachine.
 * Returns system + user prompts for AI to generate a 2-3 sentence explanation.
 *
 * @param positionFacts - Pre-computed chess facts (captures, piece defense) verified by chess.js.
 *                        When provided, the AI is instructed NOT to contradict these facts.
 */
export function buildMoveExplanationPrompt(
  fen: string,
  playerMoveSan: string,
  bestMoveSan: string,
  cpDiff: number,
  playerRating: number,
  bestMovePv?: string[],
  tacticalMotifs?: string[],
  positionFacts?: string,
  language?: string,
  /** The color the user (the person being coached) is playing as. When set,
   *  the prompt explicitly anchors the perspective so the AI cannot flip
   *  "Your move" onto the opponent's side. */
  playerColor?: 'white' | 'black',
  /** Game phase ("opening" | "middlegame" | "endgame"). Used to scope the
   *  theme vocabulary so the AI doesn't have to scan 80 themes when only ~30
   *  are relevant for the current phase. */
  phase?: GamePhase,
): { system: string; user: string } {
  const level = playerRating < 800 ? 'beginner' : playerRating < 1200 ? 'intermediate' : playerRating < 1800 ? 'advanced' : 'expert';

  // Language-specific GM style instructions
  const langStyle = !language || language === 'English'
    ? 'Speak like a friendly English-speaking GM commentator — clear, direct, and insightful.'
    : language === 'Hebrew'
      ? 'דבר כמו גרוסמייסטר ישראלי — ישיר, תכליתי, בשפה טבעית של שחמטאי מקומי. שמות כלים: מלך, מלכה, צריח, רץ, פרש, חייל (לא "רגלי"). מונחים: כלי תלוי, מזלג, סיכה, שפוד, קידום, הפעלה, רוכדה. אל תתרגם מאנגלית — כתוב כאילו שחמט הוא שפת האם שלך.'
      : language === 'Spanish'
        ? 'Habla como un GM hispanohablante — directo, preciso, usando terminología ajedrecística natural en español (ejemplo: pieza colgada, clavada, horquilla, enfilada, enroque). No traduzcas del inglés — escribe como si el ajedrez fuera tu lengua materna.'
        : `Speak like a local chess GM commentator fluent in ${language}. Use natural chess terminology in ${language}.`;

  // Label format per language. Both sides are kept short — "Your move" is
  // exactly 1 sentence, "Best move" is at most 2 short sentences so the
  // panel never grows past 3-4 lines. Pedagogical value is preserved
  // (name the move + the idea), but no padding or third sentence.
  const labelInstruction = !language || language === 'English'
    ? 'Your move: [exactly 1 sentence]\nBest move: [1-2 short sentences, max ~40 words total — sentence 1 names the move and what it does; if needed, sentence 2 gives the idea (the tactical or positional reason) or the concrete threat/follow-up]'
    : language === 'Hebrew'
      ? 'המהלך שלך: [משפט אחד]\nהמהלך הטוב: [1-2 משפטים קצרים, עד ~40 מילים בסך הכל — משפט 1: שם המהלך ומה הוא עושה; אם צריך, משפט 2: הרעיון (סיבה טקטית או עמדתית) או האיום הקונקרטי/ההמשך]'
      : language === 'Spanish'
        ? 'Tu jugada: [exactamente 1 frase]\nLa mejor jugada: [1-2 frases cortas, máximo ~40 palabras en total — la primera nombra la jugada y lo que hace; si hace falta, la segunda da la idea (razón táctica o posicional) o la amenaza/continuación concreta]'
        : 'Your move: [exactly 1 sentence]\nBest move: [1-2 short sentences, max ~40 words total — sentence 1 names the move and what it does; if needed, sentence 2 gives the idea (the tactical or positional reason) or the concrete threat/follow-up]';

  const system = `You are a chess coach explaining a move to a ${level} player (Elo ${playerRating}).
${langStyle}

Format your response as exactly two labeled lines:
${labelInstruction}

CRITICAL RULES (the response is rejected if these are violated):
- "Your move" is EXACTLY ONE sentence — direct, honest, no padding.
- "Best move" is 1-2 short sentences, at most ~40 words total. Sentence 1: name the move and what it does. Sentence 2 (optional, only if it adds value): the tactical/positional idea OR the concrete threat / follow-up line. NEVER write a third sentence. Skip sentence 2 entirely when the move's purpose is obvious from sentence 1.
- Wrap square references in brackets: [e5], [d4]. Use piece names, not algebraic notation.
- Only describe what you can verify from the VERIFIED FACTS. Do not invent tactics or piece positions.
- Copy piece names from VERIFIED FACTS exactly — do not translate or substitute them.
- No markdown. No fabricated chess terms.` + buildThemeVocabBlock(phase, tacticalMotifs);

  // Determine side to move from FEN
  const sideToMove = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
  const userSide = playerColor ? (playerColor === 'white' ? 'White' : 'Black') : sideToMove;

  const movesDiffer = playerMoveSan !== bestMoveSan;

  let user = `Position (FEN): ${fen}
Side to move: ${sideToMove}
The player you are coaching is playing as: ${userSide}
"Your move" in your response MUST refer to ${userSide}'s move (${playerMoveSan}). Never describe the opponent's pieces as if they were the player's.
Player played: ${playerMoveSan}
Best move for ${sideToMove}: ${bestMoveSan}
Eval difference: ${(cpDiff / 100).toFixed(1)} pawns`;

  if (movesDiffer) {
    user += `\n\nCRITICAL: The player's move (${playerMoveSan}) is DIFFERENT from the best move (${bestMoveSan}). You MUST describe two different moves. Do NOT describe the same move for both sections.`;
  }

  if (bestMovePv && bestMovePv.length > 0) {
    user += `\nEngine best line: ${bestMovePv.slice(0, 5).join(' ')}`;
  }
  if (tacticalMotifs && tacticalMotifs.length > 0) {
    user += `\nEngine-detected motifs (raw): ${tacticalMotifs.join(', ')}`;
  }
  if (positionFacts) {
    user += `\n\nVERIFIED FACTS (do NOT contradict):\n${positionFacts}`;
  }

  if (language && language !== 'English') {
    user += `\n\nIMPORTANT: Respond entirely in ${language}. Chess notation stays standard.`;
  }

  return { system, user };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}
