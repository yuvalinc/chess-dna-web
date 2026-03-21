/**
 * Postinstall script: copy Stockfish WASM files to public/stockfish/
 */
import { cpSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dest = join(root, 'public', 'stockfish');
const src = join(root, 'node_modules', 'stockfish', 'src');

if (!existsSync(src)) {
  console.log('[copy-stockfish] stockfish package not found, skipping');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });

// Find the lite-single variant files
const files = readdirSync(src);
const jsFile = files.find((f) => f.includes('lite-single') && f.endsWith('.js'));
const wasmFile = files.find((f) => f.includes('lite-single') && f.endsWith('.wasm'));

if (jsFile) {
  cpSync(join(src, jsFile), join(dest, 'stockfish.js'));
  console.log(`[copy-stockfish] Copied ${jsFile} → public/stockfish/stockfish.js`);
}

if (wasmFile) {
  cpSync(join(src, wasmFile), join(dest, 'stockfish.wasm'));
  console.log(`[copy-stockfish] Copied ${wasmFile} → public/stockfish/stockfish.wasm`);
}

if (!jsFile && !wasmFile) {
  console.warn('[copy-stockfish] No lite-single files found in stockfish/src');
}
