/**
 * Builds context payloads for the Google Cloud Podcast API.
 *
 * Instead of generating a script via AI then synthesizing with TTS,
 * we send rich chess data as context and let the Podcast API generate
 * both the conversational script and audio in one step.
 *
 * The data extraction mirrors prompt-builder.ts but formats as structured
 * context text rather than LLM instruction prompts.
 */

import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { CurrentPatterns } from '@shared/types/patterns';
import type { CreatePodcastRequest, PodcastLength } from '@shared/types/podcast';

/* ─────── Single game podcast ─────── */

export function buildGamePodcastRequest(
  game: GameRecord,
  analysis: GameAnalysis,
  length: PodcastLength,
): CreatePodcastRequest {
  const contextText = buildGameContextText(game, analysis);

  return {
    podcastConfig: {
      focus: [
        `Detailed analysis of a chess game between the player (${game.player.username}, rated ${game.player.rating})`,
        `and ${game.opponent.username} (rated ${game.opponent.rating}).`,
        `Focus on: the opening choice, critical tactical and strategic moments, mistakes and why they happened,`,
        `brilliant moves and the ideas behind them, and end with concrete, actionable advice for improvement.`,
        `Be specific about move numbers, evaluations, and chess concepts.`,
      ].join(' '),
      length,
      languageCode: 'en',
    },
    contexts: [{ text: contextText }],
    title: `Chess Analysis: ${game.player.username} vs ${game.opponent.username}`,
    description: `${game.timeClass} game — ${game.opening.name || 'Unknown opening'} — Result: ${game.player.result}`,
  };
}

/* ─────── Multi-game summary podcast ─────── */

export function buildSummaryPodcastRequest(
  games: GameRecord[],
  analyses: GameAnalysis[],
  patterns: CurrentPatterns,
  profileScores: { dimension: string; score: number }[],
  length: PodcastLength,
): CreatePodcastRequest {
  const contextText = buildSummaryContextText(games, analyses, patterns, profileScores);

  return {
    podcastConfig: {
      focus: [
        `Performance review of a chess player's recent ${games.length} games.`,
        `Discuss: overall win/loss record, accuracy trends, strongest and weakest game phases,`,
        `recurring weakness patterns, opening choices, and the player's skill profile.`,
        `End with a concrete 3-point improvement plan the player can follow.`,
      ].join(' '),
      length,
      languageCode: 'en',
    },
    contexts: [{ text: contextText }],
    title: `Chess Performance Review: ${games.length} Recent Games`,
    description: `Comprehensive analysis covering accuracy, patterns, and skill dimensions`,
  };
}

/* ─────── Context text builders ─────── */

