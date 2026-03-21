import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './components/ThemeContext';
import { ChessDataProvider } from './contexts/ChessDataContext';
import { AudioPlayerProvider } from './contexts/AudioPlayerContext';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
import FeedbackButton from './components/FeedbackButton';
import AuthGuard from './components/AuthGuard';
import AppShell from './components/AppShell';

import Overview from './pages/Overview';
import RecentGames from './pages/RecentGames';
import GameDetail from './pages/GameDetail';
import Patterns from './pages/Patterns';
import Lessons from './pages/Lessons';
import Exercises from './pages/Exercises';
import GettingBetter from './pages/GettingBetter';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
      <AuthProvider>
      <AuthGuard>
        <ThemeProvider>
        <ToastProvider>
        <ChessDataProvider>
        <AudioPlayerProvider>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Overview />} />
              <Route path="/games" element={<RecentGames />} />
              <Route path="/games/:gameId" element={<GameDetail />} />
              <Route path="/patterns" element={<Patterns />} />
              <Route path="/lessons" element={<Lessons />} />
              <Route path="/exercises" element={<Exercises />} />
              <Route path="/training" element={<GettingBetter />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
          <FeedbackButton />
        </AudioPlayerProvider>
        </ChessDataProvider>
        </ToastProvider>
        </ThemeProvider>
      </AuthGuard>
      </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
