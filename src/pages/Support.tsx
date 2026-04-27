/**
 * Public Support / Contact page — mounted at /support outside AuthGuard
 * so Apple App Store and Google Play reviewers can reach it without
 * signing in (both require a publicly-accessible Support URL).
 *
 * Primary function: a simple contact form that opens the user's email
 * client with a pre-filled message to the support address. No backend
 * storage of PII before explicit consent is provided.
 */
import { useMemo, useState } from 'react';

const SUPPORT_EMAIL = 'yuval.inc@gmail.com';
const APP_NAME = 'Chess DNA';

/* Style constants are declared up-top because the FAQ array (below) uses
   `link` inside JSX. TypeScript doesn't like referencing block-scoped
   `const`s before their declaration at module-evaluation time. */
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  color: '#e8edf5',
  fontSize: 14,
  outline: 'none',
};

const h1: React.CSSProperties = { fontSize: 34, fontWeight: 800, marginBottom: 6, color: '#fff' };
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 32, marginBottom: 10, color: '#fff' };
const p: React.CSSProperties = { fontSize: 14, color: '#94a3b8', lineHeight: 1.7, marginTop: 8 };
const link: React.CSSProperties = { color: '#4ade80', textDecoration: 'underline' };

type Topic = 'bug' | 'feature' | 'account' | 'billing' | 'feedback' | 'other';

const TOPIC_LABELS: Record<Topic, string> = {
  bug: 'Bug report — something is broken',
  feature: 'Feature request / suggestion',
  account: 'Account help (login, import, data)',
  billing: 'API keys / AI provider setup',
  feedback: 'General feedback',
  other: 'Other',
};

const FAQ: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: 'How do I connect my chess.com or Lichess games?',
    a: (
      <>Open <strong>Settings &rarr; Chess.com / Lichess</strong> and enter your username.
      Games import automatically within a few seconds; hit <em>Analyze</em> on Recent Games
      to run Stockfish on each one.</>
    ),
  },
  {
    q: 'Analysis is stuck on &ldquo;Analyzing&hellip;&rdquo;. What do I do?',
    a: (
      <>Refresh the page — Stockfish runs in a web worker and sometimes needs a clean start.
      If a specific game keeps failing, open Game Detail and tap the re-analyze button, or
      email us with the game ID.</>
    ),
  },
  {
    q: 'How do I delete my account?',
    a: (
      <>In the app: <strong>Settings &rarr; Danger Zone &rarr; Delete account</strong> &rarr; type
      <code> DELETE</code>. All your games, analyses, patterns, and preferences are wiped
      immediately. You can also submit a formal request via the
      <a href="/data-access-request" style={link}> Data Access Request form</a>.</>
    ),
  },
  {
    q: 'My AI features don&apos;t work — why?',
    a: (
      <>AI features need an API key. Go to <strong>Settings &rarr; AI Providers</strong> and
      paste in a Claude, OpenAI, or Gemini key. The free pooled keys occasionally hit their
      daily limit; your personal key has your own quota.</>
    ),
  },
  {
    q: 'The shared Instagram video is silent / low quality.',
    a: (
      <>On some browsers the audio codec support for MP4 is limited and we produce a video-only
      MP4 to keep it Instagram-compatible. Use Chrome or Edge for the best result
      (audio + 1080p). You can always use <em>Download video</em> to get the higher-quality WebM
      with full move sounds.</>
    ),
  },
  {
    q: 'How is my data stored and who can see it?',
    a: (
      <>Your games and analyses live in our managed backend (Base44) under your account only.
      No other user can see them. See the full breakdown in the <a href="/privacy" style={link}>Privacy Policy</a>.</>
    ),
  },
];

