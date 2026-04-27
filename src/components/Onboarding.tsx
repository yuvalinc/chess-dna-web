import { useState } from 'react';
import { useChessData } from '@/contexts/ChessDataContext';

/* ────────────────────────────────────────────────────────────
 *  Journey stages:
 *  0 = Fresh install (no games)
 *  1 = Games imported, analysis in progress (or done but radar not revealed)
 *  2 = Radar revealed, patterns day-gated (not yet next day)
 *  3 = (REMOVED — skipped, S2 goes directly to S4)
 *  4 = Guided walkthrough — shows patterns, training intro
 *  5 = Fully onboarded
 * ──────────────────────────────────────────────────────────── */

export type JourneyStage = 0 | 1 | 2 | 3 | 4 | 5;

export function useJourneyStage(): {
  stage: JourneyStage;
  totalGames: number;
  analyzedGames: number;
  pendingGames: number;
  hasPatterns: boolean;
  hasAI: boolean;
  patternsUnlocked: boolean;
} {
  const {
    totalGameCount,
    analyzedCount,
    analyzingCount,
    pendingCount,
    journeyStage,
    hasPatterns,
    hasAI,
    patternsUnlocked,
  } = useChessData();

  return {
    stage: journeyStage,
    totalGames: totalGameCount,
    analyzedGames: analyzedCount,
    pendingGames: pendingCount + analyzingCount,
    hasPatterns,
    hasAI,
    patternsUnlocked,
  };
}

/* ────────────────────────────────────────────────────────────
 *  Welcome screen — shown on first visit (stage 0)
 * ──────────────────────────────────────────────────────────── */

interface WelcomeProps {
  onDismiss: () => void;
  onGoToSettings: () => void;
}

