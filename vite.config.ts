import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { execSync } from 'child_process'

// Auto-source the SEO dashboard's GitHub PAT from the local `gh` CLI when
// running `vite dev`. This avoids having to paste / maintain the token in
// .env.development.local. Returns '' if `gh` is not installed or not logged in,
// in which case the dashboard falls back to its manual "Connect to GitHub" UI.
//
// Gated to dev-only by the `command === 'serve'` check below — never runs at
// `vite build` time, so the token is never bundled into a production deploy.
function readGhToken(): string {
  try {
    return execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch { return ''; }
}

export default defineConfig(({ command }) => ({
  server: { port: 5173 },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@ui': resolve(__dirname, 'src/ui'),
    },
  },
  worker: {
    format: 'es' as const,
  },
  // Inject the gh CLI token into import.meta.env.VITE_SEO_GH_PAT, but ONLY
  // during `vite dev` (command === 'serve'). For `vite build`, leave it
  // undefined so it's not statically replaced in the production bundle.
  define: command === 'serve'
    ? { 'import.meta.env.VITE_SEO_GH_PAT': JSON.stringify(readGhToken()) }
    : {},
}))