function buildGameContextText(game: GameRecord, analysis: GameAnalysis): string {
  const playerMoves = analysis.moves.filter((m) => m.color === analysis.summary.playerColor);
  const notableMoves = playerMoves.filter(
    (m) => m.quality === 'brilliant' || m.quality === 'great' || m.quality === 'blunder' || m.quality === 'mistake',
  );

  const brilliantMoves = notableMoves.filter((m) => m.quality === 'brilliant' || m.quality === 'great');
  const badMoves = notableMoves.filter((m) => m.quality === 'blunder' || m.quality === 'mistake');

  // Find key eval swings (>= 200cp change)
  const evalSwings = playerMoves
    .filter((m) => {
      const before = m.evalBefore.scoreType === 'mate' ? 9999 * Math.sign(m.evalBefore.score) : m.evalBefore.score;
      const after = m.evalAfter.scoreType === 'mate' ? 9999 * Math.sign(m.evalAfter.score) : m.evalAfter.score;
      return Math.abs(after - before) >= 200;
    })
    .slice(0, 5);

  const formatEval = (m: { scoreType: string; score: number }) =>
    m.scoreType === 'mate' ? `M${m.score}` : `${(m.score / 100).toFixed(1)}`;

  const sections: string[] = [];

  // Game overview
  sections.push(`=== CHESS GAME ANALYSIS DATA ===

Game Overview:
- Player: ${game.player.username} (rated ${game.player.rating}, playing ${analysis.summary.playerColor})
- Opponent: ${game.opponent.username} (rated ${game.opponent.rating})
- Result: ${game.player.result}
- Time control: ${game.timeClass}
- Opening: ${game.opening.name || 'Unknown'}${game.opening.eco ? ` (${game.opening.eco})` : ''}
- Total moves: ${analysis.summary.totalMoves}
`);

  // Accuracy
  sections.push(`Accuracy:
- Overall: ${analysis.summary.accuracy.toFixed(1)}%
- Average centipawn loss: ${analysis.summary.acpl}
- Opening accuracy: ${analysis.summary.phaseAccuracy.opening.toFixed(1)}%
- Middlegame accuracy: ${analysis.summary.phaseAccuracy.middlegame.toFixed(1)}%
- Endgame accuracy: ${analysis.summary.phaseAccuracy.endgame.toFixed(1)}%
`);

  // Move quality distribution
  sections.push(`Move Quality Distribution:
- Brilliant: ${analysis.summary.brilliantMoves}
- Great: ${analysis.summary.greatMoves}
- Best: ${analysis.summary.bestMoves}
- Excellent: ${analysis.summary.excellentMoves}
- Good: ${analysis.summary.goodMoves}
- Inaccuracies: ${analysis.summary.inaccuracies}
- Mistakes: ${analysis.summary.mistakes}
- Blunders: ${analysis.summary.blunders}
`);

  // Brilliant/great moves
  if (brilliantMoves.length > 0) {
    sections.push('Brilliant and Great Moves:');
    for (const m of brilliantMoves) {
      sections.push(`- Move ${m.moveNumber}: ${m.moveSan} (${m.quality})
  Eval after: ${formatEval(m.evalAfter)}
  Best line: ${m.pvSan.slice(0, 4).join(' ')}${m.tacticalMotifs.length > 0 ? `\n  Tactical motifs: ${m.tacticalMotifs.join(', ')}` : ''}`);
    }
    sections.push('');
  }

  // Bad moves
  if (badMoves.length > 0) {
    sections.push('Mistakes and Blunders:');
    for (const m of badMoves.slice(0, 5)) {
      sections.push(`- Move ${m.moveNumber}: played ${m.moveSan} (${m.quality}, ${m.cpLoss}cp loss)
  Best move was: ${m.bestMoveSan}
  Eval went from ${formatEval(m.evalBefore)} to ${formatEval(m.evalAfter)}
  Best line: ${m.pvSan.slice(0, 4).join(' ')}
  Phase: ${m.phase}${m.tacticalMotifs.length > 0 ? `\n  Tactical motifs: ${m.tacticalMotifs.join(', ')}` : ''}`);
    }
    sections.push('');
  }

  // Key eval swings
  if (evalSwings.length > 0) {
    sections.push('Key Evaluation Swings (>= 2 pawns change):');
    for (const m of evalSwings) {
      sections.push(`- Move ${m.moveNumber}: ${m.moveSan} (${m.quality})
  Eval: ${formatEval(m.evalBefore)} → ${formatEval(m.evalAfter)}
  Best was: ${m.bestMoveSan}
  Phase: ${m.phase}`);
    }
    sections.push('');
  }

  // Biggest mistake
  if (analysis.summary.biggestMistake) {
    const bm = analysis.summary.biggestMistake;
    sections.push(`Biggest Mistake: Move ${bm.moveNumber} — played ${bm.moveSan} (${bm.cpLoss}cp loss), best was ${bm.bestMoveSan}
`);
  }

  return sections.join('\n');
}

function buildSummaryContextText(
  games: GameRecord[],
  analyses: GameAnalysis[],
  patterns: CurrentPatterns,
  profileScores: { dimension: string; score: number }[],
): string {
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

  const sections: string[] = [];

  sections.push(`=== CHESS PERFORMANCE REVIEW DATA ===

Overall Record:
- Games: ${games.length} (${wins} wins, ${losses} losses, ${draws} draws)
- Win rate: ${games.length > 0 ? Math.round((wins / games.length) * 100) : 0}%
- Average accuracy: ${avgAccuracy}%
`);

  sections.push(`Phase Accuracy:
- Opening: ${phaseAccuracies.opening}%
- Middlegame: ${phaseAccuracies.middlegame}%
- Endgame: ${phaseAccuracies.endgame}%
`);

  sections.push(`Top Openings Played:
${topOpenings.map(([name, count]) => `- ${name}: ${count} games`).join('\n')}
`);

  // Weakness patterns
  if (patterns.patterns.length > 0) {
    sections.push('Weakness Patterns (recurring issues):');
    for (const p of patterns.patterns.slice(0, 5)) {
      sections.push(`- ${p.theme} (${p.id})
  Occurrences: ${p.occurrences} across ${p.gamesAffected} games
  Severity: ${p.severity.toFixed(1)} (centipawn loss per instance)
  Trend: ${p.trend}`);
    }
    sections.push('');
  }

  // Skill profile
  if (profileScores.length > 0) {
    sections.push('Skill Profile (0-100 scale):');
    for (const s of profileScores.slice(0, 8)) {
      sections.push(`- ${s.dimension}: ${s.score}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

/* ─────── Helpers ─────── */

function avgArr(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}
