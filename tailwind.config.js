/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx,html}',
    './index.html',
  ],
  theme: {
    extend: {
      colors: {
        chess: {
          light: '#f0d9b5',
          dark: '#b58863',
          bg: 'rgb(var(--chess-bg) / <alpha-value>)',
          surface: 'rgb(var(--chess-surface) / <alpha-value>)',
          text: 'rgb(var(--chess-text) / <alpha-value>)',
          'text-secondary': 'rgb(var(--chess-text-secondary) / <alpha-value>)',
          'text-tertiary': 'rgb(var(--chess-text-tertiary) / <alpha-value>)',
          'text-disabled': 'rgb(var(--chess-text-disabled) / <alpha-value>)',
          accent: 'rgb(var(--chess-accent) / <alpha-value>)',
          blunder: 'rgb(var(--chess-blunder) / <alpha-value>)',
          mistake: 'rgb(var(--chess-mistake) / <alpha-value>)',
          inaccuracy: 'rgb(var(--chess-inaccuracy) / <alpha-value>)',
          best: 'rgb(var(--chess-best) / <alpha-value>)',
          excellent: 'rgb(var(--chess-excellent) / <alpha-value>)',
          muted: 'rgb(var(--chess-muted) / <alpha-value>)',
          border: 'rgb(var(--chess-border) / <alpha-value>)',
        },
      },
      keyframes: {
        'fade-in-up': {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.8)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 8px rgba(74,222,128,0.4)' },
          '50%': { boxShadow: '0 0 28px rgba(74,222,128,0.8)' },
        },
        'spin-slow': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'dimension-reveal': {
          '0%': { opacity: '0', transform: 'scale(0) translateY(10px)' },
          '60%': { opacity: '1', transform: 'scale(1.15) translateY(0)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        'unlock-burst': {
          '0%': { transform: 'scale(0)', opacity: '1' },
          '50%': { transform: 'scale(1.5)', opacity: '0.5' },
          '100%': { transform: 'scale(2)', opacity: '0' },
        },
        'orbit': {
          '0%': { transform: 'rotate(0deg) translateX(50px) rotate(0deg)' },
          '100%': { transform: 'rotate(360deg) translateX(50px) rotate(-360deg)' },
        },
        'count-up': {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        // ── Fancy UI keyframes ──
        'ticker-roll': {
          '0%': { transform: 'translateY(100%)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'border-beam': {
          '0%': { left: '-20%' },
          '100%': { left: '120%' },
        },
        'aurora-drift': {
          '0%, 100%': { transform: 'translate(0, 0) rotate(0deg) scale(1)' },
          '25%': { transform: 'translate(30px, -20px) rotate(3deg) scale(1.05)' },
          '50%': { transform: 'translate(-20px, 20px) rotate(-2deg) scale(0.95)' },
          '75%': { transform: 'translate(10px, 10px) rotate(1deg) scale(1.02)' },
        },
        'word-blur-in': {
          '0%': { opacity: '0', filter: 'blur(8px)', transform: 'translateY(4px)' },
          '100%': { opacity: '1', filter: 'blur(0)', transform: 'translateY(0)' },
        },
        'shimmer-sweep': {
          '0%': { left: '-100%' },
          '100%': { left: '200%' },
        },
        'neon-rotate': {
          '0%': { '--neon-angle': '0deg' },
          '100%': { '--neon-angle': '360deg' },
        },
      },
      animation: {
        'fade-in-up': 'fade-in-up 0.6s ease-out forwards',
        'fade-in': 'fade-in 0.5s ease-out forwards',
        'scale-in': 'scale-in 0.4s ease-out forwards',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'dimension-reveal': 'dimension-reveal 0.8s ease-out forwards',
        'unlock-burst': 'unlock-burst 0.6s ease-out forwards',
        'orbit': 'orbit 6s linear infinite',
        'count-up': 'count-up 0.4s ease-out forwards',
        // ── Fancy UI animations ──
        'ticker-roll': 'ticker-roll 0.6s ease-out both',
        'border-beam': 'border-beam 2.5s linear infinite',
        'aurora-drift': 'aurora-drift 8s ease-in-out infinite',
        'word-blur-in': 'word-blur-in 0.4s ease-out both',
        'shimmer-sweep': 'shimmer-sweep 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
