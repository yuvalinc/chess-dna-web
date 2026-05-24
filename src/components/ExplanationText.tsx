/**
 * Renders AI explanation text with clickable [a1]-[h8] square references and
 * inline ThemeChips for theme words that appear in the prose.
 *
 * The AI emits a `THEMES: slug1, slug2, slug3` line at the very top of its
 * response. We strip that line and, for each declared slug, scan the body
 * prose for verbatim (or stem-inflected) mentions of the localized label.
 * Matched words become ThemeChips inline — same visual style and tooltip
 * behavior as the chips in the move-insight header, so the word in the
 * sentence IS the chip rather than being shown next to a separate chip.
 *
 * Supports two body formats:
 * 1. Plain text — rendered as a single paragraph
 * 2. Structured "Your move:" / "Best move:" — rendered as two prominent tabs
 *    with one card visible at a time, so the user can clearly see there are
 *    two explanations and switch between them.
 *
 * When `isBestMove` is true, the two tabs collapse into a single celebratory
 * "Your move - best move!" tab — the played move IS the best move, so there
 * is nothing to compare against.
 *
 * Labels are always rendered in the app's language (not the AI's).
 * Text direction (RTL/LTR) is auto-detected.
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useT } from '@/i18n/index';
import { extractThemes, themeLabelKey } from '@shared/theme-catalog';
import ThemeChip from '@/components/ThemeChip';

// Labels in all supported languages — used to detect structured format in AI responses
const YOUR_MOVE_PATTERNS = /(?:your move|המהלך שלך|tu jugada)\s*[:：]\s*/i;
const BEST_MOVE_PATTERNS = /(?:best move|המהלך הטוב|la mejor jugada|mejor jugada)\s*[:：]\s*/i;

