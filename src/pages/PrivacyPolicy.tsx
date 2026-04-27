/**
 * Public Privacy Policy page — mounted at /privacy outside AuthGuard so
 * the App Store / Play Store reviewers (and anyone without an account)
 * can reach it without signing in.
 *
 * The content below covers every category required for GDPR / CCPA
 * compliance and for both Apple App Store and Google Play Store data
 * safety disclosures:
 *   - What we collect
 *   - Why we collect it
 *   - Who it's shared with
 *   - How long we keep it
 *   - How users can access / delete / export
 *   - Children, security, and jurisdiction-specific rights
 */
import { useMemo } from 'react';

const SUPPORT_EMAIL = 'yuval.inc@gmail.com';
const APP_NAME = 'Chess DNA';
const EFFECTIVE_DATE = 'April 18, 2026';

export default function PrivacyPolicy() {
  const today = useMemo(() => EFFECTIVE_DATE, []);
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

        <h1 style={h1}>Privacy Policy</h1>
        <p style={meta}>Last updated: <strong style={{ color: '#cbd5e1' }}>{today}</strong></p>

        <p style={p}>
          This Privacy Policy describes how {APP_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;)
          collects, uses, discloses, and protects your information when you use our
          web application and iOS/Android apps (together, the &ldquo;Service&rdquo;).
          By using the Service you agree to the terms described below.
        </p>

        {/* ── 1. Info we collect ── */}
        <h2 style={h2}>1. Information We Collect</h2>

        <h3 style={h3}>1.1 Information you provide directly</h3>
        <ul style={ul}>
          <li><strong>Account information.</strong> When you sign up we store your email address (or OAuth identity from Google / Apple / chess.com), a display name, and any preferences you configure.</li>
          <li><strong>Chess identifiers.</strong> Your chess.com or Lichess username, provided voluntarily to enable game imports.</li>
          <li><strong>Optional API keys.</strong> If you choose to supply your own Claude, OpenAI, or Gemini API keys for AI features, they are stored encrypted at rest and transmitted only to the provider whose key you supplied.</li>
          <li><strong>Feedback &amp; support correspondence.</strong> Bug reports, support emails, or content you submit through in-app forms.</li>
        </ul>

        <h3 style={h3}>1.2 Information imported from third-party chess services</h3>
        <ul style={ul}>
          <li><strong>Chess games.</strong> When you connect a chess.com or Lichess username, we fetch your public game history (PGNs, timestamps, opponents, ratings, outcomes) via their official public APIs. We never receive passwords for those services.</li>
          <li><strong>Public profile data.</strong> Public avatar URL and country from chess.com&apos;s public player endpoint, displayed in share cards.</li>
        </ul>

        <h3 style={h3}>1.3 Information collected automatically</h3>
        <ul style={ul}>
          <li><strong>Usage analytics.</strong> Aggregate token usage counters (inputs/outputs for AI features) used to show cost estimates. These are tied to your account but never shared with third parties for advertising.</li>
          <li><strong>Technical logs.</strong> Standard server logs (IP address, user-agent, timestamps) retained for a maximum of 30 days for debugging and abuse prevention, then deleted.</li>
          <li><strong>No advertising identifiers.</strong> We do not use IDFA, AAID, or any ad-tracking SDK.</li>
        </ul>

        {/* ── 2. How we use ── */}
        <h2 style={h2}>2. How We Use Your Information</h2>
        <ul style={ul}>
          <li>To provide the core Service: run Stockfish analysis on your games, compute your skill profile, detect weakness patterns, generate training plans.</li>
          <li>To send AI prompts to the provider of your choice (Claude, OpenAI, Gemini) when you use AI features like commentary or exercise generation.</li>
          <li>To synthesize audio game reviews when you request them.</li>
          <li>To respond to support requests.</li>
          <li>To improve the Service (aggregate, de-identified usage metrics only).</li>
        </ul>
        <p style={p}>
          We do <strong style={{ color: '#f87171' }}>not</strong> sell your personal data.
          We do <strong style={{ color: '#f87171' }}>not</strong> use it to target you with
          advertising.
        </p>

        {/* ── 3. Sharing ── */}
        <h2 style={h2}>3. When We Share Information</h2>
        <p style={p}>
          Your data is shared only with the following categories of service providers,
          and only to the extent necessary to deliver the feature you&apos;re using:
        </p>
        <ul style={ul}>
          <li><strong>Backend infrastructure.</strong> Base44 (our managed backend platform) stores your account, games, and analyses.</li>
          <li><strong>AI providers (optional).</strong> When you use AI features, the specific prompt is forwarded to the provider whose API key is active (Anthropic Claude, OpenAI, Google Gemini). Their data retention and training terms apply to those requests; we recommend using zero-retention API keys if possible.</li>
          <li><strong>Text-to-speech.</strong> OpenAI&apos;s TTS endpoint is used for audio game reviews. Only the generated script (no identifiers) is sent.</li>
          <li><strong>Chess game APIs.</strong> chess.com and Lichess public APIs receive only the username you entered.</li>
          <li><strong>Flag CDN.</strong> Your country flag (if shown on a share card) is fetched from flagcdn.com as a static PNG; no personal data is sent.</li>
          <li><strong>Legal compliance.</strong> We may disclose information if required by valid legal process (subpoena, court order) and only the minimum necessary.</li>
        </ul>

        {/* ── 4. Retention ── */}
        <h2 style={h2}>4. Data Retention</h2>
        <ul style={ul}>
          <li>Account and game data are retained as long as your account is active.</li>
          <li>If you delete your account (in-app: Settings &rarr; Danger Zone, or via the <a href="/data-access-request" style={link}>Data Access Request</a> form), all game, analysis, pattern, preference, and AI-generated records are permanently removed from our database.</li>
          <li>Server logs are rotated and deleted after 30 days.</li>
          <li>Backups are retained for up to 60 days before being overwritten.</li>
        </ul>

        {/* ── 5. Your rights ── */}
        <h2 style={h2}>5. Your Rights</h2>
        <p style={p}>
          Depending on your jurisdiction (EU/UK GDPR, California CCPA/CPRA, UK DPA,
          Brazil LGPD, and similar), you have the right to:
        </p>
        <ul style={ul}>
          <li><strong>Access</strong> the personal data we hold about you.</li>
          <li><strong>Correct</strong> inaccurate or incomplete data.</li>
          <li><strong>Delete</strong> your account and associated data.</li>
          <li><strong>Export (portability)</strong> a copy of your data in a machine-readable format.</li>
          <li><strong>Restrict or object to</strong> certain processing.</li>
          <li><strong>Withdraw consent</strong> at any time where processing is based on consent.</li>
          <li><strong>Lodge a complaint</strong> with your supervisory authority (e.g. your national data protection regulator).</li>
        </ul>
        <p style={p}>
          To exercise any of these rights, submit the <a href="/data-access-request" style={link}>Data Access Request form</a>
          {' '}or email us at <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>. We respond within 30 days.
        </p>

        {/* ── 6. Children ── */}
        <h2 style={h2}>6. Children&apos;s Privacy</h2>
        <p style={p}>
          {APP_NAME} is rated 4+ but the Service is not directed at children under 13.
          We do not knowingly collect personal information from children under 13 (or the
          equivalent minimum age in your jurisdiction). If you believe a child has
          provided us with personal data, please contact us and we will promptly delete it.
        </p>

        {/* ── 7. Security ── */}
        <h2 style={h2}>7. Security</h2>
        <ul style={ul}>
          <li>All data in transit is protected by TLS 1.2+ (HTTPS).</li>
          <li>Data at rest is encrypted by our backend provider (Base44).</li>
          <li>API keys supplied by you are stored encrypted and accessible only to your session.</li>
          <li>We use role-based access controls; only the operator (me) has admin access and only for debugging or support.</li>
          <li>No system is perfectly secure. If we become aware of a breach affecting your data, we will notify you within 72 hours where required by law.</li>
        </ul>

        {/* ── 8. International transfers ── */}
        <h2 style={h2}>8. International Data Transfers</h2>
        <p style={p}>
          Our infrastructure, AI providers, and TTS services operate in the United States
          and other jurisdictions. When you use the Service from outside those regions,
          your data is transferred under Standard Contractual Clauses (SCCs) or equivalent
          safeguards provided by the relevant provider.
        </p>

        {/* ── 9. Cookies ── */}
        <h2 style={h2}>9. Cookies &amp; Local Storage</h2>
        <p style={p}>
          {APP_NAME} uses <strong>only strictly necessary</strong> browser storage
          (localStorage and IndexedDB) to keep you signed in, remember your
          preferences, and cache audio sessions so they survive a page reload.
          We do not use third-party tracking cookies or advertising pixels.
        </p>

        {/* ── 10. Third-party content ── */}
        <h2 style={h2}>10. Third-Party Links &amp; Content</h2>
        <p style={p}>
          The Service may link to third-party websites (chess.com, Lichess, provider docs).
          We are not responsible for their privacy practices; please review their policies
          separately.
        </p>

        {/* ── 11. Changes ── */}
        <h2 style={h2}>11. Changes to This Policy</h2>
        <p style={p}>
          We may update this Privacy Policy occasionally. When we make material changes,
          we&apos;ll update the &ldquo;Last updated&rdquo; date above and, where required,
          notify active users by email or in-app banner before changes take effect.
        </p>

        {/* ── 12. Contact ── */}
        <h2 style={h2}>12. Contact</h2>
        <p style={p}>
          Questions or requests about this policy?
          <br />
          Email: <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>
          <br />
          Data request form: <a href="/data-access-request" style={link}>/data-access-request</a>
        </p>

        <p style={{ ...meta, marginTop: 48 }}>
          &copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.
        </p>
      </div>
    </div>
  );
}

/* ── Styles ──────────────────────────────────────────────────── */

const h1: React.CSSProperties = { fontSize: 34, fontWeight: 800, marginBottom: 6, color: '#fff' };
const h2: React.CSSProperties = { fontSize: 20, fontWeight: 700, marginTop: 40, marginBottom: 10, color: '#fff' };
const h3: React.CSSProperties = { fontSize: 15, fontWeight: 700, marginTop: 20, marginBottom: 6, color: '#cbd5e1' };
const p: React.CSSProperties = { fontSize: 14, color: '#94a3b8', lineHeight: 1.7, marginTop: 8 };
const ul: React.CSSProperties = { fontSize: 14, color: '#94a3b8', lineHeight: 1.7, paddingLeft: 22, marginTop: 8 };
const link: React.CSSProperties = { color: '#4ade80', textDecoration: 'underline' };
const meta: React.CSSProperties = { fontSize: 12, color: '#64748b' };
