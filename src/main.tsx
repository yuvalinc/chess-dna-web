import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Set default theme
document.documentElement.setAttribute('data-theme', 'dark');

// Global safety net. React's ErrorBoundary only catches render-phase
// errors — async failures (storage quota, Worker errors, fetch rejections,
// setTimeout callbacks) escape it and on iOS Safari can trigger a white
// screen by tearing down the page. Catching them here lets us log,
// suppress the default crash, and keep the app running.
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const msg = event.error?.message || event.message || '(no message)';
    console.error('[Chess DNA] window.error:', msg, event.error);
    // QuotaExceededError on iOS Safari is a known recoverable condition
    // — pattern-snapshot writes are already wrapped, but other call sites
    // (TutorialContext, FriendCompare, etc.) may still hit it.
    if (msg.toLowerCase().includes('quota')) {
      event.preventDefault();
    }
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[Chess DNA] unhandledrejection:', msg, reason);
    // Storage-quota rejections shouldn't crash the page.
    if (msg.toLowerCase().includes('quota')) {
      event.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
