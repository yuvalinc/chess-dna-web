import type { WeaknessTheme } from './patterns';

export interface Insight {
  id: string;
  generatedAt: number;
  gameIds: string[];
  text: string;
  themes: WeaknessTheme[];
  priority: 'high' | 'medium' | 'low';
  isRead: boolean;
}

export interface LessonPosition {
  fen: string;
  description: string;
  correctMove: string;
  explanation: string;
  stockfishVerified?: boolean;
}

export interface Lesson {
  id: string;
  generatedAt: number;
  theme: WeaknessTheme;
  title: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  conceptExplanation: string;
  examplePositions: LessonPosition[];
  keyTakeaways: string[];
  isCompleted: boolean;
  stockfishVerified?: boolean;
}

export interface Exercise {
  id: string;
  generatedAt: number;
  theme: WeaknessTheme;
  fen: string;
  playerColor: 'white' | 'black';
  solution: string[];
  solutionSan: string[];
  hint: string;
  explanation: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  isCompleted: boolean;
  wasCorrect: boolean | null;
  attemptedAt: number | null;
  stockfishVerified?: boolean;
}
