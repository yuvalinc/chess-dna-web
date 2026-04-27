/**
 * ShareComposer — Strava-style share card composer V3.
 *
 * Background options: Transparent, Photo, or Brand Color palette.
 * Game / Move mode toggle. Element visibility toggles.
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
// share-colors used by overlay children
import GameResultOverlay from './overlays/GameResultOverlay';
import MoveHighlightOverlay from './overlays/MoveHighlightOverlay';
import SequenceHighlightOverlay, { type SequenceHandle } from './overlays/SequenceHighlightOverlay';
import { captureCardAsBlob, shareImage, downloadImage, copyImageToClipboard, canShareFiles } from '@/utils/share-image';
import { captureSequenceAsVideo, downloadVideo, isVideoCaptureSupported } from '@/utils/share-video';
import { captureSequenceAsMp4, isWebCodecsMp4Supported } from '@/utils/share-video-mp4';
import { getChessAudioContext } from '@shared/utils/chess-sounds';
import type { SoundType } from '@shared/utils/chess-sounds';
import { fetchProfile } from '@/api/chess-com-avatar';
import { countryFlagUrl } from '@shared/utils/country-flag';
import { useTheme } from '@/components/ThemeContext';
import { sendWithFallback, hasAnyProvider } from '@/ai/ai-router';
import type { GameRecord } from '@shared/types/game';
import type { GameSummary, MoveAnalysis } from '@shared/types/analysis';
import type { SkillProfile } from '@shared/types/patterns';

type Format = 'story' | 'feed';
type BgMode = 'transparent' | 'color' | 'photo';
type ShareMode = 'game' | 'move' | 'sequence';
// Sequence playback speed: full ms-per-move spectrum from very fast (150ms)
// to slow & contemplative (1500ms). Default 500ms.
const SPEED_MIN_MS = 150;
const SPEED_MAX_MS = 1500;
const SPEED_DEFAULT_MS = 500;

// Chess DNA brand color palette
const BRAND_COLORS = [
  { id: 'dark', color: '#0a0f1a', label: 'Dark' },
  { id: 'midnight', color: '#111827', label: 'Midnight' },
  { id: 'slate', color: '#1e293b', label: 'Slate' },
  { id: 'forest', color: '#052e16', label: 'Forest' },
  { id: 'navy', color: '#0c1a3a', label: 'Navy' },
  { id: 'wine', color: '#2a0a1e', label: 'Wine' },
  { id: 'carbon', color: '#18181b', label: 'Carbon' },
  { id: 'ocean', color: '#0a2540', label: 'Ocean' },
];

interface Props {
  isOpen: boolean;
  onClose: () => void;
  game: GameRecord;
  summary?: GameSummary | null;
  move?: MoveAnalysis | null;
  /** All moves from the analysis — required for Sequence mode. */
  allMoves?: MoveAnalysis[];
  profile?: SkillProfile | null;
  /** Force the composer to open in this mode. Overrides the usual default
   *  which picks 'move' if `move` is set, otherwise 'game'. Use this when
   *  opening from contexts that want a specific tab (e.g. sequence). */
  initialMode?: ShareMode;
}

const CARD_W = 1080;
const STORY_H = 1920;
const FEED_H = 1080;

const GAME_ELEMENTS = [
  { id: 'branding', label: 'Logo' },
  { id: 'timeclass', label: 'Mode' },
  { id: 'result', label: 'Result' },
  { id: 'avatar', label: 'Photo' },
  { id: 'country', label: 'Flag' },
  { id: 'players', label: 'Players' },
  { id: 'accuracy', label: 'Accuracy' },
  { id: 'comparison', label: 'Compare' },
  { id: 'phases', label: 'Phases' },
  { id: 'qualities', label: 'Moves' },
  { id: 'opening', label: 'Opening' },
  { id: 'radar', label: 'Radar' },
  { id: 'caption', label: 'AI Quote' },
];

const MOVE_ELEMENTS = [
  { id: 'branding', label: 'Logo' },
  { id: 'timeclass', label: 'Mode' },
  { id: 'avatar', label: 'Photo' },
  { id: 'country', label: 'Flag' },
  { id: 'players', label: 'Opponent' },
  { id: 'board', label: 'Board' },
  { id: 'accuracy', label: 'Eval' },
  { id: 'caption', label: 'AI Quote' },
];

const SEQUENCE_ELEMENTS = [
  { id: 'branding', label: 'Logo' },
  { id: 'timeclass', label: 'Mode' },
  { id: 'avatar', label: 'Photo' },
  { id: 'country', label: 'Flag' },
  { id: 'players', label: 'Opponent' },
  { id: 'board', label: 'Board' },
  { id: 'caption', label: 'AI Quote' },
];

// Default element orders — `branding` is intentionally LAST in every mode
// so the Chess DNA logo always lives at the bottom of the share card.
const DEFAULT_GAME_ORDER = ['timeclass', 'result', 'accuracy', 'avatar', 'country', 'players', 'phases', 'qualities', 'opening', 'radar', 'caption', 'branding'];
const DEFAULT_GAME_VISIBLE = new Set(['branding', 'timeclass', 'result', 'avatar', 'country', 'players', 'accuracy', 'phases', 'qualities', 'opening', 'caption']);
const DEFAULT_MOVE_ORDER = ['timeclass', 'avatar', 'country', 'players', 'board', 'accuracy', 'caption', 'branding'];
const DEFAULT_MOVE_VISIBLE = new Set(['branding', 'timeclass', 'avatar', 'country', 'players', 'board', 'accuracy', 'caption']);
const DEFAULT_SEQUENCE_ORDER = ['timeclass', 'avatar', 'country', 'players', 'board', 'caption', 'branding'];
const DEFAULT_SEQUENCE_VISIBLE = new Set(['branding', 'timeclass', 'avatar', 'country', 'players', 'board', 'caption']);

