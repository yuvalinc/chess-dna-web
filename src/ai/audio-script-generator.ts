import { sendWithFallback } from './ai-router';
import { AUDIO_SYSTEM_PROMPT, buildGameAudioScript, buildSummaryAudioScript } from './prompt-builder';
import type { AudioScript, AudioStyle, SpeakerTurn } from '@shared/types/audio';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { CurrentPatterns } from '@shared/types/patterns';
import type { UserSettings } from '@shared/types/storage';

/**
 * Generate an audio script for a single game analysis.
 */
export async function generateGameAudioScript(
  settings: UserSettings,
  game: GameRecord,
  analysis: GameAnalysis,
  style: AudioStyle,
): Promise<AudioScript | null> {
  const prompt = buildGameAudioScript(game, analysis, style, settings.ttsLanguage);

  const response = await sendWithFallback(
    settings,
    AUDIO_SYSTEM_PROMPT,
    [{ role: 'user', content: prompt }],
    4096,
  );

  const turns = parseAudioResponse(response);
  if (!turns || turns.length === 0) return null;

  // For narrator style, force all turns to speaker A
  const normalizedTurns = style === 'narrator'
    ? turns.map((t) => ({ ...t, speaker: 'A' as const }))
    : turns;

  return {
    id: `audio-game-${game.id}-${Date.now()}`,
    generatedAt: Date.now(),
    style,
    turns: normalizedTurns,
    source: { type: 'game', gameId: game.id },
    estimatedDuration: estimateDuration(normalizedTurns),
  };
}

/**
 * Generate an audio script for a multi-game performance summary.
 */
export async function generateSummaryAudioScript(
  settings: UserSettings,
  games: GameRecord[],
  analyses: GameAnalysis[],
  patterns: CurrentPatterns,
  profileScores: { dimension: string; score: number }[],
  style: AudioStyle,
): Promise<AudioScript | null> {
  const prompt = buildSummaryAudioScript(games, analyses, patterns, profileScores, style, settings.ttsLanguage);

  const response = await sendWithFallback(
    settings,
    AUDIO_SYSTEM_PROMPT,
    [{ role: 'user', content: prompt }],
    4096,
  );

  const turns = parseAudioResponse(response);
  if (!turns || turns.length === 0) return null;

  // For narrator style, force all turns to speaker A
  const normalizedTurns = style === 'narrator'
    ? turns.map((t) => ({ ...t, speaker: 'A' as const }))
    : turns;

  return {
    id: `audio-summary-${Date.now()}`,
    generatedAt: Date.now(),
    style,
    turns: normalizedTurns,
    source: { type: 'summary', gameCount: games.length },
    estimatedDuration: estimateDuration(normalizedTurns),
  };
}

/**
 * Parse AI response JSON into speaker turns.
 */
function parseAudioResponse(response: string): SpeakerTurn[] | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    const turns = parsed.turns;

    if (!Array.isArray(turns)) return null;

    return turns
      .filter((t: { speaker?: string; text?: string }) => t.speaker && t.text)
      .map((t: { speaker: string; text: string }) => ({
        speaker: (t.speaker === 'B' ? 'B' : 'A') as 'A' | 'B',
        text: t.text,
      }));
  } catch {
    console.error('[Chess DNA] Failed to parse audio script response');
    return null;
  }
}

/**
 * Estimate audio duration in seconds (~150 words/minute for speech).
 */
function estimateDuration(turns: SpeakerTurn[]): number {
  const totalWords = turns.reduce(
    (sum, turn) => sum + turn.text.split(/\s+/).length,
    0,
  );
  return Math.round((totalWords / 150) * 60);
}
