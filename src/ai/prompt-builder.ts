import type { GameSummary, GameAnalysis } from '@shared/types/analysis';
import type { WeaknessPattern, CurrentPatterns } from '@shared/types/patterns';
import type { Exercise, LessonPosition } from '@shared/types/ai';
import type { StockfishValidationResult, SequenceValidationResult } from './stockfish-validator';
import type { GameRecord } from '@shared/types/game';
import type { AudioStyle } from '@shared/types/audio';

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
 * Build prompt for generating a lesson on a specific weakness.
 */
export function buildLessonPrompt(
  weakness: WeaknessPattern,
  playerRating: number,
): string {
  const realPositions = weakness.examplePositions.slice(0, 3);
  const hasRealPositions = realPositions.length > 0;

  const positionsBlock = hasRealPositions
    ? `
IMPORTANT — Use ONLY these real positions from the player's games. Do NOT invent new FEN strings.
Copy each FEN and bestMove EXACTLY as provided. Only generate the description and explanation text.

Real positions to use:
${realPositions.map((ex, i) => `Position ${i + 1}:
  FEN: ${ex.fen}
  Move played (wrong): ${ex.movePlayed}
  Best move (correct): ${ex.bestMove}
  CP Loss: ${ex.cpLoss}`).join('\n')}`
    : '';

  return `Generate a chess lesson targeting this weakness:

Theme: ${weakness.id} (${weakness.theme})
Player rating: ${playerRating}
Frequency: ${weakness.frequency.toFixed(2)} occurrences per game
Average CP loss when this happens: ${weakness.severity}
${positionsBlock}

Respond with JSON:
{
  "title": "Lesson title (concise)",
  "difficulty": "beginner|intermediate|advanced",
  "conceptExplanation": "Markdown explanation of the concept (2-3 paragraphs, clear and instructive)",
  "examplePositions": [
    {
      "fen": "${hasRealPositions ? 'COPY the exact FEN from the real positions above' : 'valid FEN string for a realistic position'}",
      "description": "What to notice in this position",
      "correctMove": "${hasRealPositions ? 'COPY the bestMove from above (SAN notation)' : 'e4 (SAN notation)'}",
      "explanation": "Why this move is correct and what the player should have done differently"
    }
  ],
  "keyTakeaways": ["Takeaway 1", "Takeaway 2", "Takeaway 3"]
}

${hasRealPositions
    ? `Use exactly ${realPositions.length} example positions — one for each real position provided above. Do NOT modify the FEN or correctMove values.`
    : 'Generate a lesson with 2-3 example positions. Make positions realistic and instructive.'}`;
}

/**
 * Get difficulty guidance based on player rating.
 */
function getDifficultyGuidance(playerRating: number): { level: string; guidance: string } {
  if (playerRating < 1000) {
    return {
      level: 'beginner',
      guidance: `Difficulty: beginner. Use simple, clear positions with one obvious best response.
Provide generous, descriptive hints that guide the player toward the right idea.
Solutions should be 2 moves (opponent setup + player response). Keep explanations simple and encouraging.`,
    };
  } else if (playerRating < 1500) {
    return {
      level: 'intermediate',
      guidance: `Difficulty: intermediate. Use realistic middlegame and endgame positions.
Provide helpful but not overly revealing hints.
Solutions should be 2-4 moves (opponent setup, player response, and optionally a follow-up exchange).
Explanations should teach the underlying pattern.`,
    };
  } else if (playerRating < 2000) {
    return {
      level: 'advanced',
      guidance: `Difficulty: advanced. Use complex positions requiring calculation.
Provide subtle hints that point in the right direction without giving away the answer.
Solutions should be 4-6 moves. Include positions where the best move is non-obvious.`,
    };
  } else {
    return {
      level: 'expert',
      guidance: `Difficulty: expert. Use challenging positions with deep tactical or strategic ideas.
Provide minimal, cryptic hints. Solutions should involve multi-move sequences (4-6 moves).
Positions should require precise calculation and understanding of the theme.`,
    };
  }
}

