/**
 * Public Data Access / Deletion Request page.
 *
 * Mounted OUTSIDE `AuthGuard` because:
 *   - Former users who've already deleted their account still need a way
 *     to reach us.
 *   - Google Play and Apple App Store reviewers will visit the URL without
 *     signing in.
 *
 * The form has no backend endpoint — submitting opens the user's mail
 * client with a pre-filled, structured request sent to the support email.
 * This is the simplest, most privacy-respecting way to accept such
 * requests without storing PII ourselves before consent is established.
 */
import { useMemo, useState } from 'react';

const SUPPORT_EMAIL = 'yuval.inc@gmail.com';

type RequestType = 'access' | 'deletion' | 'correction' | 'portability';

const REQUEST_TYPE_LABELS: Record<RequestType, string> = {
  access: 'Access my data (see everything you have about me)',
  deletion: 'Delete my account and all associated data',
  correction: 'Correct or update data about me',
  portability: 'Export my data in a portable format',
};

export default function DataAccessRequest() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [requestType, setRequestType] = useState<RequestType>('deletion');
  const [details, setDetails] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit =
    name.trim().length > 0 &&
    email.trim().length > 0 &&
    confirmed;

  const mailtoHref = useMemo(() => {
    const subject = `Chess DNA — ${REQUEST_TYPE_LABELS[requestType]}`;
    const body = [
      'Hi Chess DNA team,',
      '',
      `I'd like to submit the following request under applicable data protection laws (GDPR / CCPA / etc.):`,
      '',
      `Request type: ${REQUEST_TYPE_LABELS[requestType]}`,
      `Full name: ${name}`,
      `Account email: ${email}`,
      `Chess.com / Lichess username: ${username || '(not provided)'}`,
      '',
      'Additional details:',
      details || '(none)',
      '',
      'I confirm the information above is accurate and that I am the account owner or their legal representative.',
      '',
      'Thanks,',
      name,
    ].join('\n');
    return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }, [name, email, username, requestType, details]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    // Open the user's mail client with a pre-filled request.
    window.location.href = mailtoHref;
    setSubmitted(true);
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0f1a',
      color: '#e8edf5',
      padding: '40px 20px',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <a
          href="/"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            color: '#94a3b8', textDecoration: 'none', fontSize: 13,
            marginBottom: 24,
          }}
        >
          <span>&larr;</span> Chess DNA home
        </a>

        <h1 style={{
          fontSize: 32, fontWeight: 800, marginBottom: 8, color: '#fff',
        }}>Data Access &amp; Deletion Request</h1>

        <p style={{ fontSize: 15, color: '#94a3b8', lineHeight: 1.6, marginBottom: 24 }}>
          Chess DNA respects your right to access, correct, and delete the personal
          data we hold about you. Submit this form and we&apos;ll respond within
          <strong style={{ color: '#4ade80' }}> 30 days</strong>, in line with GDPR,
          CCPA, Apple App Store, and Google Play data protection requirements.
        </p>

        {/* Self-service deletion shortcut */}
        <div style={{
          background: 'rgba(74,222,128,0.08)',
          border: '1px solid rgba(74,222,128,0.25)',
          borderRadius: 12,
          padding: 16,
          marginBottom: 32,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#4ade80', marginBottom: 6 }}>
            Looking to delete your account right away?
          </div>
          <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, margin: 0 }}>
            You can delete your account instantly yourself in the app:
            <br />
            <strong>Settings &rarr; Danger Zone &rarr; Delete account &rarr; type &quot;DELETE&quot;</strong>.
            This removes every game, analysis, pattern, lesson, exercise, and
            preference from our servers immediately and signs you out.
          </p>
        </div>

        {submitted ? (
          <div style={{
            background: 'rgba(74,222,128,0.08)',
            border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 12,
            padding: 24,
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u2709\uFE0F'}</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>Your mail client should be open</h2>
            <p style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 16px' }}>
              Review the pre-filled email and hit Send. If nothing happened, you can
              email us directly at <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#4ade80' }}>{SUPPORT_EMAIL}</a>.
            </p>
            <button
              onClick={() => setSubmitted(false)}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#e8edf5', padding: '8px 16px', borderRadius: 8,
                fontSize: 13, cursor: 'pointer',
              }}
            >Submit another request</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <Field label="Full name *" required>
              <input
                type="text" required value={name}
                onChange={(e) => setName(e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="Account email *" required help="The email you used to sign up for Chess DNA.">
              <input
                type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="Chess.com / Lichess username" help="Optional, but helps us locate your account faster.">
              <input
                type="text" value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
              />
            </Field>

            <Field label="Request type *" required>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(Object.keys(REQUEST_TYPE_LABELS) as RequestType[]).map((t) => (
                  <label key={t} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: 10, borderRadius: 8, cursor: 'pointer',
                    background: requestType === t ? 'rgba(74,222,128,0.08)' : 'rgba(255,255,255,0.02)',
                    border: requestType === t ? '1px solid rgba(74,222,128,0.3)' : '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <input
                      type="radio" name="type" value={t}
                      checked={requestType === t}
                      onChange={() => setRequestType(t)}
                      style={{ marginTop: 2, accentColor: '#4ade80' }}
                    />
                    <span style={{ fontSize: 14, color: requestType === t ? '#fff' : '#cbd5e1' }}>
                      {REQUEST_TYPE_LABELS[t]}
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <Field label="Additional details (optional)">
              <textarea
                rows={5} value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Anything else we should know to process this request..."
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
              />
            </Field>

            <label style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: 12, borderRadius: 8,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              cursor: 'pointer', fontSize: 13, lineHeight: 1.5, color: '#cbd5e1',
            }}>
              <input
                type="checkbox" checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                style={{ marginTop: 2, accentColor: '#4ade80' }}
                required
              />
              <span>
                I confirm that I am the account owner (or their legal representative) and
                that the information above is accurate. I understand that fulfilling
                a deletion request is permanent and irreversible.
              </span>
            </label>

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                padding: '12px 24px', borderRadius: 10, border: 'none',
                background: canSubmit ? '#4ade80' : 'rgba(255,255,255,0.06)',
                color: canSubmit ? '#0a0f1a' : '#64748b',
                fontSize: 15, fontWeight: 700,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              Submit request
            </button>

            <p style={{ fontSize: 11, color: '#64748b', textAlign: 'center', marginTop: 4 }}>
              Submitting opens your email client with a pre-filled message to
              <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#94a3b8', marginLeft: 4 }}>{SUPPORT_EMAIL}</a>.
              Nothing is stored until you send the email.
            </p>
          </form>
        )}

        <hr style={{ margin: '40px 0', border: 'none', borderTop: '1px solid rgba(255,255,255,0.08)' }} />

        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>What happens next</h2>
        <ol style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, paddingLeft: 20 }}>
          <li>We acknowledge every request within <strong style={{ color: '#cbd5e1' }}>5 business days</strong>.</li>
          <li>We verify your identity via the email address on the account.</li>
          <li>
            For <strong>access</strong> or <strong>portability</strong> requests, we send
            you a JSON export of every record tied to your account (games, analyses,
            patterns, preferences).
          </li>
          <li>
            For <strong>deletion</strong> requests, we remove all your data from our
            systems and neutralize the auth record. A confirmation email is sent once
            complete.
          </li>
          <li>
            All requests are completed within <strong style={{ color: '#cbd5e1' }}>30 days</strong> of verification.
          </li>
        </ol>

        <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 32, marginBottom: 12 }}>What data we hold</h2>
        <ul style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.7, paddingLeft: 20 }}>
          <li>Chess games you imported from chess.com or Lichess (PGN + metadata).</li>
          <li>Stockfish analyses of those games (move-by-move evaluations).</li>
          <li>Computed skill patterns, snapshots, and insights.</li>
          <li>AI-generated lessons, exercises, training plans.</li>
          <li>Your in-app preferences (themes, API keys, language).</li>
          <li>Anonymous usage counters (token usage, admin analytics only).</li>
        </ul>

        <p style={{ fontSize: 12, color: '#64748b', marginTop: 32 }}>
          You can also email us directly at <a href={`mailto:${SUPPORT_EMAIL}`} style={{ color: '#94a3b8' }}>{SUPPORT_EMAIL}</a>
          {' '}with the subject line &ldquo;Data Access Request&rdquo; if you prefer not to use this form.
        </p>
      </div>
    </div>
  );
}

/* ── Helpers ──────────────────────────────────────────────────── */

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

function Field({ label, children, help, required }: { label: string; children: React.ReactNode; help?: string; required?: boolean }) {
  return (
    <div>
      <label style={{
        display: 'block', fontSize: 12, fontWeight: 600,
        color: required ? '#cbd5e1' : '#94a3b8',
        marginBottom: 6, letterSpacing: 0.3,
      }}>{label}</label>
      {children}
      {help && (
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{help}</div>
      )}
    </div>
  );
}
