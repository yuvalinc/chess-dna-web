import { AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig, interpolate, staticFile } from "remotion";
import { Chess } from "chess.js";
import { useMemo } from "react";
import { ChessBoard } from "../board/ChessBoard";
import { Background } from "../board/Background";
import { GunOverlay } from "../board/GunOverlay";
import { ParticleBurst, type ParticleKind } from "../board/ParticleBurst";
import { squareToXY, findKingSquare, type Square, type PieceCode } from "../board/fen";
import type { MoveSequenceShot as MoveSequenceShotProps } from "../storyboard/types";

type ResolvedMove = {
  from: Square;
  to: Square;
  piece: PieceCode;
  captured?: PieceCode;
  promotion?: PieceCode;
  san: string;
  fenBefore: string;
  fenAfter: string;
  isBrilliant: boolean;
  isMate: boolean;
  isCheck: boolean;
  isCastle: boolean;
  loserKingSquare?: Square;
  rookFrom?: Square;
  rookTo?: Square;
};

const PIECE_TO_CODE: Record<string, PieceCode> = {
  wp: "wP", wn: "wN", wb: "wB", wr: "wR", wq: "wQ", wk: "wK",
  bp: "bP", bn: "bN", bb: "bB", br: "bR", bq: "bQ", bk: "bK",
};

