/* eslint-disable no-restricted-globals */

/**
 * Minimal wrapper that loads Stockfish from CDN.
 *
 * The stockfish.js (v17.1 lite-single) is an IIFE that auto-detects
 * Web Worker context and self-initializes. It reads the WASM URL from
 * self.location.hash, which is set by StockfishClient:
 *
 *   new Worker('/stockfish/worker.js#<wasm-cdn-url>')
 *
 * IMPORTANT: The -single variant is compiled with Asyncify. The runtime
 * checks `typeof IS_ASYNCIFY` to decide whether `go` commands should
 * use async ccall (letting the search yield via Asyncify). Without this
 * flag, search commands run synchronously and crash the WASM.
 *
 * Protocol: plain UCI strings in both directions.
 *   Main -> Worker: postMessage("uci")
 *   Worker -> Main: postMessage("uciok")
 */

var IS_ASYNCIFY = true;

var CDN_BASE = 'https://unpkg.com/stockfish@17.1.0/src';
var SF_JS = CDN_BASE + '/stockfish-17.1-lite-single-03e3232.js';

importScripts(SF_JS);