interface ThemeMatch {
  slug: string;
  label: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a match pattern for a theme label.
 *  - Multi-word labels (e.g. "hanging piece", "quiet move") only match the
 *    full phrase — matching individual words would catch unrelated mentions
 *    of common words like "move" or "piece".
 *  - Single-word labels (e.g. "fork", "pin") also match common verb
 *    inflections so "the queen forks", "pinned", etc. still light up.
 *  - Whole-word match only: "pin" must not light up inside "keeping". */
function buildLabelPattern(label: string): string {
  const trimmed = label.trim();
  // \b only treats ASCII letters/digits as word chars in JS regex. Anchoring
  // a Hebrew label with \b would never match (every adjacent char is non-word
  // by JS's definition), so we only add boundaries for ASCII labels.
  const asciiOnly = /^[\x20-\x7E]+$/.test(trimmed);
  const lb = asciiOnly ? '\\b' : '';
  const rb = asciiOnly ? '\\b' : '';

  // Multi-word labels — only the full phrase, no per-word expansion.
  if (/\s/.test(trimmed)) return `${lb}${escapeRegex(trimmed)}${rb}`;

  // Single-word label — also generate common inflections from the stem.
  const stems = new Set<string>([trimmed]);
  if (/^[a-z]+$/i.test(trimmed)) {
    let root = trimmed.replace(/(ing|ed|s|er)$/i, '');
    if (root.length < 3) root = trimmed;
    if (/^[a-z]+$/i.test(root) && root.length >= 3) {
      stems.add(root);
      stems.add(`${root}s`);
      stems.add(`${root}ed`);
      stems.add(`${root}ing`);
      // Short CVC roots double the final consonant before -ed/-ing
      // (pin → pinned, pinning). Spurious doubled forms for non-CVC
      // words don't match real text, so the false positives are harmless.
      if (root.length === 3 && /[^aeiouy][aeiouy][^aeiouywx]$/i.test(root)) {
        const doubled = root + root[root.length - 1];
        stems.add(`${doubled}ed`);
        stems.add(`${doubled}ing`);
      }
    }
  }
  const alts = [...stems].map(escapeRegex).join('|');
  return `${lb}(?:${alts})${rb}`;
}

export default function ExplanationText({
  text,
  onSquareClick,
  isBestMove = false,
  onTabChange,
}: {
  text: string;
  onSquareClick: (sq: string) => void;
  /** When true, the user's move IS the best move — render one merged tab. */
  isBestMove?: boolean;
  /** Fires when the user toggles between "Your move" / "Best move" tabs.
   *  Lets the parent draw a best-move arrow on the board the moment the
   *  user opens the Best Move tab. Initial value (0) is also emitted on
   *  mount so the parent can reset arrows when the explanation changes. */
  onTabChange?: (activeTab: 0 | 1) => void;
}) {
  const { t } = useT();

  // Strip the THEMES: line and resolve each slug to its localized label so
  // we can scan the body prose for inline mentions and wrap them as chips.
  const { body: withThemesStripped, slugs } = useMemo(
    () => extractThemes(text),
    [text],
  );

  const themeMatches: ThemeMatch[] = useMemo(() => {
    return slugs
      .map((slug) => {
        const key = themeLabelKey(slug);
        const label = t(key);
        if (!label || label === key) return null;
        return { slug, label };
      })
      .filter((m): m is ThemeMatch => m !== null);
  }, [slugs, t]);

  // Strip any remaining markdown formatting
  const cleaned = withThemesStripped.replace(/\*\*/g, '').replace(/\*/g, '');

  // Detect if text contains Hebrew/Arabic chars for RTL
  const isRtl = /[֐-׿؀-ۿ]/.test(cleaned);

  // Try to parse structured format: "Your move: ... Best move: ..."
  //
  // During streaming, the AI emits these delimiters sequentially —
  // "Your move:" arrives before "Best move:". To avoid the UI flipping
  // from plain text → tabs mid-stream, we show the tab structure as soon
  // as EITHER delimiter is detected and fill whichever side hasn't arrived
  // yet with an empty string (the tab still renders, just blank with a
  // subtle "still writing" hint).
  const yourMoveMatch = cleaned.match(YOUR_MOVE_PATTERNS);
  const bestMoveMatch = cleaned.match(BEST_MOVE_PATTERNS);

  if (yourMoveMatch || bestMoveMatch) {
    let yourText = '';
    let bestText = '';

    if (yourMoveMatch && bestMoveMatch) {
      const yourIdx = yourMoveMatch.index!;
      const bestIdx = bestMoveMatch.index!;
      if (yourIdx < bestIdx) {
        yourText = cleaned.slice(yourIdx + yourMoveMatch[0].length, bestIdx).trim();
        bestText = cleaned.slice(bestIdx + bestMoveMatch[0].length).trim();
      } else {
        bestText = cleaned.slice(bestIdx + bestMoveMatch[0].length, yourIdx).trim();
        yourText = cleaned.slice(yourIdx + yourMoveMatch[0].length).trim();
      }
    } else if (yourMoveMatch) {
      // Partial stream — only "Your move:" delimiter has arrived. Everything
      // after it is the still-growing your-move text; best move hasn't started.
      yourText = cleaned.slice(yourMoveMatch.index! + yourMoveMatch[0].length).trim();
    } else if (bestMoveMatch) {
      // Unusual order — best move arrived first. Show what we have.
      bestText = cleaned.slice(bestMoveMatch.index! + bestMoveMatch[0].length).trim();
    }

    // Always use our own translated labels
    const yourLabel = t('explanation_your_move') || 'Your move';
    const bestLabel = t('explanation_best_move') || 'Best move';

    // When the played move IS the best move, merge into one tab so the user
    // sees a single celebratory card instead of two redundant tabs.
    if (isBestMove) {
      const mergedLabel = `${yourLabel} - ${bestLabel}`;
      // Prefer best-move text (usually richer, explains the idea); fall back
      // to whichever side is non-empty.
      const mergedText = bestText || yourText;
      return (
        <BestMoveTab
          label={mergedLabel}
          text={mergedText}
          isRtl={isRtl}
          onSquareClick={onSquareClick}
          themeMatches={themeMatches}
        />
      );
    }

    return (
      <MoveStack
        yourLabel={yourLabel}
        bestLabel={bestLabel}
        yourText={yourText}
        bestText={bestText}
        isRtl={isRtl}
        onSquareClick={onSquareClick}
        onTabChange={onTabChange}
        themeMatches={themeMatches}
      />
    );
  }

  // Fallback: plain text format
  return (
    <span className={isRtl ? 'text-right block' : ''} dir={isRtl ? 'rtl' : 'ltr'}>
      <RichBody text={cleaned} onSquareClick={onSquareClick} themeMatches={themeMatches} />
    </span>
  );
}

/** Single celebratory tab used when the user's move IS the best move.
 *  Same folder-tab look as MoveStack, but only one tab — green accent so it
 *  reads as a "you nailed it" highlight. */
function BestMoveTab({
  label,
  text,
  isRtl,
  onSquareClick,
  themeMatches,
}: {
  label: string;
  text: string;
  isRtl: boolean;
  onSquareClick: (sq: string) => void;
  themeMatches: ThemeMatch[];
}) {
  const accent = 'rgb(74,222,128)';
  const activeBg = 'rgba(74,222,128,0.10)';
  const panelBorder = 'rgba(74,222,128,0.55)';
  const panelBg = 'rgba(74,222,128,0.04)';
  const shadow = '0 -2px 8px rgba(74,222,128,0.18)';
  return (
    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Full-width header — same width as the panel below, merged into one
          card so the title visually owns the explanation box. */}
      <div
        className="relative z-10 text-[11px] font-extrabold uppercase tracking-[0.3px] rounded-t-[11px] flex items-center gap-2 border"
        style={{
          padding: '11px 14px 12px',
          marginBottom: -1,
          background: activeBg,
          color: accent,
          borderColor: `${accent}88`,
          borderBottomColor: 'transparent',
          boxShadow: shadow,
        }}
      >
        <span className="rounded-full inline-block" style={{ width: 8, height: 8, background: accent }} />
        {label}
      </div>
      <div
        className="relative rounded-b-[11px] px-3.5 py-3 text-chess-text text-[13px] leading-[1.5]"
        style={{
          background: panelBg,
          border: `1px solid ${panelBorder}`,
          borderTop: 'none',
        }}
      >
        <RichBody text={text} onSquareClick={onSquareClick} themeMatches={themeMatches} />
      </div>
    </div>
  );
}

