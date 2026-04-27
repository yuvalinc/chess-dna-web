import { useState } from 'react';
import { trackEvent, Events } from '@/hooks/useAnalytics';
import { base44 } from '@/api/base44Client';

const { Feedback: FeedbackEntity } = base44.entities;

type Category = 'bug' | 'feature' | 'other';

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Category>('bug');
  const [message, setMessage] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);

  const resetForm = () => {
    setMessage('');
    setName('');
    setEmail('');
    setMobile('');
    setRating(0);
    setCategory('bug');
  };

  const handleSubmit = async () => {
    if (!message.trim()) return;
    setSending(true);

    const feedback = {
      name: name.trim() || undefined,
      email: email.trim() || undefined,
      mobile: mobile.trim() || undefined,
      category,
      message: message.trim(),
      rating: rating || undefined,
      page: window.location.pathname,
      userAgent: navigator.userAgent,
      submittedAt: Date.now(),
    };

    // 1) Persist to Base44 so it shows up in the admin /feedbacks inbox.
    try {
      await FeedbackEntity.create(feedback);
    } catch {
      // Fallback: save to localStorage if Base44 fails (guest users).
      try {
        const existing = JSON.parse(localStorage.getItem('chess-dna-feedback') ?? '[]');
        existing.push(feedback);
        localStorage.setItem('chess-dna-feedback', JSON.stringify(existing));
      } catch { /* noop */ }
    }

    // 2) Also fire an email notification so the support address gets it
    //    in real time (no need to remember to check the admin page).
    //    Wrapped — if SendEmail fails we don't surface that to the user.
    try {
      const subject = `[Chess DNA Feedback] ${category.toUpperCase()}${rating ? ` (${rating}\u2605)` : ''} — ${feedback.name ?? 'anonymous'}`;
      const body = [
        `Category: ${category}`,
        rating ? `Rating: ${'\u2605'.repeat(rating)}${'\u2606'.repeat(5 - rating)} (${rating}/5)` : null,
        feedback.name ? `Name: ${feedback.name}` : null,
        feedback.email ? `Email: ${feedback.email}` : null,
        feedback.mobile ? `Mobile: ${feedback.mobile}` : null,
        `Page: ${feedback.page}`,
        `User-Agent: ${feedback.userAgent}`,
        `Submitted: ${new Date(feedback.submittedAt).toISOString()}`,
        '',
        '— Message —',
        feedback.message,
      ].filter(Boolean).join('\n');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const integrations = base44.integrations as any;
      if (integrations?.Core?.SendEmail) {
        await integrations.Core.SendEmail({
          to: 'yuval.inc@gmail.com',
          subject,
          body,
        });
      }
    } catch (err) {
      console.warn('[Chess DNA] Feedback email notification failed:', err);
    }

    trackEvent(Events.FEEDBACK_SENT, { category });
    setSending(false);
    setSubmitted(true);
    setTimeout(() => {
      setOpen(false);
      setSubmitted(false);
      resetForm();
    }, 1500);
  };

  const starDisplay = hoverRating || rating;

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
          <div className="relative bg-chess-bg border border-chess-border/40 rounded-xl p-4 w-full max-w-sm shadow-2xl max-h-[90vh] overflow-y-auto">
            {submitted ? (
              <div className="text-center py-6">
                <div className="text-2xl mb-2">Thanks!</div>
                <div className="text-sm text-gray-400">Your feedback has been sent.</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-chess-text">
                    {name ? `Hi ${name}, what can you share with us?` : 'What can you share with us?'}
                  </h3>
                  <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-chess-text text-lg leading-none">&times;</button>
                </div>

                {/* Star rating */}
                <div className="flex items-center gap-0.5 mb-3">
                  <span className="text-[11px] text-gray-500 mr-1.5">Rate us:</span>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setRating(star)}
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(0)}
                      className="p-0.5 transition-transform hover:scale-110"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24"
                        fill={star <= starDisplay ? '#4ade80' : 'none'}
                        stroke={star <= starDisplay ? '#4ade80' : '#6b7280'}
                        strokeWidth="1.5"
                      >
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </button>
                  ))}
                </div>

                {/* Category pills */}
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

                {/* Message */}
                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  placeholder="Tell us what's on your mind..."
                  className="w-full bg-chess-surface border border-chess-border/30 rounded-lg px-3 py-2 text-sm text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50 resize-none h-20"
                  autoFocus
                />

                {/* Contact fields */}
                <div className="mt-2 space-y-1.5">
                  <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Name (optional)"
                    className="w-full bg-chess-surface border border-chess-border/30 rounded-lg px-3 py-1.5 text-sm text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50"
                  />
                  <div className="flex gap-1.5">
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="Email (optional)"
                      className="flex-1 bg-chess-surface border border-chess-border/30 rounded-lg px-3 py-1.5 text-sm text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50"
                    />
                    <input
                      type="tel"
                      value={mobile}
                      onChange={e => setMobile(e.target.value)}
                      placeholder="Mobile (optional)"
                      className="flex-1 bg-chess-surface border border-chess-border/30 rounded-lg px-3 py-1.5 text-sm text-chess-text placeholder:text-gray-500 focus:outline-none focus:border-chess-accent/50"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || sending}
                  className="mt-3 w-full bg-chess-accent text-chess-bg py-2 rounded-lg text-sm font-bold hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {sending ? 'Sending...' : 'Send Feedback'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