export default function Support() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState<Topic>('bug');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const canSend = name.trim().length > 0 && email.trim().length > 0 && message.trim().length > 0;

  const mailtoHref = useMemo(() => {
    const subject = `${APP_NAME} support — ${TOPIC_LABELS[topic]}`;
    const body = [
      `From: ${name} <${email}>`,
      `Topic: ${TOPIC_LABELS[topic]}`,
      '',
      message,
      '',
      '---',
      `Sent from ${window.location.origin}/support`,
      `User agent: ${navigator.userAgent}`,
    ].join('\n');
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [name, email, topic, message]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    window.location.href = mailtoHref;
    setSent(true);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0f1a',
      color: '#e8edf5',
      padding: '40px 20px',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <a
          href="/"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            color: '#94a3b8', textDecoration: 'none', fontSize: 13,
            marginBottom: 24,
          }}
        >
          <span>&larr;</span> {APP_NAME} home
        </a>

        <h1 style={h1}>Support</h1>
        <p style={p}>
          Need help with {APP_NAME}? Check the FAQ below &mdash; if your question
          isn&apos;t answered, send us a message. We typically reply within 1&ndash;2
          business days.
        </p>

        {/* Direct-email card */}
        <div style={{
          background: 'rgba(74,222,128,0.08)',
          border: '1px solid rgba(74,222,128,0.25)',
          borderRadius: 12,
          padding: 16,
          marginTop: 24,
          marginBottom: 32,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', marginBottom: 4 }}>
            Prefer email directly?
          </div>
          <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
            Just write to <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>. Please
            include your account email and a brief description of the issue.
          </p>
        </div>

        {/* ── FAQ ── */}
        <h2 style={h2}>Frequently Asked Questions</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 40 }}>
          {FAQ.map((item, i) => (
            <details key={i} style={{
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10,
              padding: '12px 16px',
            }}>
              <summary style={{
                fontSize: 14, fontWeight: 600, color: '#e8edf5',
                cursor: 'pointer', listStyle: 'revert',
              }}>{item.q}</summary>
              <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, marginTop: 10 }}>
                {item.a}
              </div>
            </details>
          ))}
        </div>

        {/* ── Contact form ── */}
        <h2 style={h2}>Contact us</h2>

        {sent ? (
          <div style={{
            background: 'rgba(74,222,128,0.08)',
            border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
            marginTop: 12,
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u2709\uFE0F'}</div>
            <h3 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Your mail client should be open</h3>
            <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 16px' }}>
              Review the pre-filled email and hit Send. If nothing happened, write to
              {' '}<a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>.
            </p>
            <button
              onClick={() => setSent(false)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#e8edf5', padding: '8px 16px', borderRadius: 8,
                fontSize: 13, cursor: 'pointer',
              }}
            >Send another message</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
            <Field label="Your name *">
              <input type="text" required value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Your email *" help="So we can reply to you.">
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Topic *">
              <select value={topic} onChange={(e) => setTopic(e.target.value as Topic)} style={{ ...inputStyle, appearance: 'auto' }}>
                {(Object.keys(TOPIC_LABELS) as Topic[]).map((t) => (
                  <option key={t} value={t}>{TOPIC_LABELS[t]}</option>
                ))}
              </select>
            </Field>
            <Field label="Message *">
              <textarea
                required rows={6} value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe the issue, what you were doing when it happened, and any error messages..."
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </Field>

            <button
              type="submit" disabled={!canSend}
              style={{
                padding: '12px 24px', borderRadius: 10, border: 'none',
                background: canSend ? '#4ade80' : 'rgba(255,255,255,0.06)',
                color: canSend ? '#0a0f1a' : '#64748b',
                fontSize: 15, fontWeight: 700,
                cursor: canSend ? 'pointer' : 'not-allowed',
              }}
            >
              Send message
            </button>

            <p style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>
              Submitting opens your email client with a pre-filled message to
              {' '}<a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#94a3b8', marginLeft: 2 }}>{SUPPORT_EMAIL}</a>.
              Nothing is stored until you hit Send.
            </p>
          </form>
        )}

        {/* ── Footer links ── */}
        <hr style={{ margin: '48px 0 24px', border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 13 }}>
          <a href="/privacy" style={link}>Privacy Policy</a>
          <a href="/data-access-request" style={link}>Data Access Request</a>
          <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ─────────────────────────────────────────── */

function Field({ label, children, help }: { label: string; children: React.ReactNode; help?: string }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6, letterSpacing: 0.3 }}>
        {label}
      </label>
      {children}
      {help && <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{help}</div>}
    </div>
  );
}