export default function ShareComposer({ isOpen, onClose, game, summary, move, allMoves, profile, initialMode }: Props) {
  const { boardTheme, settings } = useTheme();
  const [format, setFormat] = useState<Format>('story');
  const [bgMode, setBgMode] = useState<BgMode>('color');
  const [bgColor, setBgColor] = useState(BRAND_COLORS[0].color);
  // Default mode: caller's override, else fall back to legacy behaviour
  // (move-if-move-given, otherwise game).
  const startMode: ShareMode = initialMode ?? (move ? 'move' : 'game');
  const [mode, setMode] = useState<ShareMode>(startMode);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoPos, setPhotoPos] = useState({ x: 50, y: 50 });
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [visibleElements, setVisibleElements] = useState<Set<string>>(
    startMode === 'sequence'
      ? new Set(DEFAULT_SEQUENCE_VISIBLE)
      : startMode === 'move'
        ? new Set(DEFAULT_MOVE_VISIBLE)
        : new Set(DEFAULT_GAME_VISIBLE),
  );
  const [elementOrder, setElementOrder] = useState<string[]>(
    startMode === 'sequence'
      ? [...DEFAULT_SEQUENCE_ORDER]
      : startMode === 'move'
        ? [...DEFAULT_MOVE_ORDER]
        : [...DEFAULT_GAME_ORDER],
  );

  // Sequence mode state
  const [preCount, setPreCount] = useState(3);
  const [speed, setSpeed] = useState<number>(SPEED_DEFAULT_MS); // ms per move
  const [isPlaying, setIsPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  // Pre-recorded share file (MP4, no audio) — allows navigator.share to run
  // synchronously inside the click gesture so iOS/Android don't reject it.
  const [preparedShareFile, setPreparedShareFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [prepProgress, setPrepProgress] = useState(0); // 0..1
  const [prepFailed, setPrepFailed] = useState(false);
  const [prepHasAudio, setPrepHasAudio] = useState<boolean | null>(null);
  const prepKeyRef = useRef<string>('');
  const sequenceRef = useRef<SequenceHandle>(null);
  const canShowSequence = !!move && !!allMoves && allMoves.length > 1;

  // AI-generated caption
  const [gameCaption, setGameCaption] = useState<string | null>(null);
  const [moveCaption, setMoveCaption] = useState<string | null>(null);
  const captionRequestedRef = useRef<string>('');

  // Chess.com profile — avatar URL + country flag, loaded once per open.
  const [playerAvatarUrl, setPlayerAvatarUrl] = useState<string | null>(null);
  const [playerFlagUrl, setPlayerFlagUrl] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chipScrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const cardH = format === 'story' ? STORY_H : FEED_H;
  const hasNativeShare = canShareFiles();
  const canShowMove = !!move;
  const canShowGame = !!summary;

  useEffect(() => {
    if (mode === 'move') {
      setVisibleElements(new Set(DEFAULT_MOVE_VISIBLE));
      setElementOrder([...DEFAULT_MOVE_ORDER]);
    } else if (mode === 'sequence') {
      setVisibleElements(new Set(DEFAULT_SEQUENCE_VISIBLE));
      setElementOrder([...DEFAULT_SEQUENCE_ORDER]);
    } else {
      setVisibleElements(new Set(DEFAULT_GAME_VISIBLE));
      setElementOrder([...DEFAULT_GAME_ORDER]);
    }
  }, [mode]);

  // Compute sequence frames: N preceding + target move.
  const sequenceFrames = useMemo<MoveAnalysis[]>(() => {
    if (!move || !allMoves || allMoves.length === 0) return [];
    const targetIdx = allMoves.findIndex((m) => m.halfMoveIndex === move.halfMoveIndex);
    if (targetIdx < 0) return [move];
    const startIdx = Math.max(0, targetIdx - preCount);
    return allMoves.slice(startIdx, targetIdx + 1);
  }, [move, allMoves, preCount]);

  // Pick a sound for each frame (mirrors SequenceHighlightOverlay's logic).
  const soundForFrame = useCallback((i: number): SoundType => {
    const m = sequenceFrames[i];
    if (!m) return 'move';
    const isLast = i === sequenceFrames.length - 1;
    if (isLast && m.evalAfter?.scoreType === 'mate' && m.evalAfter.score === 0) return 'checkmate';
    if (m.isCapture) return 'capture';
    if (m.isCastling) return 'castle';
    if (m.isCheck) return 'check';
    return 'move';
  }, [sequenceFrames]);

  // Generate AI caption when composer opens
  useEffect(() => {
    if (!isOpen || !hasAnyProvider(settings)) return;

    // Game caption
    if (summary && !gameCaption && captionRequestedRef.current !== `game-${game.id}`) {
      captionRequestedRef.current = `game-${game.id}`;
      const result = game.player.result;
      const acc = summary.accuracy;
      const opening = game.opening?.name ?? 'unknown opening';
      const blunders = summary.blunders;
      const brilliants = summary.brilliantMoves;
      const prompt = `You are a witty chess commentator writing a caption for a social media share card. The player (${game.player.username}, rated ${game.player.rating}) played a ${game.timeClass} game against ${game.opponent.username} (${game.opponent.rating}).
Result: ${result}. Accuracy: ${acc}%. Opening: ${opening}. Blunders: ${blunders}. Brilliant moves: ${brilliants}.
Phase accuracy — Opening: ${summary.phaseAccuracy.opening}%, Middlegame: ${summary.phaseAccuracy.middlegame}%, Endgame: ${summary.phaseAccuracy.endgame}%.

Write a 1-2 sentence caption that's witty, sassy, or inspirational. Reference a famous chess player, a classic game, or a chess saying if it fits naturally. Match the tone to the result — triumphant for wins, self-deprecating humor for losses, philosophical for draws. Keep it punchy and Instagram-worthy. No hashtags. No emojis. Just pure text.`;

      sendWithFallback(settings, 'You write short, witty chess commentary. Be concise and clever.', [{ role: 'user', content: prompt }], 120)
        .then(text => setGameCaption(text.replace(/^["']|["']$/g, '').trim()))
        .catch(() => setGameCaption(null));
    }

    // Move caption
    if (move && !moveCaption && captionRequestedRef.current !== `move-${game.id}-${move.halfMoveIndex}`) {
      captionRequestedRef.current = `move-${game.id}-${move.halfMoveIndex}`;
      const quality = move.quality;
      const san = move.moveSan;
      const moveNum = move.moveNumber;
      const motif = move.tacticalMotifs.length > 0 ? move.tacticalMotifs[0] : '';
      const cpLoss = move.cpLoss;
      const prompt = `Chess move: ${moveNum}${move.color === 'black' ? '...' : '.'} ${san} (${quality}).${motif ? ` Motif: ${motif}.` : ''}
Eval: ${cpLoss > 0 ? `lost ${cpLoss}cp` : 'maintained'}.

Write a SINGLE punchy phrase (max 8 words) for a social-share card. Be ${quality === 'blunder' || quality === 'mistake' ? 'self-deprecating' : quality === 'brilliant' || quality === 'great' ? 'triumphant' : 'clever'}. No hashtags, no emojis, no quotes around the answer.`;

      sendWithFallback(settings, 'You write 5–8 word chess move captions. Be punchy. No more than 8 words.', [{ role: 'user', content: prompt }], 40)
        .then(text => setMoveCaption(text.replace(/^["']|["']$/g, '').trim()))
        .catch(() => setMoveCaption(null));
    }
  }, [isOpen, game, summary, move, settings, gameCaption, moveCaption]);

  useEffect(() => {
    if (isOpen) {
      setCapturing(false);
      setCopied(false);
      // Honor the caller's initialMode (e.g. 'sequence' from achievement
      // cards). Falling back to move/game lost the sequence intent and
      // dumped users into Move mode.
      setMode(initialMode ?? (move ? 'move' : 'game'));
      setIsPlaying(false);
      setRecording(false);
      setPreCount(3);
      // Reset captions for new share
      setGameCaption(null);
      setMoveCaption(null);
      captionRequestedRef.current = '';
    }
  }, [isOpen, move, initialMode]);

  // Fetch player avatar + country flag once per open.
  useEffect(() => {
    if (!isOpen) return;
    const username = game.player.username;
    if (!username) return;
    let cancelled = false;
    fetchProfile(username)
      .then((profile) => {
        if (cancelled) return;
        setPlayerAvatarUrl(profile.avatar);
        setPlayerFlagUrl(countryFlagUrl(profile.countryCode, 320));
      })
      .catch(() => { /* silent — avatar/flag are optional */ });
    return () => { cancelled = true; };
  }, [isOpen, game.player.username]);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const handlePhotoSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(URL.createObjectURL(file));
    setPhotoPos({ x: 50, y: 50 });
    setBgMode('photo');
  }, [photoUrl]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (bgMode !== 'photo' || !photoUrl) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: photoPos.x, startPosY: photoPos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [bgMode, photoUrl, photoPos]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startX) * 0.15;
    const dy = (e.clientY - dragRef.current.startY) * 0.15;
    setPhotoPos({
      x: Math.max(0, Math.min(100, dragRef.current.startPosX - dx)),
      y: Math.max(0, Math.min(100, dragRef.current.startPosY - dy)),
    });
  }, []);

  const handlePointerUp = useCallback(() => { dragRef.current = null; }, []);

  const handleCapture = useCallback(async (action: 'share' | 'download' | 'copy') => {
    if (!cardRef.current) return;
    setCapturing(true);
    try {
      const blob = await captureCardAsBlob(cardRef.current);
      const filename = `chessdna-${mode}-${game.id.slice(-6)}.png`;
      if (action === 'share') await shareImage(blob, filename);
      else if (action === 'download') downloadImage(blob, filename);
      else {
        const ok = await copyImageToClipboard(blob);
        if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
      }
    } catch (err) {
      console.error('[Chess DNA] Share capture failed:', err);
    } finally {
      setCapturing(false);
    }
  }, [game.id, mode]);

  const toggleElement = useCallback((id: string) => {
    setVisibleElements(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Drag-to-reorder state
  const [dragId, setDragId] = useState<string | null>(null);
  const chipRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const handleDragStart = useCallback((id: string) => {
    setDragId(id);
  }, []);

  const handleDragOver = useCallback((targetId: string, clientX?: number) => {
    if (!dragId || dragId === targetId) return;
    // Auto-scroll chip row when dragging near edges (desktop drag)
    if (clientX !== undefined && chipScrollRef.current) {
      const rect = chipScrollRef.current.getBoundingClientRect();
      const edgeZone = 40;
      if (clientX < rect.left + edgeZone) chipScrollRef.current.scrollLeft -= 10;
      else if (clientX > rect.right - edgeZone) chipScrollRef.current.scrollLeft += 10;
    }
    setElementOrder(prev => {
      const fromIdx = prev.indexOf(dragId);
      const toIdx = prev.indexOf(targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, dragId);
      return next;
    });
  }, [dragId]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
  }, []);

  const currentElements = useMemo(
    () => mode === 'move' ? MOVE_ELEMENTS : mode === 'sequence' ? SEQUENCE_ELEMENTS : GAME_ELEMENTS,
    [mode],
  );

  const handlePreview = useCallback(async () => {
    if (!sequenceRef.current || isPlaying) return;
    setIsPlaying(true);
    try {
      sequenceRef.current.reset();
      await new Promise((r) => setTimeout(r, 50));
      await sequenceRef.current.play();
    } finally {
      setIsPlaying(false);
    }
  }, [isPlaying]);

  // ─── Pre-record the share MP4 ────────────────────────────────────────────
  // navigator.share({files}) on iOS/Android requires the call to happen inside
  // the user-gesture window. Recording takes several seconds, so we do it
  // eagerly whenever the sequence is set up — then Share just invokes the
  // cached File synchronously.
  const invalidatePrep = useCallback(() => {
    setPreparedShareFile(null);
    setPrepProgress(0);
    setPrepFailed(false);
    setPrepHasAudio(null);
    prepKeyRef.current = '';
  }, []);

  useEffect(() => {
    invalidatePrep();
  }, [mode, preCount, speed, format, bgMode, bgColor, photoUrl, visibleElements, elementOrder, sequenceFrames, invalidatePrep]);

  useEffect(() => {
    if (mode !== 'sequence') return;
    if (!canShowSequence || !sequenceFrames.length) return;
    if (!cardRef.current || !sequenceRef.current) return;
    if (preparedShareFile || preparing || recording || isPlaying || prepFailed) return;
    if (!isWebCodecsMp4Supported() && !isVideoCaptureSupported()) return;

    // Debounce so slider drags don't kick off recordings on every tick.
    const key = `${mode}|${preCount}|${speed}|${format}|${bgMode}|${bgColor}|${photoUrl ?? ''}|${[...visibleElements].sort().join(',')}|${elementOrder.join(',')}|${sequenceFrames.map(f => f.halfMoveIndex).join(',')}`;
    if (prepKeyRef.current === key) return;

    const timer = setTimeout(async () => {
      if (!cardRef.current || !sequenceRef.current) return;
      if (prepKeyRef.current === key) return;
      prepKeyRef.current = key;
      setPreparing(true);
      setPrepProgress(0);

      try {
        const handle = sequenceRef.current;
        const frameMs = speed;
        const finalHold = handle.finalHoldMs;

        let blob: Blob | null = null;
        let ext = '';

        // Enter recording mode — disables the Chessboard piece-slide
        // animation so html2canvas snapshots can never catch a capture
        // mid-frame (which made captured pieces appear stacked under the
        // capturing piece in the exported video).
        handle.setRecordingMode(true);

        // Try WebCodecs first (Instagram-compatible MP4 + audio). Fall back
        // to MediaRecorder if it throws for any reason.
        if (isWebCodecsMp4Supported()) {
          try {
            const mp4Frames = Array.from({ length: handle.frameCount }, (_, i) => ({
              render: async () => { handle.seek(i); },
              durationMs: i === handle.frameCount - 1 ? frameMs + finalHold : frameMs,
              soundType: soundForFrame(i),
            }));
            blob = await captureSequenceAsMp4(cardRef.current!, mp4Frames, {
              width: CARD_W,
              height: cardH,
              fps: 30,
              videoBitrate: 8_000_000,
              withAudio: true,
              onProgress: (p) => setPrepProgress(p),
              onAudioStatus: (s) => setPrepHasAudio(s.included),
            });
            ext = 'mp4';
          } catch (err) {
            console.warn('[Chess DNA] WebCodecs MP4 failed, falling back:', err);
            blob = null;
          }
        }

        if (!blob && isVideoCaptureSupported()) {
          // Legacy path (MediaRecorder).
          let audioDest: MediaStreamAudioDestinationNode | null = null;
          try {
            const ctx = getChessAudioContext();
            audioDest = ctx.createMediaStreamDestination();
            sequenceRef.current.setAudioDestination(audioDest);
          } catch { audioDest = null; }
          const legacyFrames = Array.from({ length: handle.frameCount }, (_, i) => ({
            render: async () => { handle.seek(i, { playSound: true }); },
            durationMs: i === handle.frameCount - 1 ? frameMs + finalHold : frameMs,
          }));
          const res = await captureSequenceAsVideo(cardRef.current!, legacyFrames, {
            preferMp4: true,
            width: CARD_W,
            height: cardH,
            audioStream: audioDest?.stream,
            onProgress: (p) => setPrepProgress(p),
          });
          blob = res.blob;
          ext = res.ext;
          try { sequenceRef.current?.setAudioDestination(null); } catch { /* ignore */ }
        }

        if (!blob) throw new Error('No encoder produced output');

        const filename = `chessdna-sequence-${game.id.slice(-6)}.${ext}`;
        const mime = ext === 'mp4' ? 'video/mp4' : 'video/webm';
        const file = new File([blob], filename, { type: mime });
        if (prepKeyRef.current === key) setPreparedShareFile(file);
      } catch (err) {
        console.warn('[Chess DNA] Share pre-record failed:', err);
        // DO NOT reset prepKeyRef here — that would cause an immediate retry
        // with the same (failing) params on the next re-render, locking the
        // composer into an infinite preparing loop. Instead mark as failed
        // so the UI can surface the state and the user can tweak params.
        setPrepProgress(0);
        setPrepFailed(true);
      } finally {
        // Restore preview animation when prep ends (success or failure).
        try { sequenceRef.current?.setRecordingMode(false); } catch { /* ignore */ }
        setPreparing(false);
      }
    // 3-second debounce — only kick off the (heavy) MP4 prep once the user
    // stops fiddling with the slider / toggles. Avoids spending CPU on a
    // recording the user is about to invalidate.
    }, 3000);

    return () => clearTimeout(timer);
  }, [mode, canShowSequence, sequenceFrames, preCount, speed, format, bgMode, bgColor, photoUrl, visibleElements, elementOrder, preparedShareFile, preparing, recording, isPlaying, prepFailed, game.id, cardH, soundForFrame]);

  const handleExportVideo = useCallback(async (action: 'share' | 'download') => {
    if (!cardRef.current || !sequenceRef.current || recording) return;
    if (!isVideoCaptureSupported()) {
      // Fallback: capture the final frame as a still PNG
      setCapturing(true);
      try {
        sequenceRef.current.seek(sequenceRef.current.frameCount - 1);
        await new Promise((r) => setTimeout(r, 100));
        const blob = await captureCardAsBlob(cardRef.current);
        const filename = `chessdna-sequence-${game.id.slice(-6)}.png`;
        if (action === 'share') await shareImage(blob, filename);
        else downloadImage(blob, filename);
      } finally {
        setCapturing(false);
      }
      return;
    }
    setRecording(true);
    let audioDest: MediaStreamAudioDestinationNode | null = null;
    try {
      const handle = sequenceRef.current;
      const frameMs = speed;
      const finalHold = handle.finalHoldMs;

      let blob: Blob;
      let ext: string;

      if (isWebCodecsMp4Supported()) {
        const mp4Frames = Array.from({ length: handle.frameCount }, (_, i) => ({
          render: async () => { handle.seek(i); },
          durationMs: i === handle.frameCount - 1 ? frameMs + finalHold : frameMs,
          soundType: soundForFrame(i),
        }));
        blob = await captureSequenceAsMp4(cardRef.current, mp4Frames, {
          width: CARD_W,
          height: cardH,
          fps: 30,
          videoBitrate: 8_000_000,
          withAudio: true,
        });
        ext = 'mp4';
      } else {
        try {
          const ctx = getChessAudioContext();
          audioDest = ctx.createMediaStreamDestination();
          sequenceRef.current.setAudioDestination(audioDest);
        } catch { audioDest = null; }
        const frames = Array.from({ length: handle.frameCount }, (_, i) => ({
          render: async () => { handle.seek(i, { playSound: true }); },
          durationMs: i === handle.frameCount - 1 ? frameMs + finalHold : frameMs,
        }));
        const res = await captureSequenceAsVideo(cardRef.current, frames, {
          audioStream: audioDest?.stream,
          preferMp4: action === 'share',
          width: CARD_W,
          height: cardH,
        });
        blob = res.blob;
        ext = res.ext;
      }
      const filename = `chessdna-sequence-${game.id.slice(-6)}.${ext}`;
      const mime = ext === 'mp4' ? 'video/mp4' : 'video/webm';
      if (action === 'share') {
        const file = new File([blob], filename, { type: mime });
        // Try native share directly. Some browsers have a flaky `canShare`
        // for video files even when `share` works — so attempt share first,
        // and only fall back to download if the attempt fails (or the user
        // explicitly dismisses — which we also treat as fallback).
        let shared = false;
        if (typeof navigator.share === 'function') {
          try {
            if (!navigator.canShare || navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: 'Chess DNA' });
              shared = true;
            }
          } catch (err) {
            const name = (err as Error)?.name ?? '';
            // AbortError = user dismissed the share sheet — don't fall through.
            if (name === 'AbortError') shared = true;
          }
        }
        if (!shared) downloadVideo(blob, filename);
      } else {
        downloadVideo(blob, filename);
      }
    } catch (err) {
      console.error('[Chess DNA] Sequence video capture failed:', err);
    } finally {
      // Restore speaker output for subsequent previews.
      try { sequenceRef.current?.setAudioDestination(null); } catch { /* ignore */ }
      setRecording(false);
      setPrepProgress(0);
    }
  }, [recording, speed, game.id, cardH, soundForFrame]);

  /**
   * Synchronous share — must execute inside the click handler to keep the
   * user gesture valid (iOS/Android reject navigator.share after async gaps).
   */
  const handleShareSequence = useCallback(() => {
    if (preparedShareFile && typeof navigator.share === 'function') {
      const canShare = !navigator.canShare || navigator.canShare({ files: [preparedShareFile] });
      if (canShare) {
        // Fire-and-forget — DO NOT await. Keeping the call synchronous from
        // the gesture is what makes iOS Safari open the share sheet.
        navigator.share({ files: [preparedShareFile], title: 'Chess DNA' }).catch((err: Error) => {
          if (err?.name !== 'AbortError') {
            downloadVideo(preparedShareFile, preparedShareFile.name);
          }
        });
        return;
      }
      // canShare refused — just download the prepared file.
      downloadVideo(preparedShareFile, preparedShareFile.name);
      return;
    }
    // No prepared file yet — fall back to record-then-download (share after
    // the async record won't reach the share sheet on iOS anyway).
    void handleExportVideo('download');
  }, [preparedShareFile, handleExportVideo]);

  if (!isOpen) return null;

  // Scale to fit viewport — reserve space for top bar (~48px) + bottom controls (~200px)
  const maxPreviewW = Math.min(window.innerWidth - 24, 520);
  const maxPreviewH = window.innerHeight - 300;
  const scale = Math.min(maxPreviewW / CARD_W, maxPreviewH / cardH);

  // Background
  const isTransparent = bgMode === 'transparent';
  const hasPhotoBg = bgMode === 'photo' && !!photoUrl;

  const bgStyle: React.CSSProperties = (() => {
    if (bgMode === 'transparent') {
      // Checkered pattern like Strava's transparent mode
      return {
        backgroundImage: `
          linear-gradient(45deg, #222 25%, transparent 25%),
          linear-gradient(-45deg, #222 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #222 75%),
          linear-gradient(-45deg, transparent 75%, #222 75%)
        `,
        backgroundSize: '60px 60px',
        backgroundPosition: '0 0, 0 30px, 30px -30px, -30px 0px',
        backgroundColor: '#1a1a1a',
      };
    }
    if (bgMode === 'photo' && photoUrl) {
      return {
        backgroundImage: `url(${photoUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: `${photoPos.x}% ${photoPos.y}%`,
      };
    }
    return { backgroundColor: bgColor };
  })();

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.95)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center',
      overflowY: 'auto',
    }}>
      {/* ═══ Top bar ═══ */}
      <div style={{
        width: '100%', maxWidth: 520,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', flexShrink: 0,
      }}>
        <button onClick={onClose} style={{
          color: '#888', background: 'none', border: 'none',
          fontSize: 22, cursor: 'pointer', padding: '4px 8px', lineHeight: 1,
        }}>✕</button>

        {/* Game / Move / Sequence toggle */}
        {(canShowGame || canShowMove) && (
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 2 }}>
            {(['game', 'move', 'sequence'] as ShareMode[]).map(m => {
              const enabled = m === 'game' ? canShowGame : m === 'move' ? canShowMove : canShowSequence;
              if (!enabled) return null;
              const label = m === 'game' ? 'Game' : m === 'move' ? 'Move' : 'Sequence';
              return (
                <button key={m} onClick={() => setMode(m)} style={{
                  padding: '5px 14px', borderRadius: 6, border: 'none',
                  fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  color: mode === m ? '#fff' : '#555',
                  background: mode === m ? 'rgba(255,255,255,0.12)' : 'transparent',
                }}>{label}</button>
              );
            })}
          </div>
        )}

        {/* Format toggle */}
        <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.06)', borderRadius: 8, padding: 2 }}>
          {(['story', 'feed'] as Format[]).map(f => (
            <button key={f} onClick={() => setFormat(f)} style={{
              padding: '5px 14px', borderRadius: 6, border: 'none',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              color: format === f ? '#fff' : '#555',
              background: format === f ? 'rgba(255,255,255,0.12)' : 'transparent',
            }}>{f === 'story' ? '9:16' : '1:1'}</button>
          ))}
        </div>
      </div>

      {/* ═══ Card preview ═══ */}
      <div style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '4px 12px', minHeight: 0, overflow: 'hidden',
      }}>
        <div style={{
          width: CARD_W * scale, height: cardH * scale,
          overflow: 'hidden', borderRadius: 10,
          boxShadow: isTransparent ? 'none' : '0 6px 24px rgba(0,0,0,0.4)',
          flexShrink: 0, position: 'relative',
        }}>
          <div
            ref={cardRef}
            data-share-card="true"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              width: CARD_W, height: cardH,
              position: 'relative',
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              cursor: bgMode === 'photo' && photoUrl ? 'grab' : 'default',
              touchAction: 'none',
              ...bgStyle,
            }}
          >
            {/* Scrim for photo */}
            {hasPhotoBg && (
              <div style={{
                position: 'absolute', inset: 0,
                background: `linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.1) 35%, rgba(0,0,0,0.6) 100%)`,
              }} />
            )}

            {/* Overlay */}
            {mode === 'sequence' && sequenceFrames.length > 0 ? (
              <SequenceHighlightOverlay
                ref={sequenceRef}
                game={game}
                frames={sequenceFrames}
                boardThemeId={boardTheme}
                format={format}
                hasBackground={hasPhotoBg}
                visibleElements={visibleElements}
                elementOrder={elementOrder}
                caption={moveCaption}
                speedMs={speed}
                avatarUrl={playerAvatarUrl}
                flagUrl={playerFlagUrl}
              />
            ) : mode === 'move' && move ? (
              <MoveHighlightOverlay
                game={game} move={move} boardThemeId={boardTheme}
                format={format} hasBackground={hasPhotoBg}
                visibleElements={visibleElements}
                elementOrder={elementOrder}
                caption={moveCaption}
                avatarUrl={playerAvatarUrl}
                flagUrl={playerFlagUrl}
              />
            ) : summary ? (
              <GameResultOverlay
                game={game} summary={summary}
                format={format} hasBackground={hasPhotoBg}
                visibleElements={visibleElements}
                elementOrder={elementOrder}
                profile={profile}
                caption={gameCaption}
                avatarUrl={playerAvatarUrl}
                flagUrl={playerFlagUrl}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* ═══ Bottom controls ═══ */}
      <div style={{
        width: '100%', maxWidth: 520,
        padding: '6px 12px 20px', flexShrink: 0,
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {/* Background mode tabs */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
          {/* Transparent */}
          <button onClick={() => setBgMode('transparent')} style={{
            width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
            border: bgMode === 'transparent' ? '2px solid #4ade80' : '2px solid rgba(255,255,255,0.15)',
            backgroundImage: 'linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%)',
            backgroundSize: '10px 10px',
            backgroundPosition: '0 0, 0 5px, 5px -5px, -5px 0px',
            backgroundColor: '#222',
          }} title="Transparent" />

          {/* Color swatches */}
          {BRAND_COLORS.map(c => (
            <button key={c.id} onClick={() => { setBgMode('color'); setBgColor(c.color); }} style={{
              width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
              backgroundColor: c.color,
              border: bgMode === 'color' && bgColor === c.color ? '2px solid #4ade80' : '2px solid rgba(255,255,255,0.15)',
            }} title={c.label} />
          ))}

          {/* Photo */}
          <button onClick={() => {
            if (!photoUrl) fileInputRef.current?.click();
            else setBgMode('photo');
          }} style={{
            width: 36, height: 36, borderRadius: 8, cursor: 'pointer',
            border: bgMode === 'photo' ? '2px solid #4ade80' : '2px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: bgMode === 'photo' ? '#4ade80' : '#888',
            fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} title="Photo">
            📷
          </button>
          {bgMode === 'photo' && photoUrl && (
            <button onClick={() => fileInputRef.current?.click()} style={{
              padding: '4px 8px', borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'transparent', color: '#666', fontSize: 10, cursor: 'pointer',
              alignSelf: 'center',
            }}>Change</button>
          )}
          <input ref={fileInputRef} type="file" accept="image/*" onChange={handlePhotoSelect} style={{ display: 'none' }} />
        </div>

        {/* Sequence mode controls: preceding-move slider + speed + play.
            Layout uses min-w-0 + box-sizing so the rows never overflow
            the parent (the value labels and Preview button were spilling
            past the panel before). */}
        {mode === 'sequence' && canShowSequence && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            padding: '8px 10px', borderRadius: 10,
            background: 'rgba(255,255,255,0.04)',
            boxSizing: 'border-box', width: '100%', minWidth: 0,
          }}>
            {/* Before move */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#888', fontWeight: 600, width: 64, flexShrink: 0 }}>Before</span>
              <input
                type="range" min={2} max={5} step={1}
                value={preCount}
                onChange={(e) => setPreCount(parseInt(e.target.value, 10))}
                style={{ flex: '1 1 0', minWidth: 0, accentColor: '#4ade80' }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', width: 16, textAlign: 'right', flexShrink: 0 }}>
                {Math.min(preCount, sequenceFrames.length - 1)}
              </span>
            </div>
            {/* Speed (right = faster) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <span style={{ fontSize: 11, color: '#888', fontWeight: 600, width: 64, flexShrink: 0 }}>Speed</span>
              <input
                type="range"
                min={SPEED_MIN_MS}
                max={SPEED_MAX_MS}
                step={50}
                value={SPEED_MAX_MS + SPEED_MIN_MS - speed}
                onChange={(e) => setSpeed(SPEED_MAX_MS + SPEED_MIN_MS - parseInt(e.target.value, 10))}
                style={{ flex: '1 1 0', minWidth: 0, accentColor: '#4ade80' }}
              />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#4ade80', width: 40, textAlign: 'right', fontFamily: 'monospace', flexShrink: 0 }}>
                {(speed / 1000).toFixed(speed >= 1000 ? 1 : 2)}s
              </span>
            </div>
            {/* Preview button — its OWN row, full width, so it never
                pushes the slider rows past the panel edge. */}
            <button
              onClick={handlePreview}
              disabled={isPlaying || recording || preparing}
              style={{
                width: '100%', padding: '8px 14px', borderRadius: 8, border: 'none',
                background: isPlaying || preparing ? '#333' : 'rgba(74,222,128,0.15)',
                color: isPlaying || preparing ? '#888' : '#4ade80',
                fontSize: 13, fontWeight: 700,
                cursor: isPlaying || recording || preparing ? 'wait' : 'pointer',
                boxSizing: 'border-box',
              }}
            >
              {isPlaying ? '\u25A0 Playing' : preparing ? 'Preparing\u2026' : '\u25B6 Preview'}
            </button>
          </div>
        )}

        {/* Element chips — single scrollable row, drag to reorder */}
        <div
          ref={chipScrollRef}
          style={{
            display: 'flex', gap: 5, padding: '4px 8px',
            overflowX: 'auto', overflowY: 'hidden',
            flexWrap: 'nowrap', flexShrink: 0,
            userSelect: 'none', WebkitUserSelect: 'none',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {elementOrder.map(elId => {
            const el = currentElements.find(e => e.id === elId);
            if (!el) return null;
            const on = visibleElements.has(el.id);
            const isDragging = dragId === el.id;
            return (
              <button
                key={el.id}
                ref={(node) => { if (node) chipRefs.current.set(el.id, node); }}
                onClick={() => { if (!dragId) toggleElement(el.id); }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', el.id);
                  handleDragStart(el.id);
                }}
                onDragOver={(e) => { e.preventDefault(); handleDragOver(el.id, e.clientX); }}
                onDragEnd={handleDragEnd}
                onTouchStart={() => handleDragStart(el.id)}
                onTouchMove={(e) => {
                  const touch = e.touches[0];
                  // Auto-scroll the chip row when dragging near edges
                  const container = chipScrollRef.current;
                  if (container) {
                    const rect = container.getBoundingClientRect();
                    const edgeZone = 40;
                    if (touch.clientX < rect.left + edgeZone) {
                      container.scrollLeft -= 8;
                    } else if (touch.clientX > rect.right - edgeZone) {
                      container.scrollLeft += 8;
                    }
                  }
                  const target = document.elementFromPoint(touch.clientX, touch.clientY);
                  if (target) {
                    const targetBtn = target.closest('button[draggable]');
                    if (targetBtn) {
                      for (const [id, ref] of chipRefs.current) {
                        if (ref === targetBtn) { handleDragOver(id); break; }
                      }
                    }
                  }
                }}
                onTouchEnd={handleDragEnd}
                style={{
                  padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                  cursor: 'grab', whiteSpace: 'nowrap', touchAction: 'none',
                  flexShrink: 0,
                  border: on ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  background: isDragging ? 'rgba(74,222,128,0.25)' : on ? 'rgba(74,222,128,0.1)' : 'transparent',
                  color: on ? '#4ade80' : '#444',
                  opacity: isDragging ? 0.6 : 1,
                  transform: isDragging ? 'scale(1.08)' : 'scale(1)',
                  transition: 'transform 0.15s, opacity 0.15s, background 0.15s',
                }}
              >{on ? '✓ ' : ''}{el.label}</button>
            );
          })}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          {mode === 'sequence' ? (
            <>
              {hasNativeShare && (() => {
                const isReady = !!preparedShareFile && !preparing;
                const isPreparing = preparing && !prepFailed;
                const pct = Math.max(0, Math.min(100, Math.round(prepProgress * 100)));
                const handleClick = () => {
                  if (prepFailed) {
                    // Retry: clear failure + invalidate and let the effect re-fire.
                    setPrepFailed(false);
                    prepKeyRef.current = '';
                    return;
                  }
                  handleShareSequence();
                };
                return (
                  <button
                    onClick={handleClick}
                    disabled={recording || isPlaying || isPreparing || (!isReady && !prepFailed)}
                    style={{
                      flex: 1, maxWidth: 180, padding: 0, borderRadius: 10, border: 'none',
                      background: prepFailed ? '#7f1d1d' : isReady ? '#4ade80' : '#222',
                      color: prepFailed ? '#fff' : isReady ? '#000' : '#e5e7eb',
                      fontSize: 14, fontWeight: 700, height: 44,
                      cursor: recording || isPlaying || isPreparing ? 'wait' : 'pointer',
                      position: 'relative', overflow: 'hidden',
                    }}
                  >
                    {/* Progress fill (only while preparing) */}
                    {isPreparing && !recording && (
                      <div
                        aria-hidden
                        style={{
                          position: 'absolute', left: 0, top: 0, bottom: 0,
                          width: `${pct}%`,
                          background: 'linear-gradient(90deg, #4ade80 0%, #22c55e 100%)',
                          opacity: 0.35,
                          transition: 'width 0.15s linear',
                        }}
                      />
                    )}
                    <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                      {recording
                        ? 'Recording\u2026'
                        : prepFailed
                          ? 'Retry share'
                          : isReady
                            ? <>
                                Share
                                {prepHasAudio === false && (
                                  <span title="Your browser couldn't encode AAC audio — the shared video is silent."
                                        style={{ fontSize: 10, fontWeight: 600, opacity: 0.7 }}>
                                    {'\u{1F507}'}
                                  </span>
                                )}
                              </>
                            : `Preparing \u00B7 ${pct}%`}
                    </span>
                  </button>
                );
              })()}
              <button
                onClick={() => handleExportVideo('download')}
                disabled={recording || isPlaying}
                style={{
                  flex: 1, maxWidth: 180, padding: '11px 14px', borderRadius: 10,
                  border: hasNativeShare ? '1px solid rgba(255,255,255,0.15)' : 'none',
                  background: hasNativeShare ? 'rgba(255,255,255,0.06)' : recording ? '#333' : '#4ade80',
                  color: hasNativeShare ? (recording ? '#555' : '#fff') : (recording ? '#888' : '#000'),
                  fontSize: 14, fontWeight: hasNativeShare ? 600 : 700,
                  cursor: recording || isPlaying ? 'wait' : 'pointer',
                }}
              >
                {recording ? 'Recording\u2026' : isVideoCaptureSupported() ? 'Download video' : 'Download frame'}
              </button>
            </>
          ) : (<>
          {hasNativeShare && (
            <button onClick={() => handleCapture('share')} disabled={capturing} style={{
              flex: 1, maxWidth: 140, padding: '11px 14px', borderRadius: 10, border: 'none',
              background: capturing ? '#333' : '#4ade80',
              color: capturing ? '#888' : '#000',
              fontSize: 14, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
            }}>{capturing ? '...' : 'Share'}</button>
          )}
          <button onClick={() => handleCapture('download')} disabled={capturing} style={{
            flex: 1, maxWidth: 140, padding: '11px 14px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.06)',
            color: capturing ? '#555' : '#fff',
            fontSize: 14, fontWeight: 600, cursor: capturing ? 'wait' : 'pointer',
          }}>{capturing ? '...' : 'Download'}</button>
          <button onClick={() => handleCapture('copy')} disabled={capturing} style={{
            padding: '11px 14px', borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.06)',
            background: 'transparent',
            color: copied ? '#4ade80' : capturing ? '#555' : '#666',
            fontSize: 12, fontWeight: 600, cursor: capturing ? 'wait' : 'pointer',
          }}>{copied ? '✓' : 'Copy'}</button>
          </>)}
        </div>
      </div>
    </div>
  );
}