function resolveMoves(startFen: string, sanMoves: string[], brilliantIdx?: number): ResolvedMove[] {
  const chess = new Chess(startFen);
  const out: ResolvedMove[] = [];
  for (let i = 0; i < sanMoves.length; i++) {
    const fenBefore = chess.fen();
    const result = chess.move(sanMoves[i]);
    if (!result) {
      throw new Error(`Invalid move at index ${i}: ${sanMoves[i]} from ${fenBefore}`);
    }
    const code = PIECE_TO_CODE[`${result.color}${result.piece}`];
    const captured = result.captured
      ? PIECE_TO_CODE[`${result.color === "w" ? "b" : "w"}${result.captured}`]
      : undefined;

    let rookFrom: Square | undefined;
    let rookTo: Square | undefined;
    if (result.flags.includes("k")) {
      // kingside castle
      rookFrom = (result.color === "w" ? "h1" : "h8") as Square;
      rookTo = (result.color === "w" ? "f1" : "f8") as Square;
    } else if (result.flags.includes("q")) {
      // queenside castle
      rookFrom = (result.color === "w" ? "a1" : "a8") as Square;
      rookTo = (result.color === "w" ? "d1" : "d8") as Square;
    }

    const isMate = chess.isCheckmate();
    const isCheck = chess.inCheck() && !isMate;
    const isCastle = !!rookFrom;
    const loserColor = result.color === "w" ? "b" : "w";
    const loserKingSquare = isMate
      ? (findKingSquare(chess.fen(), loserColor) ?? undefined)
      : undefined;
    const promotion = result.promotion
      ? (PIECE_TO_CODE[`${result.color}${result.promotion}`] as PieceCode)
      : undefined;
    out.push({
      from: result.from as Square,
      to: result.to as Square,
      piece: code,
      captured,
      promotion,
      san: result.san,
      fenBefore,
      fenAfter: chess.fen(),
      isBrilliant: brilliantIdx === i || isMate || !!result.promotion,
      isMate,
      isCheck,
      isCastle,
      loserKingSquare,
      rookFrom,
      rookTo,
    });
  }
  return out;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Pick the best particle burst spec for a given move event.
function pickBurstFor(m: ResolvedMove): { kind: ParticleKind; color: string; life: number } | null {
  if (m.isMate) return { kind: "confetti", color: "#dc2626", life: 0.9 };
  if (m.promotion) return { kind: "sparkle", color: "#fde047", life: 0.7 };
  if (m.isBrilliant) return { kind: "sparkle", color: "#fbbf24", life: 0.7 };
  if (m.captured) return { kind: "burst", color: "#f97316", life: 0.55 };
  if (m.isCheck) return { kind: "burst", color: "#dc2626", life: 0.45 };
  if (m.isCastle) return { kind: "smoke", color: "#94a3b8", life: 0.5 };
  return null;
}

// Pick the SFX file for an event. Priority: mate > promotion > castle > brilliant > check > capture > normal.
function pickSfxFor(m: ResolvedMove): string {
  if (m.isMate) return "sfx/mate.wav";
  if (m.promotion) return "sfx/promotion.wav";
  if (m.isCastle) return "sfx/castle.wav";
  if (m.isBrilliant) return "sfx/brilliant.wav";
  if (m.isCheck) return "sfx/check.wav";
  if (m.captured) return "sfx/capture.wav";
  return "sfx/move.wav";
}

export const MoveSequenceShot: React.FC<MoveSequenceShotProps> = ({
  startFen,
  moves,
  brilliantMoveIndex,
  durationSec,
  caption,
  theme = "classicGreen",
  flipped = false,
  whitePlayer,
  blackPlayer,
  startMoveNumber,
  showGuns = false,
  squareMemes,
  topBarText,
  bottomBarText,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const totalFrames = Math.round(durationSec * fps);

  const resolved = useMemo(
    () => resolveMoves(startFen, moves, brilliantMoveIndex),
    [startFen, moves, brilliantMoveIndex],
  );

  const boardSize = Math.min(width * 0.95, 900);
  const cell = boardSize / 8;

  // Allocate per-move time. Brilliant move gets 1.6x weight for emphasis.
  const weights = resolved.map((m) => (m.isBrilliant ? 1.6 : 1));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const moveDurations = weights.map((w) => totalFrames * (w / totalWeight));
  const moveStarts: number[] = [];
  let acc = 0;
  for (const d of moveDurations) {
    moveStarts.push(acc);
    acc += d;
  }

  // Find current move
  let currentIdx = resolved.length - 1;
  for (let i = 0; i < resolved.length; i++) {
    if (frame < moveStarts[i] + moveDurations[i]) {
      currentIdx = i;
      break;
    }
  }
  const cur = resolved[currentIdx];
  const localFrame = frame - moveStarts[currentIdx];
  const localDur = moveDurations[currentIdx];

  // Phase split: 0-70% animate piece, 70-90% land + flash, 90-100% settle
  const animateFrac = 0.7;
  const animateProgress = Math.min(1, localFrame / (localDur * animateFrac));
  const eased = easeInOutCubic(animateProgress);
  const isLanded = animateProgress >= 1;
  const flashFrac =
    isLanded && localFrame < localDur * (animateFrac + 0.18)
      ? Math.max(0, 1 - (localFrame - localDur * animateFrac) / (localDur * 0.18))
      : 0;

  // Render: pre-move FEN with the from-piece flying, OR post-move FEN
  const fenToRender = isLanded ? cur.fenAfter : cur.fenBefore;

  // Compute moving piece coords
  const fromXY = squareToXY(cur.from, boardSize);
  const toXY = squareToXY(cur.to, boardSize);
  const liftedY = -cell * 0.25 * Math.sin(animateProgress * Math.PI);
  const px = fromXY.x + (toXY.x - fromXY.x) * eased;
  const py = fromXY.y + (toXY.y - fromXY.y) * eased + liftedY;

  const movingPieces: ChessBoardMP[] = [];
  const hideAtSquares: Square[] = [];
  const pieceOverrides: ChessBoardOverride[] = [];
  let arrows: ChessBoardArrow[] = [];

  // Time spent after the piece has "landed" (in frames)
  const postLandFrames = Math.max(0, localFrame - localDur * animateFrac);
  // Lay-down anim: 90° rotation over 25% of move duration after landing.
  const layDownDur = localDur * 0.25;
  const layDownProgress = Math.min(1, postLandFrames / layDownDur);
  const layEased = layDownProgress * layDownProgress * (3 - 2 * layDownProgress);

  if (!isLanded) {
    hideAtSquares.push(cur.from);
    // Captured piece: stays visible during flight, fades out in last 25% as
    // the attacker closes in. Avoids the "weird early disappear" bug.
    if (cur.captured) {
      const fadeProgress = Math.max(0, (animateProgress - 0.75) / 0.25);
      const capturedOpacity = 1 - fadeProgress;
      pieceOverrides.push({
        square: cur.to,
        opacity: capturedOpacity,
        scale: 1 - 0.15 * fadeProgress,
      });
    }

    // Spin: brilliant/mate moves spin twice during flight
    const flightSpin = cur.isBrilliant ? animateProgress * 720 : 0;

    // Promotion: switch from pawn → promoted piece at the last 15% of flight
    const promoteFlip = cur.promotion && animateProgress > 0.85 ? 1 : 0;
    const visualPiece = promoteFlip ? cur.promotion! : cur.piece;
    const promoteScale = cur.promotion
      ? 1 + 0.35 * Math.max(0, (animateProgress - 0.85) / 0.15)
      : 1;

    movingPieces.push({
      code: visualPiece,
      x: px,
      y: py,
      scale: (1 + 0.15 * Math.sin(animateProgress * Math.PI)) * promoteScale,
      rotate: flightSpin,
      glow: cur.isBrilliant || cur.promotion ? "#fbbf24" : undefined,
      trail: cur.isBrilliant ? 1.5 : 0.6,
    });

    // Castling: also animate the rook
    if (cur.rookFrom && cur.rookTo) {
      const rfXY = squareToXY(cur.rookFrom, boardSize);
      const rtXY = squareToXY(cur.rookTo, boardSize);
      const rx = rfXY.x + (rtXY.x - rfXY.x) * eased;
      const ry = rfXY.y + (rtXY.y - rfXY.y) * eased;
      const rookCode = (cur.piece[0] + "R") as PieceCode;
      hideAtSquares.push(cur.rookFrom);
      movingPieces.push({ code: rookCode, x: rx, y: ry });
    }

    // Arrow draws progressively
    arrows = [
      {
        from: cur.from,
        to: cur.to,
        color: cur.isBrilliant ? "#fbbf24" : "#22d3ee",
        progress: animateProgress,
      },
    ];
  } else if (cur.isMate && cur.loserKingSquare) {
    // Mate landed: queen lands upright; the LOSER'S KING tips over with red glow.
    const r = Math.round(220);
    const g = Math.round(38);
    const b = Math.round(38);
    pieceOverrides.push({
      square: cur.loserKingSquare,
      rotate: layEased * 90,
      scale: 1 + 0.05 * layEased,
      glow: `rgba(${r},${g},${b},${0.3 + 0.7 * layEased})`,
    });
  }

  // Last-move highlight: yellow normally, red on mate
  const lastMoveHighlights = isLanded
    ? cur.isMate
      ? [
          { square: cur.from, color: "#dc2626", opacity: 0.35 + 0.2 * layEased },
          { square: cur.to, color: "#dc2626", opacity: 0.5 + 0.3 * layEased },
        ]
      : [
          { square: cur.from, color: "#fbbf24", opacity: 0.45 },
          { square: cur.to, color: "#fbbf24", opacity: 0.55 },
        ]
    : [];

  // Move counter / SAN display — supports absolute move number via startMoveNumber.
  // resolveMoves preserves alternating colors, so we infer from piece color.
  const isWhiteMove = cur.piece[0] === "w";
  const moverIndexInColor = (() => {
    // Count how many of the same color have moved up to and including currentIdx.
    let count = 0;
    for (let i = 0; i <= currentIdx; i++) {
      if (resolved[i].piece[0] === cur.piece[0]) count++;
    }
    return count;
  })();
  const baseMoveNum = startMoveNumber ?? (resolved[0].piece[0] === "w" ? 1 : 1);
  const moveNum = isWhiteMove
    ? baseMoveNum + moverIndexInColor - 1
    : baseMoveNum + moverIndexInColor - (resolved[0].piece[0] === "w" ? 1 : 0);
  const sanText = `${moveNum}${isWhiteMove ? "." : "..."} ${cur.san}`;

  // Active player for the badge
  const activePlayer = isWhiteMove ? whitePlayer : blackPlayer;
  const activeColor = isWhiteMove ? "#fafafa" : "#1a1a1a";
  const activeAccent = isWhiteMove ? "#fbbf24" : "#22d3ee";

  // Moving-piece follower badge — position next to the piece, on whichever side
  // is least likely to be cropped by the board edge. Compact: avatar + name only.
  const pieceLeftSide = px > boardSize * 0.55; // piece is on right half? then place badge to the LEFT
  const pieceTopSide = py < boardSize * 0.35;  // piece is on top? then place badge BELOW
  const badgeWidth = 170;
  const badgeHeight = 56;
  const offsetX = pieceLeftSide ? -badgeWidth - cell * 0.1 : cell * 1.05;
  const offsetY = pieceTopSide ? cell * 0.95 : -badgeHeight - cell * 0.2;
  const followerX = (flipped ? boardSize - px - cell : px) + offsetX;
  const followerY = (flipped ? boardSize - py - cell : py) + offsetY;

  // Subtle camera breath
  const breath = 1 + 0.01 * Math.sin((frame / fps) * Math.PI * 0.8);

  return (
    <AbsoluteFill>
      {/* Event-driven SFX: one short audio clip per move, scheduled at the
          landing frame for that move. Synthesized procedurally — see public/sfx/. */}
      {resolved.map((m, i) => {
        const landingFrame = Math.round(moveStarts[i] + moveDurations[i] * 0.7);
        const sfxFrames = Math.round(fps * 1.2); // generous tail for ambience
        return (
          <Sequence key={`sfx-${i}`} from={landingFrame} durationInFrames={sfxFrames}>
            <Audio src={staticFile(pickSfxFor(m))} volume={0.85} />
          </Sequence>
        );
      })}

      <Background variant={cur.isMate && isLanded ? "redglow" : cur.isBrilliant && isLanded ? "warm" : "noir"} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ position: "relative", transform: `scale(${breath})` }}>
          <ChessBoard
            fen={fenToRender}
            size={boardSize}
            theme={theme}
            tilt={showGuns ? 0 : 3}
            saturate={1.2}
            highlights={lastMoveHighlights}
            hideAtSquares={hideAtSquares}
            movingPieces={movingPieces}
            arrows={showGuns ? [] : arrows}
            pieceOverrides={pieceOverrides}
            squareMemes={squareMemes}
            flipped={flipped}
          />

          {/* Event-driven particle burst — appears at landing, fades over ~0.6s */}
          {(() => {
            // Pick the burst kind/color based on what happened on the current move
            const burstSpec = pickBurstFor(cur);
            if (!burstSpec) return null;
            const burstDurFrames = Math.round(fps * burstSpec.life);
            const burstStart = localDur * animateFrac; // landing point
            const t = (localFrame - burstStart) / burstDurFrames;
            if (t < 0 || t > 1) return null;
            return (
              <ParticleBurst
                square={cur.to}
                boardSize={boardSize}
                flipped={flipped}
                life={1 - t}
                seed={currentIdx + 1}
                kind={burstSpec.kind}
                color={burstSpec.color}
              />
            );
          })()}

          {/* Secondary ring shockwave on captures + mate — adds impact */}
          {(cur.captured || cur.isMate) && (() => {
            const ringDurFrames = Math.round(fps * 0.55);
            const ringStart = localDur * animateFrac;
            const t = (localFrame - ringStart) / ringDurFrames;
            if (t < 0 || t > 1) return null;
            return (
              <ParticleBurst
                square={cur.to}
                boardSize={boardSize}
                flipped={flipped}
                life={1 - t}
                seed={currentIdx + 100}
                kind="ring"
                color={cur.isMate ? "#dc2626" : "#f97316"}
              />
            );
          })()}

          {/* AK-47 overlays — meme mode. Guns flank the destination square,
              bouncing in at the start of the move and fading by the end. */}
          {showGuns && (() => {
            const gunIn = Math.min(1, localFrame / (localDur * 0.25));
            const gunOut = Math.max(0, 1 - Math.max(0, localFrame - localDur * 0.7) / (localDur * 0.3));
            const gunProgress = gunIn * gunOut;
            if (gunProgress <= 0.02) return null;
            return (
              <GunOverlay
                square={cur.to}
                boardSize={boardSize}
                flipped={flipped}
                progress={gunProgress}
                color={cur.isBrilliant ? "#fbbf24" : "#dc2626"}
              />
            );
          })()}

          {/* Follower badge — sits NEXT TO the moving piece. Avatar + name only.
              Hidden in meme mode (the guns + bars take over the framing). */}
          {!showGuns && activePlayer && (
          <div
            style={{
              position: "absolute",
              left: followerX,
              top: followerY,
              width: badgeWidth,
              height: badgeHeight,
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: "rgba(0,0,0,0.86)",
              border: `2px solid ${activeAccent}`,
              padding: "4px 16px 4px 4px",
              borderRadius: 999,
              boxShadow: `0 6px 16px rgba(0,0,0,0.55), 0 0 16px ${activeAccent}88`,
              pointerEvents: "none",
              zIndex: 10,
            }}
          >
            {activePlayer?.photoUrl ? (
              <img
                src={
                  activePlayer.photoUrl.startsWith("http")
                    ? activePlayer.photoUrl
                    : staticFile(activePlayer.photoUrl)
                }
                alt={activePlayer.name}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: `2px solid ${activeAccent}`,
                  boxShadow: `0 0 8px ${activeAccent}`,
                  flexShrink: 0,
                }}
              />
            ) : (
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: activeColor,
                  border: `2px solid ${activeAccent}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: isWhiteMove ? "#000" : "#fff",
                  fontWeight: 900,
                  fontSize: 20,
                  flexShrink: 0,
                }}
              >
                {activePlayer?.name?.[0] ?? "?"}
              </div>
            )}
            <div
              style={{
                fontFamily: "Impact, 'Arial Black', sans-serif",
                color: "white",
                fontSize: 20,
                fontWeight: 900,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                textShadow: "1px 1px 0 #000",
                whiteSpace: "nowrap",
              }}
            >
              {activePlayer?.name ?? (isWhiteMove ? "WHITE" : "BLACK")}
            </div>
          </div>
          )}
          {/* Landing flash — promotions get a huge full-screen flash */}
          {flashFrac > 0 && cur.promotion && (
            <div
              style={{
                position: "absolute",
                inset: -300,
                background: `radial-gradient(circle at center, rgba(255,235,150,${flashFrac * 0.85}) 0%, rgba(251,191,36,${flashFrac * 0.5}) 30%, transparent 70%)`,
                pointerEvents: "none",
              }}
            />
          )}
          {flashFrac > 0 && (
            <div
              style={{
                position: "absolute",
                left: (flipped ? boardSize - toXY.x - cell : toXY.x),
                top: (flipped ? boardSize - toXY.y - cell : toXY.y),
                width: cell,
                height: cell,
                borderRadius: 12,
                background: cur.isBrilliant
                  ? `radial-gradient(circle, rgba(251,191,36,${flashFrac}) 0%, transparent 70%)`
                  : `radial-gradient(circle, rgba(255,255,255,${flashFrac * 0.7}) 0%, transparent 70%)`,
                boxShadow: cur.isBrilliant
                  ? `0 0 ${40 * flashFrac}px ${20 * flashFrac}px #fbbf24`
                  : undefined,
                pointerEvents: "none",
              }}
            />
          )}
        </div>
      </AbsoluteFill>

      {caption && (
        <div
          style={{
            position: "absolute",
            bottom: 90,
            left: 0,
            right: 0,
            textAlign: "center",
            color: "white",
            fontFamily: "Impact, 'Arial Black', sans-serif",
            fontSize: 56,
            fontWeight: 900,
            letterSpacing: "0.06em",
            textShadow:
              "0 0 16px #f59e0b, 4px 4px 0 #000, 2px 2px 0 #000",
            opacity: interpolate(frame, [fps * 0.5, fps * 1.0], [0, 1], {
              extrapolateRight: "clamp",
            }),
            transform: "skewX(-4deg)",
            WebkitTextStroke: "1.5px #000",
          }}
        >
          {caption}
        </div>
      )}

      {/* Top bar — meme reel format */}
      {topBarText && (
        <div
          style={{
            position: "absolute",
            top: 230,
            left: 0,
            right: 0,
            background: "#0a0a0a",
            padding: "28px 40px",
            textAlign: "center",
            fontFamily: "'Helvetica Neue', 'Arial Black', Impact, sans-serif",
            fontSize: 80,
            fontWeight: 900,
            color: "white",
            letterSpacing: "-0.01em",
            lineHeight: 1.05,
            zIndex: 15,
          }}
        >
          {topBarText}
        </div>
      )}
      {/* Bottom caption bar — meme reel format */}
      {bottomBarText && (
        <div
          style={{
            position: "absolute",
            bottom: 230,
            left: 0,
            right: 0,
            background: "#0a0a0a",
            padding: "24px 40px",
            fontFamily: "'Helvetica Neue', 'Arial', sans-serif",
            fontSize: 48,
            fontWeight: 700,
            color: "#22d3ee",
            letterSpacing: "-0.005em",
            lineHeight: 1.1,
            zIndex: 15,
          }}
        >
          {bottomBarText}
        </div>
      )}
    </AbsoluteFill>
  );
};

type ChessBoardMP = {
  code: PieceCode;
  x: number;
  y: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
  glow?: string;
  trail?: number;
};
type ChessBoardArrow = {
  from: Square;
  to: Square;
  color?: string;
  progress?: number;
};
type ChessBoardOverride = {
  square: Square;
  rotate?: number;
  scale?: number;
  glow?: string;
  opacity?: number;
};