/** Folder-style tabs for "Your move" / "Best move". The active tab visually
 *  merges with the content panel below it (no border between them) so it
 *  reads like a real file-folder tab. */
function MoveStack({
  yourLabel,
  bestLabel,
  yourText,
  bestText,
  isRtl,
  onSquareClick,
  onTabChange,
  themeMatches,
}: {
  yourLabel: string;
  bestLabel: string;
  yourText: string;
  bestText: string;
  isRtl: boolean;
  onSquareClick: (sq: string) => void;
  onTabChange?: (activeTab: 0 | 1) => void;
  themeMatches: ThemeMatch[];
}) {
  const [active, setActive] = useState<0 | 1>(0);
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  // Reset arrows when the explanation re-renders (new move scrubbed).
  useEffect(() => {
    onTabChangeRef.current?.(0);
    return () => onTabChangeRef.current?.(0);
  }, []);
  useEffect(() => {
    onTabChangeRef.current?.(active);
  }, [active]);
  const tabs = [
    {
      label: yourLabel,
      text: yourText,
      accent: 'rgb(248,113,113)',           // red-400
      activeBg: 'rgba(248,113,113,0.10)',
      activeText: 'rgb(248,113,113)',
      panelBorder: 'rgba(248,113,113,0.55)',
      panelBg: 'rgba(248,113,113,0.04)',
      shadow: '0 -2px 8px rgba(248,113,113,0.18)',
    },
    {
      label: bestLabel,
      text: bestText,
      accent: 'rgb(74,222,128)',            // chess-accent
      activeBg: 'rgba(74,222,128,0.10)',
      activeText: 'rgb(74,222,128)',
      panelBorder: 'rgba(74,222,128,0.55)',
      panelBg: 'rgba(74,222,128,0.04)',
      shadow: '0 -2px 8px rgba(74,222,128,0.18)',
    },
  ] as const;
  const current = tabs[active];

  return (
    <div className={isRtl ? 'text-right' : 'text-left'} dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Tab strip — old-folder style. Active tab is taller and merges into
          the panel below; inactive tab sits raised + muted. */}
      <div className="flex items-end relative z-10" style={{ marginBottom: -1 }}>
        {tabs.map((tab, i) => {
          const isActive = active === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i as 0 | 1)}
              className="flex-1 text-[11px] font-extrabold uppercase tracking-[0.3px] transition-all rounded-t-[10px] inline-flex items-center justify-center gap-2 border"
              style={{
                padding: isActive ? '11px 14px 14px' : '8px 14px 10px',
                marginInlineEnd: i === 0 ? 4 : 0,
                marginBottom: isActive ? -1 : 0,
                background: isActive ? tab.activeBg : 'rgba(255,255,255,0.02)',
                color: isActive ? tab.activeText : 'rgb(100,116,139)',
                borderColor: isActive ? `${tab.accent}88` : 'rgba(255,255,255,0.06)',
                borderBottomColor: isActive ? 'transparent' : 'rgba(255,255,255,0.06)',
                boxShadow: isActive ? tab.shadow : 'none',
              }}
            >
              <span
                className="rounded-full inline-block"
                style={{
                  width: 8,
                  height: 8,
                  background: tab.accent,
                  opacity: isActive ? 1 : 0.5,
                }}
              />
              {tab.label}
            </button>
          );
        })}
      </div>
      {/* Content panel — coloured outline matches the active tab so they
          look connected. Text is left-aligned for readability. */}
      <div
        className="relative rounded-b-[11px] px-3.5 py-3 text-chess-text text-[13px] leading-[1.5]"
        style={{
          background: current.panelBg,
          border: `1px solid ${current.panelBorder}`,
          borderTop: 'none',
        }}
      >
        {current.text
          ? <RichBody text={current.text} onSquareClick={onSquareClick} themeMatches={themeMatches} />
          : <StreamingHint accent={current.accent} />
        }
      </div>
    </div>
  );
}