/**
 * Build prompt for generating exercises targeting a weakness.
 */
export function buildExercisePrompt(
  weakness: WeaknessPattern,
  playerRating: number,
  count: number = 3,
): string {
  const { level, guidance } = getDifficultyGuidance(playerRating);

  return `Generate ${count} chess puzzle exercises targeting this weakness:

Theme: ${weakness.id} (${weakness.theme})
Player rating: ${playerRating}

${guidance}

Each exercise must be a realistic, legal chess position. Positions should be appropriate for a ${playerRating}-rated player.

CRITICAL — Puzzle format (like Lichess):
The puzzle starts with the OPPONENT making a move (the "setup move"), then the player must respond.
- "fen" is the position BEFORE the opponent's setup move (it is the OPPONENT's turn to move in this FEN)
- solution[0] is the OPPONENT's setup move (this move will be auto-played on the board)
- solution[1] is the PLAYER's first move (this is what the player must find)
- solution[2] is the OPPONENT's response (auto-played)
- solution[3] is the PLAYER's follow-up (player must find)
- ...and so on for longer sequences
- "playerColor" is the side the PLAYER controls (opposite of who moves first in the FEN)

The minimum solution length is 2 moves (opponent setup + player response).
For tactical combinations, include 3-4 moves.

Respond with JSON:
{
  "exercises": [
    {
      "fen": "valid FEN string — OPPONENT to move (before setup move)",
      "playerColor": "black",
      "solution": ["e2e4", "d7d5", "e4d5", "c6d5"],
      "solutionSan": ["e4", "d5", "exd5", "cxd5"],
      "hint": "Brief hint without giving away the answer",
      "explanation": "Why this sequence is correct and how it relates to the theme",
      "difficulty": "${level}"
    }
  ]
}

IMPORTANT: The side to move in the FEN must be the OPPONENT (not the player). playerColor must be the opposite color.
Ensure all FEN positions are legal and every move in the solution is legal from the resulting position.`;
}

/**
 * Build a retry prompt for an exercise that failed Stockfish validation.
 * Provides the engine's analysis as feedback so the AI can correct the position/solution.
 */
export function buildExerciseRetryPrompt(
  failedExercise: Exercise,
  validation: StockfishValidationResult | SequenceValidationResult,
  weakness: WeaknessPattern,
  playerRating: number,
): string {
  const { level, guidance } = getDifficultyGuidance(playerRating);

  // Extract failure details — handle both single and sequence validation results
  let failureDetail: string;
  if ('moveResults' in validation && validation.moveResults) {
    // SequenceValidationResult — report the first failed move
    const failedIdx = validation.firstFailedIndex ?? 0;
    const failedMoveResult = validation.moveResults[failedIdx];
    const moveLabel = failedMoveResult?.isPlayerMove ? 'player' : 'opponent';
    failureDetail = `- Solution failed at move ${failedIdx + 1} (${moveLabel} move):
  Your move: ${failedMoveResult?.moveUci ?? '?'} (${failedMoveResult?.moveSan ?? '?'})
  Stockfish best: ${failedMoveResult?.stockfishBestMove ?? '?'} (${failedMoveResult?.stockfishBestMoveSan ?? '?'})
  Score difference: ${failedMoveResult?.scoreDifference ?? '?'}cp
- Full solution attempted: ${failedExercise.solution.join(' → ')}`;
  } else {
    failureDetail = `- Your suggested move: ${failedExercise.solution[0]} (${failedExercise.solutionSan[0] ?? '?'})
- Stockfish best move: ${validation.stockfishBestMove} (${validation.stockfishBestMoveSan})
- Score difference: ${validation.scoreDifference}cp (tolerance: 50cp)`;
  }

  return `Your previous exercise was checked by Stockfish and the solution is NOT correct.

Previous exercise that failed validation:
- FEN: ${failedExercise.fen}
${failureDetail}
- Stockfish evaluation: ${validation.stockfishScore} ${validation.stockfishScoreType}

Theme: ${weakness.id} (${weakness.theme})
Player rating: ${playerRating}

${guidance}

Please generate 1 corrected exercise for this theme. You can either:
1. Use the same position but with the correct best move sequence as the solution
2. Generate a completely new position where the best move clearly demonstrates the theme

CRITICAL — Puzzle format (like Lichess):
The puzzle starts with the OPPONENT making a move (the "setup move"), then the player must respond.
- "fen" is the position BEFORE the opponent's setup move (it is the OPPONENT's turn to move in this FEN)
- solution[0] is the OPPONENT's setup move (this move will be auto-played on the board)
- solution[1] is the PLAYER's first move (this is what the player must find)
- solution[2] is the OPPONENT's response (auto-played)
- solution[3] is the PLAYER's follow-up (player must find)
- "playerColor" is the side the PLAYER controls (opposite of who moves first in the FEN)

The minimum solution length is 2 moves (opponent setup + player response).
Every move MUST be the actual best (or near-best) move in that position. Double-check that all FEN positions are valid and all moves are legal.

Respond with JSON:
{
  "exercises": [
    {
      "fen": "valid FEN string — OPPONENT to move (before setup move)",
      "playerColor": "black",
      "solution": ["e2e4", "d7d5", "e4d5", "c6d5"],
      "solutionSan": ["e4", "d5", "exd5", "cxd5"],
      "hint": "Brief hint without giving away the answer",
      "explanation": "Why this sequence is correct and how it relates to the theme",
      "difficulty": "${level}"
    }
  ]
}

IMPORTANT: The side to move in the FEN must be the OPPONENT (not the player). playerColor must be the opposite color.`;
}

