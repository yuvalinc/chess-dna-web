import { base44 } from '../api/base44Client';
import { useAuth } from '../contexts/AuthContext';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * AuthGuard: gates the app behind authentication.
 *
 * Uses `isAuthenticated` from AuthContext which checks for a Base44 JWT
 * token in localStorage. This is more reliable than `userId` (from auth.me())
 * because auth.me() hits /entities/User/me which returns 401 when the app
 * has no User entity — even though the session token is perfectly valid for
 * all entity CRUD operations.
 */
export default function AuthGuard({ children }: AuthGuardProps) {
  const isDev = import.meta.env.DEV;
  const { authResolved, isAuthenticated } = useAuth();

  // In dev mode, skip auth gate
  if (isDev) return <>{children}</>;

  // Still loading auth (waiting for auth.me() to complete or fail)
  if (!authResolved) {
    return (
      <div className="min-h-screen bg-chess-bg flex items-center justify-center" data-theme="dark">
        <div className="text-center">
          <div className="text-4xl mb-4 animate-spin-slow">🧬</div>
          <p className="text-chess-text-secondary text-sm">Loading Chess DNA...</p>
        </div>
      </div>
    );
  }

  // No token → not authenticated → landing page
  if (!isAuthenticated) {
    return <LandingPage />;
  }

  return <>{children}</>;
}

function LandingPage() {
  const handleLogin = () => {
    base44.auth.redirectToLogin(window.location.href);
  };

  return (
    <div className="min-h-screen bg-chess-bg text-chess-text flex flex-col" data-theme="dark">
      {/* Hero Section */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-lg text-center">
          <div className="text-6xl mb-6 animate-scale-in">🧬</div>
          <h1 className="text-4xl font-bold mb-3 animate-fade-in-up">
            Chess DNA
          </h1>
          <p className="text-chess-text-secondary text-lg mb-2 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
            Discover your unique playing patterns
          </p>
          <p className="text-chess-text-tertiary text-sm mb-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            AI-powered analysis of your chess.com games. Uncover weaknesses, get personalized lessons, and track your improvement.
          </p>

          <button
            onClick={handleLogin}
            className="bg-chess-accent text-chess-bg font-semibold px-8 py-3 rounded-xl text-lg hover:opacity-90 transition-all shadow-lg animate-fade-in-up"
            style={{ animationDelay: '0.3s' }}
          >
            Get Started
          </button>

          <div className="mt-12 grid grid-cols-3 gap-6 text-center animate-fade-in-up" style={{ animationDelay: '0.4s' }}>
            <div>
              <div className="text-2xl mb-1">📊</div>
              <p className="text-chess-text-tertiary text-xs">Weakness Patterns</p>
            </div>
            <div>
              <div className="text-2xl mb-1">🎓</div>
              <p className="text-chess-text-tertiary text-xs">AI Lessons</p>
            </div>
            <div>
              <div className="text-2xl mb-1">🎙️</div>
              <p className="text-chess-text-tertiary text-xs">Audio Analysis</p>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center text-chess-text-disabled text-xs py-4">
        Powered by Stockfish & AI · Built on Base44
      </footer>
    </div>
  );
}
