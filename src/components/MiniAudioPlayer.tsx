/**
 * MiniAudioPlayer — persistent top bar that shows when audio is active.
 *
 * Provides play/pause, speed, close, share menu (Download/WhatsApp/Telegram),
 * and an expandable transcript. Stays visible across page navigations.
 */

import { useState, useRef, useEffect } from 'react';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';
import { useT } from '@/i18n/index';

const SPEEDS = [0.75, 1, 1.25, 1.5];

// Use the runtime origin so shares from a custom domain (e.g. chessdna.app)
// don't leak the base44 subdomain into outgoing share links.
const getSiteUrl = () =>
  typeof window !== 'undefined' ? window.location.origin : 'https://chessdna.app';

const formatTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function MiniAudioPlayer() {
  const { state, controls } = useAudioPlayer();
  const { t } = useT();
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shareRef = useRef<HTMLDivElement>(null);

  // Close share menu on outside click
  useEffect(() => {
    if (!showShareMenu) return;
    const handler = (e: MouseEvent) => {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShareMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showShareMenu]);

  // Don't render if no audio at all
  if (!state.script && !state.isGenerating) return null;

  const progressPct =
    state.duration > 0 ? (state.elapsed / state.duration) * 100 : 0;

  const handleSpeedCycle = () => {
    const currentIdx = SPEEDS.indexOf(state.speed);
    const nextIdx = ((currentIdx === -1 ? 1 : currentIdx) + 1) % SPEEDS.length;
    controls.setSpeed(SPEEDS[nextIdx]);
  };

  const handlePlayPause = () => {
    if (state.isPlaying) controls.pause();
    else controls.play();
  };

  const shareText = 'Check out my Chess DNA analysis!';

  const handleShareWhatsApp = () => {
    window.open(`https://wa.me/?text=${encodeURIComponent(shareText + ' ' + getSiteUrl())}`, '_blank');
    setShowShareMenu(false);
  };

  const handleShareTelegram = () => {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(getSiteUrl())}&text=${encodeURIComponent(shareText)}`, '_blank');
    setShowShareMenu(false);
  };

  const handleDownload = () => {
    controls.download();
    setShowShareMenu(false);
  };

  // Generating state (no chunks yet)
  if (state.isGenerating && !state.script) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-chess-surface/95 backdrop-blur-md border-b border-chess-border/40">
        {/* Indeterminate progress */}
        <div className="w-full bg-chess-muted/40 h-0.5">
          <div className="h-full bg-chess-accent w-1/4 animate-pulse" />
        </div>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-chess-text-secondary">{t('audio_generating')}</span>
          </div>
          <button
            onClick={controls.close}
            className="text-gray-500 hover:text-chess-text-secondary text-xs"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Script exists but TTS generating (streaming chunks — not yet playing)
  if (state.isGenerating && state.script && !state.isPlaying && state.genProgress) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-chess-surface/95 backdrop-blur-md border-b border-chess-border/40">
        <div className="w-full bg-chess-muted/40 h-0.5">
          <div
            className="h-full bg-chess-accent transition-all duration-300"
            style={{ width: `${(state.genProgress.done / state.genProgress.total) * 100}%` }}
          />
        </div>
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-chess-text-secondary">
              {t('audio_review_soon')}
            </span>
          </div>
          <button
            onClick={controls.close}
            className="text-gray-500 hover:text-chess-text-secondary text-xs"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (state.error && !state.isPlaying) {
    return (
      <div className="fixed top-0 left-0 right-0 z-[100] bg-chess-surface/95 backdrop-blur-md border-b border-chess-border/40">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-2">
          <span className="text-xs text-chess-blunder">{state.error}</span>
          <button
            onClick={controls.close}
            className="text-gray-500 hover:text-chess-text-secondary text-xs"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  // Main player bar
  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-chess-surface/95 backdrop-blur-md border-b border-chess-border/40">
      {/* Thin progress bar */}
      <div className="w-full bg-chess-muted/40 h-0.5">
        <div
          className="h-full bg-chess-accent transition-all duration-150"
          style={{ width: `${Math.min(progressPct, 100)}%` }}
        />
      </div>

      <div className="max-w-6xl mx-auto px-4 py-1.5">
        {/* Controls row */}
        <div className="flex items-center gap-2">
          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            className="w-8 h-8 rounded-full bg-chess-accent/15 text-chess-accent flex items-center justify-center hover:bg-chess-accent/25 transition-colors flex-shrink-0"
          >
            {state.isPlaying ? (
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5,3 19,12 5,21" />
              </svg>
            )}
          </button>

          {/* Current turn info — compact in collapsed, just speaker badge */}
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="flex-1 min-w-0 text-left"
            >
              {state.currentTurn && state.script && (
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                      state.currentTurn.speaker === 'A'
                        ? 'bg-chess-accent/15 text-chess-accent'
                        : 'bg-blue-500/15 text-blue-400'
                    }`}
                  >
                    {state.script.style === 'podcast'
                      ? state.currentTurn.speaker === 'A'
                        ? 'Host'
                        : 'Commentator'
                      : 'Narrator'}
                  </span>
                  <span className="text-xs text-chess-text-secondary truncate">
                    {state.currentTurn.text}
                  </span>
                  <span className="text-[8px] text-gray-500 flex-shrink-0 ml-0.5">▼</span>
                </div>
              )}
              {!state.currentTurn && (
                <span className="text-xs text-chess-text-secondary">Audio ready</span>
              )}
            </button>
          )}

          {/* When expanded: just show speaker badge as label */}
          {expanded && state.currentTurn && state.script && (
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${
                state.currentTurn.speaker === 'A'
                  ? 'bg-chess-accent/15 text-chess-accent'
                  : 'bg-blue-500/15 text-blue-400'
              }`}
            >
              {state.script.style === 'podcast'
                ? state.currentTurn.speaker === 'A'
                  ? 'Host'
                  : 'Commentator'
                : 'Narrator'}
            </span>
          )}

          {expanded && <div className="flex-1" />}

          {/* Speed */}
          <button
            onClick={handleSpeedCycle}
            className="text-[10px] font-bold text-gray-400 hover:text-chess-text-secondary transition-colors px-1.5 py-0.5 rounded bg-chess-border/20 flex-shrink-0"
          >
            {state.speed}x
          </button>

          {/* Time */}
          <span className="text-[10px] text-gray-500 flex-shrink-0">
            {formatTime(state.elapsed)}/{formatTime(state.duration)}
          </span>

          {/* Generating indicator */}
          {state.isGenerating && state.genProgress && (
            <span className="text-[9px] text-gray-600 flex items-center gap-1 flex-shrink-0">
              <span className="w-1.5 h-1.5 bg-chess-accent rounded-full animate-pulse" />
              {state.genProgress.done}/{state.genProgress.total}
            </span>
          )}

          {/* Share button (only when fully generated) */}
          {state.ttsData && (
            <div className="relative flex-shrink-0" ref={shareRef}>
              <button
                onClick={() => setShowShareMenu((prev) => !prev)}
                className="w-7 h-7 rounded-full bg-chess-border/30 text-gray-400 flex items-center justify-center hover:text-chess-text-secondary transition-colors"
                title="Share"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" />
                </svg>
              </button>

              {/* Share popup */}
              {showShareMenu && (
                <div className="absolute top-full right-0 mt-2 w-40 bg-chess-surface border border-chess-border/40 rounded-lg shadow-xl py-1 z-50">
                  <button
                    onClick={handleDownload}
                    className="w-full text-left px-3 py-1.5 text-xs text-chess-text hover:bg-chess-accent/10 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 16l-5-5h3V4h4v7h3l-5 5z" /><rect x="5" y="18" width="14" height="2" />
                    </svg>
                    Download MP3
                  </button>
                  <button
                    onClick={handleShareWhatsApp}
                    className="w-full text-left px-3 py-1.5 text-xs text-chess-text hover:bg-chess-accent/10 transition-colors flex items-center gap-2"
                  >
                    <span className="text-[11px]">💬</span>
                    WhatsApp
                  </button>
                  <button
                    onClick={handleShareTelegram}
                    className="w-full text-left px-3 py-1.5 text-xs text-chess-text hover:bg-chess-accent/10 transition-colors flex items-center gap-2"
                  >
                    <span className="text-[11px]">✈️</span>
                    Telegram
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Collapse / Close */}
          {expanded ? (
            <button
              onClick={() => setExpanded(false)}
              className="text-gray-500 hover:text-chess-text-secondary text-[10px] flex-shrink-0"
            >
              ▲
            </button>
          ) : null}

          <button
            onClick={controls.close}
            className="text-gray-500 hover:text-chess-text-secondary text-xs flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Expanded transcript area */}
        {expanded && state.currentTurn && (
          <button
            onClick={() => setExpanded(false)}
            className="mt-2 w-full text-left"
          >
            <p className="text-sm text-chess-text leading-relaxed">
              {state.currentTurn.text}
            </p>
          </button>
        )}
      </div>
    </div>
  );
}