/**
 * Build a retry prompt for a lesson position that failed Stockfish validation.
 * Provides the engine's analysis as feedback so the AI can correct the position.
 */
export function buildLessonPositionRetryPrompt(
  failedPosition: LessonPosition,
  validation: StockfishValidationResult,
  weakness: WeaknessPattern,
  playerRating: number,
): string {
  return `Your previous lesson example position was checked by Stockfish and the correctMove is NOT the best move.

Previous position that failed validation:
- FEN: ${failedPosition.fen}
- Your suggested correctMove: ${failedPosition.correctMove}
- Stockfish best move: ${validation.stockfishBestMoveSan}
- Stockfish evaluation: ${validation.stockfishScore} ${validation.stockfishScoreType}
- Score difference: ${validation.scoreDifference}cp (tolerance: 50cp)

Theme: ${weakness.id} (${weakness.theme})
Player rating: ${playerRating}

Please generate 1 corrected example position for this lesson theme. You can either:
1. Use the same position but with Stockfish's best move as the correctMove
2. Generate a new position where the best move clearly demonstrates the concept

The correctMove MUST be the actual best move in the position (in SAN notation). Double-check that the FEN is valid.

Respond with JSON:
{
  "fen": "valid FEN string",
  "description": "What to notice in this position",
  "correctMove": "Nf3 (SAN notation)",
  "explanation": "Why this move is correct"
}`;
}

// ── Audio Script Prompt Builders ──

export const AUDIO_SYSTEM_PROMPT_DEFAULT = `You are an expert chess commentator and analyst. You create engaging, insightful audio scripts that break down chess games and performance patterns.
Your commentary is entertaining yet educational — like the best chess podcasts and streams.
You reference specific move numbers, positions, and patterns.
You give actionable takeaways the player can apply immediately.
Always respond in the requested JSON format.`;

/** Use custom prompt if set, otherwise default */
export function getAudioSystemPrompt(customPrompt?: string | null): string {
  return customPrompt?.trim() || AUDIO_SYSTEM_PROMPT_DEFAULT;
}

// Keep backward compat
export const AUDIO_SYSTEM_PROMPT = AUDIO_SYSTEM_PROMPT_DEFAULT;

