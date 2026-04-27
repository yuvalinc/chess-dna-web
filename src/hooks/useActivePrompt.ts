/**
 * Hook to fetch the active AI prompt version from the database.
 * Falls back to the hardcoded buildMoveExplanationPrompt if no active prompt is found.
 */
import { useCallback } from 'react';
import { useEntityList } from '@/hooks/useEntity';
import { buildMoveExplanationPrompt } from '@/ai/prompt-builder';

interface AIPromptEntity {
  id: string;
  label: string;
  systemTemplate: string;
  userTemplate: string;
  isActive: boolean;
  languages: string[];
  notes: string;
}

function interpolate(template: string, vars: Record<string, string>): string {
  let result = template;
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return vars[key] ? content : '';
  });
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
  result = result.replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

function getLangStyle(language: string): string {
  if (!language || language === 'English')
    return 'Speak like a friendly English-speaking GM commentator — clear, direct, and insightful.';
  if (language === 'Hebrew')
    return 'דבר כמו גרוסמייסטר ישראלי — ישיר, תכליתי, בשפה טבעית של שחמטאי מקומי. שמות כלים: מלך, מלכה, צריח, רץ, פרש, חייל (לא "רגלי"). מונחים: כלי תלוי, מזלג, סיכה, שפוד, קידום, הפעלה, רוכדה. אל תתרגם מאנגלית — כתוב כאילו שחמט הוא שפת האם שלך.';
  if (language === 'Spanish')
    return 'Habla como un GM hispanohablante — directo, preciso, usando terminología ajedrecística natural en español.';
  return `Speak like a local chess GM commentator fluent in ${language}. Use natural chess terminology in ${language}.`;
}

/** Label format instruction per language */
function getLabelInstruction(language: string): string {
  if (language === 'Hebrew')
    return 'Format your response as exactly two labeled lines:\nהמהלך שלך: [1 sentence]\nהמהלך הטוב: [1 sentence]';
  if (language === 'Spanish')
    return 'Format your response as exactly two labeled lines:\nTu jugada: [1 sentence]\nLa mejor jugada: [1 sentence]';
  return 'Format your response as exactly two labeled lines:\nYour move: [1 sentence]\nBest move: [1 sentence]';
}

function getLevel(rating: number): string {
  if (rating < 800) return 'beginner';
  if (rating < 1200) return 'intermediate';
  if (rating < 1800) return 'advanced';
  return 'expert';
}

/**
 * Returns a function that builds move explanation prompts.
 * Uses the active DB prompt for the given language, falling back to the hardcoded version.
 */
export function useActivePrompt() {
  const [prompts, loading] = useEntityList<AIPromptEntity>('AIPrompt');

  // useCallback so buildPrompt always reads latest `prompts` without stale closure
  const buildPrompt = useCallback((
    fen: string,
    playerMoveSan: string,
    bestMoveSan: string,
    cpDiff: number,
    playerRating: number,
    bestMovePv?: string[],
    tacticalMotifs?: string[],
    positionFacts?: string,
    language?: string,
  ): { system: string; user: string } => {
    const lang = language || 'English';
    const langCode = lang === 'Hebrew' ? 'he' : lang === 'Spanish' ? 'es' : 'en';

    // Find active prompt matching the language
    const activePrompts = (prompts ?? []).filter(p => p.isActive);
    const matchingPrompt = activePrompts.find(p => {
      const langs = p.languages ?? [];
      return langs.length === 0 || langs.includes(langCode);
    });

    if (!matchingPrompt) {
      // Fallback to hardcoded
      return buildMoveExplanationPrompt(fen, playerMoveSan, bestMoveSan, cpDiff, playerRating, bestMovePv, tacticalMotifs, positionFacts, lang);
    }

    const sideToMove = fen.split(' ')[1] === 'w' ? 'White' : 'Black';
    const systemVars: Record<string, string> = {
      level: getLevel(playerRating),
      elo: String(playerRating),
      langStyle: getLangStyle(lang),
      language: lang,
      labelInstruction: getLabelInstruction(lang),
    };
    const userVars: Record<string, string> = {
      fen,
      sideToMove,
      playerMoveSan,
      bestMoveSan,
      cpDiffPawns: (cpDiff / 100).toFixed(1),
      bestMovePv: bestMovePv?.slice(0, 5).join(' ') ?? '',
      tacticalMotifs: tacticalMotifs?.join(', ') ?? '',
      positionFacts: positionFacts ?? '',
      language: lang,
    };

    let systemPrompt = interpolate(matchingPrompt.systemTemplate, systemVars);
    let userPrompt = interpolate(matchingPrompt.userTemplate, userVars);

    if (lang !== 'English') {
      // Replace any English label instructions with localized ones
      systemPrompt = systemPrompt
        .replace(/"Your move:"/g, `"${lang === 'Hebrew' ? 'המהלך שלך' : lang === 'Spanish' ? 'Tu jugada' : 'Your move'}:"`)
        .replace(/"Best move:"/g, `"${lang === 'Hebrew' ? 'המהלך הטוב' : lang === 'Spanish' ? 'La mejor jugada' : 'Best move'}:"`);

      // Ensure language instruction is in user prompt
      if (!userPrompt.includes('Generate ALL text in')) {
        userPrompt += `\n\nIMPORTANT: Generate ALL text in ${lang}. Chess notation stays standard.`;
      }
    }

    return { system: systemPrompt, user: userPrompt };
  }, [prompts]);

  return { buildPrompt, loading };
}
