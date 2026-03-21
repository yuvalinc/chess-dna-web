import { useState } from 'react';
import { trackEvent, Events } from '@/hooks/useAnalytics';

type Category = 'bug' | 'feature' | 'other';

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('bug');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = () => {
    if (!message.trim()) return;

    // Log feedback to localStorage for now (can be upgraded to API later)
    try {
      const feedback = {
        category,
        message: message.trim(),
        page: window.location.pathname,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
      };
      const existing = JSON.parse(localStorage.getItem('chess-dna-feedback') ?? '[]');
      existing.push(feedback);
      localStorage.setItem('chess-dna-feedback', JSON.stringify(existing));
    } catch { /* noop */ }

    trackEvent(Events.FEEDBACK_SENT, { category });
    setSubmitted(true);
    setTimeout(() => {
      setOpen(false);
      setSubmitted(false);
      setMessage('');
    }, 1500);
  };

  return (
    <>
      {/* Floating feedback tab — right edge, vertically centered */}
      <button
        onClick={() => setOpen(true)}
        className="fixed right-0 top-1/2 -translate-y-1/2 z-40 flex items-center gap-1 bg-chess-surface/90 border border-r-0 border-chess-border/30 rounded-l-lg pl-2 pr-1.5 py-2 shadow-lg text-gray-400 hover:text-chess-accent hover:border-chess-accent/30 transition-all"
        title="Send feedback"
        style={{ writingMode: 'vertical-rl', textOrientation: 'mixed' }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: 'rotate(90deg)' }}>
          <path d="M11 5H6a2 2 0 0 0-2 2v11l4-4h5a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z" />
          <path d="M15 7h2a2 2 0 0 1 2 2v3.34a2 2 0 0 1-.59 1.42l-4 4V14h-1" />
        </svg>
        <span className="text-[10px] font-medium tracking-wide">Feedback</span>
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative bg-chess-bg border border-chess-border/40 rounded-xl p-4 w-full max-w-sm shadow-2xl">
            {submitted ? (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">Thanks!</div>
                <div className="text-sm text-gray-400">Your feedback has been saved.</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-chess-text">Send Feedback</h3>
                  <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-chess-text text-lg">&times;</button>
                </div>

                <div className="flex gap-1.5 mb-3">
                  {(['bug', 'feature', 'other'] as Category[]).map(cat => (
                    <button
                      key={cat}
                      onClick={() => setCategory(cat)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all ${
                        category === cat
                          ? 'bg-chess-accent/20 text-chess-accent border border-chess-accent/40'
                          : 'bg-chess-surface text-gray-500 border border-chess-border/20 hover:border-chess-border/40'
                      }`}
                    >
                      {cat === 'bug' ? 'Bug' : cat === 'feature' ? 'Feature' : 'Other'}
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="What's on your mind?"
                  className="w-full bg-chess-surface border border-chess-border/30 rounded-lg px-3 py-2 text-sm text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50 resize-none h-24"
                  autoFocus
                />

                <button
                  onClick={handleSubmit}
                  disabled={!message.trim()}
                  className="mt-2 w-full bg-chess-accent text-chess-bg py-2 rounded-lg text-sm font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