/**
 * Build a prompt for generating a single-game audio analysis script.
 */
export function buildGameAudioScript(
  game: GameRecord,
  analysis: GameAnalysis,
  style: AudioStyle,
  language?: string,
): string {
  // Find notable moves with rich detail
  const playerMoves = analysis.moves.filter((m) => m.color === analysis.summary.playerColor);
  const notableMoves = playerMoves.filter(
    (m) => m.quality === 'brilliant' || m.quality === 'great' || m.quality === 'blunder' || m.quality === 'mistake',
  );

  const brilliantMoves = notableMoves.filter((m) => m.quality === 'brilliant' || m.quality === 'great');
  const badMoves = notableMoves.filter((m) => m.quality === 'blunder' || m.quality === 'mistake');

  // Find key eval swings (position changed by >= 200cp or mate involved)
  const evalSwings = playerMoves
    .filter((m) => {
      const evalBefore = m.evalBefore.scoreType === 'mate' ? 9999 * Math.sign(m.evalBefore.score) : m.evalBefore.score;
      const evalAfter = m.evalAfter.scoreType === 'mate' ? 9999 * Math.sign(m.evalAfter.score) : m.evalAfter.score;
      return Math.abs(evalAfter - evalBefore) >= 200;
    })
    .slice(0, 5)
    .map((m) => ({
      moveNumber: m.moveNumber,
      played: m.moveSan,
      best: m.bestMoveSan,
      evalBefore: m.evalBefore.scoreType === 'mate' ? `M${m.evalBefore.score}` : `${(m.evalBefore.score / 100).toFixed(1)}`,
      evalAfter: m.evalAfter.scoreType === 'mate' ? `M${m.evalAfter.score}` : `${(m.evalAfter.score / 100).toFixed(1)}`,
      phase: m.phase,
      quality: m.quality,
      tacticalMotifs: m.tacticalMotifs.length > 0 ? m.tacticalMotifs : undefined,
    }));

  const gameData = {
    opponent: game.opponent.username,
    opponentRating: game.opponent.rating,
    playerRating: game.player.rating,
    result: game.player.result,
    timeClass: game.timeClass,
    opening: game.opening.name || 'Unknown opening',
    accuracy: analysis.summary.accuracy,
    acpl: analysis.summary.acpl,
    phaseAccuracy: analysis.summary.phaseAccuracy,
    totalMoves: analysis.summary.totalMoves,
    brilliantMoves: brilliantMoves.map((m) => ({
      moveNumber: m.moveNumber,
      move: m.moveSan,
      quality: m.quality,
      evalAfter: m.evalAfter.scoreType === 'mate' ? `M${m.evalAfter.score}` : `${(m.evalAfter.score / 100).toFixed(1)}`,
      bestLine: m.pvSan.slice(0, 4).join(' '),
      tacticalMotifs: m.tacticalMotifs.length > 0 ? m.tacticalMotifs : undefined,
    })),
    badMoves: badMoves.slice(0, 5).map((m) => ({
      moveNumber: m.moveNumber,
      played: m.moveSan,
      best: m.bestMoveSan,
      cpLoss: m.cpLoss,
      quality: m.quality,
      evalBefore: m.evalBefore.scoreType === 'mate' ? `M${m.evalBefore.score}` : `${(m.evalBefore.score / 100).toFixed(1)}`,
      evalAfter: m.evalAfter.scoreType === 'mate' ? `M${m.evalAfter.score}` : `${(m.evalAfter.score / 100).toFixed(1)}`,
      bestLine: m.pvSan.slice(0, 4).join(' '),
      phase: m.phase,
      tacticalMotifs: m.tacticalMotifs.length > 0 ? m.tacticalMotifs : undefined,
    })),
    keyEvalSwings: evalSwings,
    biggestMistake: analysis.summary.biggestMistake,
    moveQualities: {
      brilliant: analysis.summary.brilliantMoves,
      great: analysis.summary.greatMoves,
      best: analysis.summary.bestMoves,
      excellent: analysis.summary.excellentMoves,
      good: analysis.summary.goodMoves,
      inaccuracies: analysis.summary.inaccuracies,
      mistakes: analysis.summary.mistakes,
      blunders: analysis.summary.blunders,
    },
  };

  const styleInstructions = style === 'podcast'
    ? `Generate a podcast-style dialogue between two commentators:
- Speaker A: The analytical host — precise, references exact move numbers and evaluations
- Speaker B: HYPE commentator — bursting with energy, genuine excitement, vivid metaphors and exclamations. Reacts like every move is the most dramatic thing ever.

Generate 8-15 turns of dialogue. Each turn should be 1-3 sentences.
The conversation should flow naturally — reactions, follow-ups, building on each other's points.
Speaker B should bring EXPLOSIVE energy — gasps, exclamations, colorful language. Make it feel like championship commentary.
Start with a brief intro of the game, discuss the opening, critical moments, and end with key takeaways.`
    : `Generate a narrator-style analysis — a single voice giving a flowing, engaging post-game review.
Use speaker "A" for all turns.

Generate 4-8 paragraphs (each as a separate turn). Each paragraph should be 2-4 sentences.
Start with the game context, walk through key moments chronologically, and end with actionable advice.`;

  return `Generate an engaging audio analysis script for this chess game:

Game data:
${JSON.stringify(gameData, null, 2)}

${styleInstructions}

Respond with JSON:
{
  "turns": [
    { "speaker": "A", "text": "Welcome to the post-game analysis..." },
    { "speaker": "B", "text": "This was quite the game..." }
  ]
}

Be VERY specific about the actual moves:
- When discussing mistakes, say the exact move played vs. the best move and explain WHY it's bad (e.g. "On move 23, Bxf7 drops the exchange because after Rxf7 Qxf7, the rook is just hanging")
- When discussing brilliant moves, explain the tactic or idea behind them (e.g. "That knight sacrifice on e6 opened up the king — the engine line shows Qh5+ leading to mate in 4")
- Reference the evaluation swings — explain how the position changed (e.g. "The position went from equal to completely winning after that bishop move")
- Use the tactical motifs when available (fork, pin, skewer, discovered attack, etc.) to explain what happened
- Mention the best continuation lines to show what the engine suggests
- Name the opening and discuss whether it worked out
- Reference exact accuracy percentages and compare phases
Make it feel like a real in-depth chess commentary, not a surface-level summary.
End with 1-2 concrete things the player should work on.${language && language !== 'English' ? `\n\nIMPORTANT: Generate ALL dialogue text in ${language}. Chess move notation (like Nf3, e4) should stay in standard algebraic notation, but everything else must be in ${language}.` : ''}`;
}

