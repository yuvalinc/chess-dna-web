#!/usr/bin/env node
// Fetch yuvalinc's chess.com games and find a recent win by checkmate.

import { Chess } from "chess.js";

const USERNAME = "yuvalinc";
const UA = "chess-dna-video/0.1 (yuval)";

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function isWinByMate(game, username) {
  const userIsWhite = game.white.username.toLowerCase() === username.toLowerCase();
  const userIsBlack = game.black.username.toLowerCase() === username.toLowerCase();
  if (!userIsWhite && !userIsBlack) return false;
  // chess.com result codes: "win", "checkmated", "agreed", "repetition", "timeout", "resigned", ...
  const userResult = userIsWhite ? game.white.result : game.black.result;
  const oppResult = userIsWhite ? game.black.result : game.white.result;
  return userResult === "win" && oppResult === "checkmated";
}

async function main() {
  const { archives } = await fetchJson(
    `https://api.chess.com/pub/player/${USERNAME}/games/archives`,
  );
  // Walk from most recent month backwards.
  for (const archiveUrl of archives.slice().reverse()) {
    const { games } = await fetchJson(archiveUrl);
    // Most recent games last in array — iterate reversed.
    for (const game of games.slice().reverse()) {
      if (!isWinByMate(game, USERNAME)) continue;
      const userIsWhite = game.white.username.toLowerCase() === USERNAME.toLowerCase();
      const opponent = userIsWhite ? game.black.username : game.white.username;
      const userColor = userIsWhite ? "white" : "black";
      const userRating = userIsWhite ? game.white.rating : game.black.rating;
      const oppRating = userIsWhite ? game.black.rating : game.white.rating;

      // Validate by replaying PGN with chess.js — confirm it ends in mate.
      let chess;
      try {
        chess = new Chess();
        chess.loadPgn(game.pgn, { strict: false });
      } catch (e) {
        continue;
      }
      if (!chess.isCheckmate()) continue;
      const history = chess.history({ verbose: true });

      const result = {
        username: USERNAME,
        userColor,
        opponent,
        userRating,
        oppRating,
        timeClass: game.time_class,
        timeControl: game.time_control,
        endTime: new Date(game.end_time * 1000).toISOString(),
        url: game.url,
        archive: archiveUrl,
        moveCount: history.length,
        finalFen: chess.fen(),
        pgn: game.pgn,
        sanMoves: history.map((m) => m.san),
      };
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }
  }
  console.error("No checkmate-win games found.");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