/** Subtle three-dot pulse shown in a tab whose section hasn't streamed in
 *  yet (e.g. "Best move" tab while "Your move" is still being written). */
function StreamingHint({ accent }: { accent: string }) {
  return (
    <span className="inline-flex items-center gap-1 opacity-70">
      <span className="streaming-dot" style={{ background: accent }} />
      <span className="streaming-dot" style={{ background: accent, animationDelay: '0.15s' }} />
      <span className="streaming-dot" style={{ background: accent, animationDelay: '0.3s' }} />
    </span>
  );
}

/** Renders body prose with clickable [square] refs AND theme-word matches.
 *  Each theme word in the AI's prose (e.g. "hanging piece", "fork", "back-rank
 *  mate") becomes an inline ThemeChip — same green styling and floating
 *  tooltip as the chip row in the move-insight header. The matched WORD in
 *  the sentence IS the chip; we do not add anything next to it. */
function RichBody({
  text,
  onSquareClick,
  themeMatches,
}: {
  text: string;
  onSquareClick: (sq: string) => void;
  themeMatches: ThemeMatch[];
}) {
  // Sort labels longest-first so multi-word labels win over substring shorter
  // ones (e.g. "back-rank mate" before "mate").
  const sortedThemes = useMemo(
    () => [...themeMatches].sort((a, b) => b.label.length - a.label.length),
    [themeMatches],
  );

  // Per-theme pattern (allows verb inflections), each its own capture group
  // so we can map a match back to its slug regardless of which form hit.
  const themePatterns = useMemo(
    () =>
      sortedThemes.map((tm) => ({
        theme: tm,
        pattern: buildLabelPattern(tm.label),
      })),
    [sortedThemes],
  );

  const tokenRe = useMemo(() => {
    const sqPart = '(\\[[A-Za-z]?x?[a-h][1-8][+#]?\\])';
    if (themePatterns.length === 0) {
      return new RegExp(sqPart, 'g');
    }
    const themeAlts = themePatterns.map((p) => `(${p.pattern})`).join('|');
    return new RegExp(`${sqPart}|${themeAlts}`, 'gi');
  }, [themePatterns]);

  const tokens = useMemo(() => {
    const out: Array<
      | { kind: 'text'; text: string }
      | { kind: 'square'; display: string; square: string }
      | { kind: 'theme'; text: string; theme: ThemeMatch }
    > = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    tokenRe.lastIndex = 0;
    while ((m = tokenRe.exec(text)) !== null) {
      if (m.index > lastIdx) out.push({ kind: 'text', text: text.slice(lastIdx, m.index) });
      const sqGroup = m[1];
      if (sqGroup) {
        const sqMatch = sqGroup.match(/^\[([A-Za-z]?x?([a-h][1-8])[+#]?)\]$/);
        if (sqMatch) {
          out.push({ kind: 'square', display: sqMatch[1], square: sqMatch[2] });
        } else {
          out.push({ kind: 'text', text: sqGroup });
        }
      } else {
        // Theme capture groups start at index 2.
        for (let g = 0; g < themePatterns.length; g++) {
          const groupValue = m[g + 2];
          if (groupValue !== undefined) {
            out.push({ kind: 'theme', text: groupValue, theme: themePatterns[g].theme });
            break;
          }
        }
      }
      lastIdx = m.index + m[0].length;
    }
    if (lastIdx < text.length) out.push({ kind: 'text', text: text.slice(lastIdx) });
    return out;
  }, [text, tokenRe, themePatterns]);

  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.kind === 'text') return <span key={i}>{tok.text}</span>;
        if (tok.kind === 'square') {
          return (
            <button
              key={i}
              onClick={() => onSquareClick(tok.square)}
              className="inline-flex items-center justify-center font-mono font-bold text-blue-400 bg-blue-500/15 px-1 rounded mx-0.5 hover:bg-blue-500/25 transition-colors cursor-pointer"
            >
              {tok.display}
            </button>
          );
        }
        // Theme word — render the matched surface form using ThemeChip so
        // styling and tooltip behavior match the header chips exactly.
        return (
          <ThemeChip
            key={`tok-${i}`}
            slug={tok.theme.slug}
            size="sm"
            surface={tok.text}
          />
        );
      })}
    </>
  );
}
