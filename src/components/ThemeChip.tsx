/**
 * Clickable chess-theme badge.
 *
 * Renders the localized short label for a theme slug from `theme-catalog`
 * (e.g. "pin", "hanging piece", "back-rank mate"). Tapping it toggles a
 * small floating tooltip anchored to the chip with the one-sentence
 * definition from the i18n catalog — does NOT push surrounding layout.
 *
 * Used in the move-insight header to surface engine-detected motifs and
 * AI-declared themes as a single deduped row.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n/index';
import {
  isValidThemeSlug,
  themeDefinitionKey,
  themeLabelKey,
} from '@shared/theme-catalog';

export default function ThemeChip({
  slug,
  size = 'sm',
  surface,
}: {
  slug: string;
  size?: 'sm' | 'md';
  /** Optional override for the displayed text. Used when this chip appears
   *  inline inside AI prose — the AI's matched surface form ("hangs",
   *  "hanging piece", "horquilla") is rendered as the chip rather than the
   *  canonical i18n label, so the chip IS the word in the sentence. */
  surface?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  /** Computed viewport coordinates for the floating tooltip. Set on open
   *  from the chip's getBoundingClientRect, then clamped to viewport bounds
   *  so the popover never escapes the screen on either edge. */
  const [tipPos, setTipPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  // Close on outside click / Escape so the tooltip never sticks open.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Compute tooltip position when opening.
  // Hardcoded 32px margin from each viewport edge — guarantees the popover
  // never touches or crosses the screen edge regardless of where the chip
  // sits or what container it's inside. Simple and reliable.
  useEffect(() => {
    if (!open || !buttonRef.current) {
      setTipPos(null);
      return;
    }
    const r = buttonRef.current.getBoundingClientRect();
    const margin = 16;
    const vw = window.innerWidth;
    const maxAvailable = vw - margin * 2;
    const width = Math.min(260, maxAvailable);
    const desiredLeft = r.left;
    const left = Math.max(margin, Math.min(desiredLeft, vw - margin - width));
    const top = r.bottom + 6;
    setTipPos({ left, top, width });
  }, [open]);

  if (!isValidThemeSlug(slug)) return null;

  const labelKey = themeLabelKey(slug);
  const defKey = themeDefinitionKey(slug);
  const label = t(labelKey);
  const definition = t(defKey);
  // i18n misses fall through to the raw key — treat that as "no label" and skip.
  if (!label || label === labelKey) return null;

  // Inline vs header styling:
  //  - Header chip (no `surface`): green chess-accent, semibold — matches
  //    the existing pill-row visual identity.
  //  - Inline-in-prose chip (`surface` set): inherit prose color, add a
  //    subtle dotted underline as the only visual cue. Lets the chip read
  //    as natural text without fighting the blue [a1] square refs.
  const display = surface ?? label;
  const inline = !!surface;
  const sizeCls = inline ? '' : size === 'sm' ? 'text-[11px]' : 'text-[13px]';
  const colorCls = inline
    ? 'text-chess-text decoration-chess-text/50 hover:decoration-chess-text underline decoration-dotted underline-offset-[3px]'
    : 'text-chess-accent hover:underline';

  return (
    <span ref={wrapperRef} className="relative inline-block" dir="ltr">
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`inline tabular-nums cursor-pointer whitespace-nowrap ${inline ? 'font-normal' : 'font-semibold'} ${colorCls} ${sizeCls}`}
        style={{ background: 'transparent', padding: 0 }}
        aria-expanded={open}
      >
        {display}
      </button>
      {open && tipPos && (
        <span
          role="tooltip"
          className="fixed z-50 block rounded-md px-3 py-2 text-[12px] leading-[1.45] shadow-lg pointer-events-auto"
          style={{
            left: `${tipPos.left}px`,
            top: `${tipPos.top}px`,
            width: `${tipPos.width}px`,
            maxWidth: `${tipPos.width}px`,
            whiteSpace: 'normal',
            wordBreak: 'normal',
            overflowWrap: 'anywhere',
            background: 'rgba(15, 23, 30, 0.97)',
            border: '1px solid rgba(74, 222, 128, 0.45)',
            color: 'rgb(229, 231, 235)',
            boxSizing: 'border-box',
          }}
        >
          <span
            className="block font-bold mb-0.5 capitalize text-chess-accent"
            style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
          >
            {label}
          </span>
          <span
            className="block opacity-95"
            style={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}
          >
            {definition && definition !== defKey ? definition : ''}
          </span>
        </span>
      )}
    </span>
  );
}
