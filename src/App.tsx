import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './components/ThemeContext';
import { I18nProvider } from './components/I18nProviderWrapper';
import { ChessDataProvider } from './contexts/ChessDataContext';
import { AudioPlayerProvider } from './contexts/AudioPlayerContext';
import { ToastProvider } from './components/Toast';
import ErrorBoundary from './components/ErrorBoundary';
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
import SkillStudio from './pages/SkillStudio';
import AffiliateAdmin from './pages/AffiliateAdmin';
import PromptsAdmin from './pages/PromptsAdmin';
import FeedbackAdmin from './pages/FeedbackAdmin';
import TimeMachine from './pages/TimeMachine';
import Compare from './pages/Compare';
import NavFlow from './pages/NavFlow';
import Graph from './pages/Graph';
// Public (no-auth) pages — required by App Store / Play Store policies.
import PrivacyPolicy from './pages/PrivacyPolicy';
import DataAccessRequest from './pages/DataAccessRequest';
import Support from './pages/Support';

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          {/* Public routes — reachable WITHOUT signing in, as required by
              Apple App Store / Google Play policies and GDPR-CCPA.
              Kept outside AuthProvider/AuthGuard so former users, App Store
              reviewers, and anyone without an account can access them. */}
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/data-access-request" element={<DataAccessRequest />} />
          <Route path="/support" element={<Support />} />

          {/* Everything else goes through the authenticated app shell. */}
          <Route path="*" element={
            <AuthProvider>
              <AuthGuard>
                <ThemeProvider>
                  <I18nProvider>
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
                              <Route path="/timemachine" element={<TimeMachine />} />
                              <Route path="/compare" element={<Compare />} />
                              <Route path="/settings" element={<Settings />} />
                              <Route path="/skill" element={<SkillStudio />} />
                              <Route path="/affiliate" element={<AffiliateAdmin />} />
                              <Route path="/prompts" element={<PromptsAdmin />} />
                              <Route path="/feedbacks" element={<FeedbackAdmin />} />
                              <Route path="/nav" element={<NavFlow />} />
                              <Route path="/graph" element={<Graph />} />
                              <Route path="*" element={<Navigate to="/" replace />} />
                            </Route>
                          </Routes>
                        </AudioPlayerProvider>
                      </ChessDataProvider>
                    </ToastProvider>
                  </I18nProvider>
                </ThemeProvider>
              </AuthGuard>
            </AuthProvider>
          } />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
