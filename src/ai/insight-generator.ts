import { ClaudeClient } from './claude-client';
import { SYSTEM_PROMPT, buildInsightPrompt } from './prompt-builder';
import type { Insight } from '@shared/types/ai';
import type { GameSummary } from '@shared/types/analysis';
import type { WeaknessPattern } from '@shared/types/patterns';
import type { WeaknessTheme } from '@shared/types/patterns';

/**
 * Generate personalized insights from recent game data using Claude.
 */
export async function generateInsights(
  apiKey: string,
  model: string,
  playerRating: number,
  recentSummaries: GameSummary[],
  patterns: WeaknessPattern[],
  gameIds: string[],
): Promise<Insight[]> {
  const client = new ClaudeClient(apiKey, model);

  const prompt = buildInsightPrompt(playerRating, recentSummaries, patterns);

  const response = await client.sendMessage(
    SYSTEM_PROMPT,
    [{ role: 'user', content: prompt }],
  );

  return parseInsightResponse(response, gameIds);
}

function parseInsightResponse(response: string, gameIds: string[]): Insight[] {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    const insights = parsed.insights;

    if (!Array.isArray(insights)) return [];

    return insights.map(
      (item: { text: string; themes: string[]; priority: string }, index: number) => ({
        id: `insight-${Date.now()}-${index}`,
        generatedAt: Date.now(),
        gameIds,
        text: item.text ?? '',
        themes: (item.themes ?? []) as WeaknessTheme[],
        priority: (['high', 'medium', 'low'].includes(item.priority)
          ? item.priority
          : 'medium') as 'high' | 'medium' | 'low',
        isRead: false,
      }),
    );
  } catch {
    console.error('[Chess Tutor] Failed to parse insight response');
    return [];
  }
}