export function Welcome({ onDismiss, onGoToSettings }: WelcomeProps) {
  const [step, setStep] = useState(0);

  const steps = [
    // Step 0: What is this
    {
      icon: '<img src="/favicon.png" alt="Chess DNA" width="72" height="72" style="border-radius:16px;display:inline-block" />',
      title: 'Welcome to Chess DNA',
      subtitle: 'Your AI-powered chess coach that actually knows you.',
      content: (
        <div className="space-y-4 text-sm text-gray-400">
          <p>
            Chess DNA watches you play on chess.com and builds a personalized profile
            of your strengths, weaknesses, and patterns — then creates lessons and
            exercises targeting exactly where you need to improve.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <FeatureCard icon="&#128202;" label="Your Chess DNA" desc="8-dimension skill radar scored 0-99" />
            <FeatureCard icon="&#128269;" label="Pattern Detection" desc="Finds your recurring mistakes" />
            <FeatureCard icon="&#128218;" label="AI Lessons" desc="Personalized to your weaknesses" />
            <FeatureCard icon="&#9823;" label="Exercises" desc="Practice exactly what you need" />
          </div>
        </div>
      ),
    },
    // Step 1: How it works
    {
      icon: '&#9889;',
      title: 'How It Works',
      subtitle: 'Three simple steps to level up.',
      content: (
        <div className="space-y-4">
          <JourneyStep
            number={1}
            title="Play on chess.com"
            desc="Just play normally. I detect your games automatically — no extra clicks needed."
            status="active"
          />
          <JourneyStep
            number={2}
            title="Stockfish analyzes every move"
            desc="Each game gets deep engine analysis. I find your blunders, mistakes, and brilliant moves."
            status="upcoming"
          />
          <JourneyStep
            number={3}
            title="Your profile evolves"
            desc="After a few games, patterns emerge. Your score, rank, and training plan unlock. The more you play, the smarter I get."
            status="upcoming"
          />
        </div>
      ),
    },
    // Step 2: Optional AI setup
    {
      icon: '&#129302;',
      title: 'Supercharge with AI',
      subtitle: 'Optional but powerful.',
      content: (
        <div className="space-y-4 text-sm text-gray-400">
          <p>
            Add an API key from Claude, OpenAI, or Gemini and I'll generate
            personalized lessons and exercises that target your specific weaknesses.
          </p>
          <div className="bg-chess-bg/50 rounded-xl p-4 border border-chess-border/40">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-2 font-bold">Without AI</div>
            <p className="text-gray-400">Score radar, pattern detection, game analysis, benchmarks — all free, all local.</p>
          </div>
          <div className="bg-chess-accent/5 rounded-xl p-4 border border-chess-accent/20">
            <div className="text-xs text-chess-accent uppercase tracking-wider mb-2 font-bold">With AI</div>
            <p className="text-chess-text-secondary">Everything above <span className="text-chess-accent font-medium">+ AI-generated lessons + practice exercises</span> tailored to your exact weaknesses.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onGoToSettings}
              className="flex-1 bg-chess-accent/10 text-chess-accent border border-chess-accent/20 rounded-lg py-2 text-sm font-medium hover:bg-chess-accent/20 transition-colors"
            >
              Set up AI provider
            </button>
            <button
              onClick={onDismiss}
              className="flex-1 bg-chess-muted/60 text-chess-text-secondary rounded-lg py-2 text-sm font-medium hover:bg-chess-muted transition-colors"
            >
              Skip for now
            </button>
          </div>
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="max-w-lg mx-auto py-6 sm:py-12 px-4">
      {/* Progress dots */}
      <div className="flex justify-center gap-2 mb-6">
        {steps.map((_, i) => (
          <div
            key={i}
            className={`w-2 h-2 rounded-full transition-all ${
              i === step ? 'bg-chess-accent w-6' : i < step ? 'bg-chess-accent/40' : 'bg-chess-muted'
            }`}
          />
        ))}
      </div>

      {/* Content */}
      <div className="text-center mb-6">
        <div
          className="text-5xl mb-4"
          dangerouslySetInnerHTML={{ __html: current.icon }}
        />
        <h2 className="text-2xl font-black text-chess-text mb-1">{current.title}</h2>
        <p className="text-sm text-gray-400">{current.subtitle}</p>
      </div>

      <div className="mb-6">{current.content}</div>

      {/* Navigation */}
      {!isLast && (
        <div className="flex justify-between">
          <button
            onClick={onDismiss}
            className="text-xs text-gray-500 hover:text-chess-text-secondary transition-colors"
          >
            Skip intro
          </button>
          <button
            onClick={() => setStep((s) => s + 1)}
            className="bg-chess-accent text-chess-bg px-6 py-2 rounded-lg text-sm font-medium hover:brightness-110 transition-all"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────
 *  Journey Progress Bar — shows where user is in the unlock chain
 *  Displayed on Overview when not fully unlocked
 * ──────────────────────────────────────────────────────────── */

interface JourneyProgressProps {
  stage: JourneyStage;
  analyzedGames: number;
  pendingGames: number;
  onGoToSettings: () => void;
}

export function JourneyProgress({
  stage,
  analyzedGames,
  pendingGames,
  onGoToSettings,
}: JourneyProgressProps) {
  if (stage >= 5) return null; // fully unlocked

  const milestones = [
    { label: 'Import games', done: stage >= 1, icon: '&#9812;' },
    { label: 'Chess DNA', done: stage >= 2, icon: '<svg class="text-chess-accent inline-block" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(45 12 12)"><path d="M8 2c0 6.5 8 12.5 8 19"/><path d="M16 2c0 6.5-8 12.5-8 19"/></g></svg>' },
    { label: 'Patterns', done: stage >= 3, icon: '&#128269;' },
    { label: 'Get started', done: stage >= 4, icon: '&#128640;' },
    { label: 'Training', done: stage >= 5, icon: '&#129302;' },
  ];

  return (
    <div className="bg-chess-surface rounded-2xl p-4 sm:p-5 mb-6 border border-chess-border/30">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-chess-accent text-lg">&#127942;</span>
        <h3 className="text-sm font-bold text-chess-text">Your Journey</h3>
      </div>

      {/* Progress bar */}
      <div className="flex items-center gap-1 mb-4">
        {milestones.map((m, i) => (
          <div key={i} className="flex items-center flex-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs shrink-0 ${
                m.done
                  ? 'bg-chess-accent/20 text-chess-accent border border-chess-accent/30'
                  : 'bg-chess-muted/60 text-gray-500 border border-chess-border/40'
              }`}
              dangerouslySetInnerHTML={{ __html: m.icon }}
            />
            {i < milestones.length - 1 && (
              <div
                className={`h-0.5 flex-1 mx-1 rounded ${
                  milestones[i + 1].done ? 'bg-chess-accent/40' : 'bg-chess-muted'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Labels */}
      <div className="flex items-start gap-1">
        {milestones.map((m, i) => (
          <div key={i} className="flex-1 text-center">
            <div
              className={`text-[10px] leading-tight ${
                m.done ? 'text-chess-accent font-medium' : 'text-gray-500'
              }`}
            >
              {m.label}
            </div>
          </div>
        ))}
      </div>

      {/* Contextual message */}
      <div className="mt-3 pt-3 border-t border-chess-border/40">
        {stage === 0 && (
          <p className="text-xs text-gray-400">
            &#128640; Head to <span className="text-chess-text font-medium">chess.com</span> and play a game.
            I'll detect it automatically!
          </p>
        )}
        {stage === 1 && pendingGames > 0 && (
          <p className="text-xs text-gray-400">
            &#9889; Analyzing {pendingGames} game{pendingGames !== 1 ? 's' : ''}...
            Stockfish is studying your moves right now.
          </p>
        )}
        {stage === 2 && (
          <p className="text-xs text-gray-400">
            &#128200; {analyzedGames} game{analyzedGames !== 1 ? 's' : ''} analyzed!
            {analyzedGames < 3
              ? ` Play ${3 - analyzedGames} more to unlock pattern detection.`
              : ' Patterns should appear shortly — try refreshing.'}
          </p>
        )}
        {stage === 3 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              &#127881; Patterns unlocked! Add an AI provider to get personalized lessons.
            </p>
            <button
              onClick={onGoToSettings}
              className="text-xs text-chess-accent hover:underline font-medium shrink-0 ml-2"
            >
              Settings &rarr;
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Helpers ── */

function FeatureCard({ icon, label, desc }: { icon: string; label: string; desc: string }) {
  return (
    <div className="bg-chess-surface rounded-xl p-3 border border-chess-border/30 text-left">
      <span className="text-lg" dangerouslySetInnerHTML={{ __html: icon }} />
      <div className="text-sm font-bold text-chess-text mt-1">{label}</div>
      <div className="text-[11px] text-gray-500">{desc}</div>
    </div>
  );
}

function JourneyStep({
  number,
  title,
  desc,
  status,
}: {
  number: number;
  title: string;
  desc: string;
  status: 'done' | 'active' | 'upcoming';
}) {
  return (
    <div className="flex gap-3 items-start">
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${
          status === 'done'
            ? 'bg-chess-accent text-chess-bg'
            : status === 'active'
              ? 'bg-chess-accent/20 text-chess-accent border-2 border-chess-accent'
              : 'bg-chess-muted text-gray-500'
        }`}
      >
        {status === 'done' ? '&#10003;' : number}
      </div>
      <div>
        <div
          className={`text-sm font-bold ${
            status === 'upcoming' ? 'text-gray-500' : 'text-chess-text'
          }`}
        >
          {title}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
      </div>
    </div>
  );
}