/**
 * Build a prompt for generating a multi-game summary audio script.
 */
export function buildSummaryAudioScript(
  games: GameRecord[],
  analyses: GameAnalysis[],
  patterns: CurrentPatterns,
  profileScores: { dimension: string; score: number }[],
  style: AudioStyle,
  language?: string,
): string {
  // Compute aggregate stats
  const wins = games.filter((g) => g.player.result === 'win').length;
  const losses = games.filter((g) => g.player.result === 'loss').length;
  const draws = games.filter((g) => g.player.result === 'draw').length;
  const accuracies = analyses.map((a) => a.summary.accuracy);
  const avgAccuracy = accuracies.length > 0
    ? Math.round(accuracies.reduce((s, n) => s + n, 0) / accuracies.length)
    : 0;

  const phaseAccuracies = {
    opening: avgArr(analyses.map((a) => a.summary.phaseAccuracy.opening)),
    middlegame: avgArr(analyses.map((a) => a.summary.phaseAccuracy.middlegame)),
    endgame: avgArr(analyses.map((a) => a.summary.phaseAccuracy.endgame)),
  };

  // Openings played
  const openingCounts: Record<string, number> = {};
  games.forEach((g) => {
    const name = g.opening?.name || 'Unknown';
    openingCounts[name] = (openingCounts[name] || 0) + 1;
  });
  const topOpenings = Object.entries(openingCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const summaryData = {
    gameCount: games.length,
    record: { wins, losses, draws },
    winRate: games.length > 0 ? Math.round((wins / games.length) * 100) : 0,
    averageAccuracy: avgAccuracy,
    phaseAccuracy: phaseAccuracies,
    topOpenings: topOpenings.map(([name, count]) => ({ name, count })),
    topPatterns: patterns.patterns.slice(0, 5).map((p) => ({
      theme: p.theme,
      label: p.id,
      occurrences: p.occurrences,
      severity: p.severity,
      trend: p.trend,
      gamesAffected: p.gamesAffected,
    })),
    skillProfile: profileScores.slice(0, 8),
  };

  const styleInstructions = style === 'podcast'
    ? `Generate a podcast-style dialogue between two commentators:
- Speaker A: The analytical host — data-driven, references exact numbers and trends
- Speaker B: HYPE commentator — bursting with energy, genuine excitement, vivid metaphors and exclamations. Makes every stat sound incredible.

Generate 10-18 turns of dialogue. Each turn should be 1-3 sentences.
Speaker B should bring EXPLOSIVE energy — gasps, exclamations, colorful language. Make it feel like a sports highlight reel.
Discuss overall performance, then dive into patterns and specific areas.
End with a clear "action plan" — 2-3 things to focus on.`
    : `Generate a narrator-style performance review — a single voice giving a comprehensive summary.
Use speaker "A" for all turns.

Generate 5-10 paragraphs (each as a separate turn). Each paragraph should be 2-4 sentences.
Cover: overall record, accuracy trends, strongest/weakest areas, pattern analysis, and action items.`;

  return `Generate an engaging audio summary of this chess player's recent performance:

Performance data:
${JSON.stringify(summaryData, null, 2)}

${styleInstructions}

Respond with JSON:
{
  "turns": [
    { "speaker": "A", "text": "Let's dive into your recent performance..." },
    { "speaker": "B", "text": "The numbers tell an interesting story..." }
  ]
}

Be specific — reference exact win rates, accuracy numbers, and pattern names.
Compare phases (opening vs middlegame vs endgame) to highlight where the player is strong/weak.
Make actionable recommendations at the end.${language && language !== 'English' ? `\n\nIMPORTANT: Generate ALL dialogue text in ${language}. Chess terminology and notation should stay in standard form, but everything else must be in ${language}.` : ''}`;
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

  // Label format per language
  const labelInstruction = !language || language === 'English'
    ? 'Your move: [1 sentence]\nBest move: [1 sentence]'
    : language === 'Hebrew'
      ? 'המהלך שלך: [1 sentence]\nהמהלך הטוב: [1 sentence]'
      : language === 'Spanish'
        ? 'Tu jugada: [1 sentence]\nLa mejor jugada: [1 sentence]'
        : 'Your move: [1 sentence]\nBest move: [1 sentence]';

  const system = `You are a chess coach explaining a move to a ${level} player (Elo ${playerRating}).
${langStyle}

Format your response as exactly two labeled lines:
${labelInstruction}

Rules:
- 1 sentence per section. Be direct.
- Wrap square references in brackets: [e5], [d4]. Use piece names, not algebraic notation.
- Only describe what you can verify from the VERIFIED FACTS. Do not invent tactics or piece positions.
- Copy piece names from VERIFIED FACTS exactly — do not translate or substitute them.
- No markdown. No fabricated chess terms.`;

  // Determine side to move from FEN
  const sideToMove = fen.split(' ')[1] === 'w' ? 'White' : 'Black';

  const movesDiffer = playerMoveSan !== bestMoveSan;

  let user = `Position (FEN): ${fen}
Side to move: ${sideToMove}
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
    user += `\nTactical theme: ${tacticalMotifs.join(', ')}`;
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

function avgArr(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}
