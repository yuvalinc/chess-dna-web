# Chess DNA — iOS App Store Submission Package

> **Status**: ready to copy/paste into App Store Connect.
> Fields marked **[FILL IN]** need values that live outside the codebase (account credentials, phone numbers, etc.).
> Character limits are noted; each text field is within its limit.

---

## 1. Apple Developer Account (login credentials)

| Field | Value |
| --- | --- |
| Apple ID (email) | **[FILL IN]** |
| Password | **[FILL IN]** |
| Team name | **[FILL IN]** |
| Team ID (10 chars) | **[FILL IN]** |
| Two-factor device | **[FILL IN — e.g. iPhone registered to account]** |

> **Tip**: after purchase, store these in 1Password / Bitwarden — App Store Connect will 2FA-challenge every fresh session.

---

## 2. App Name (max 30 chars)

```
Chess DNA
```
*(9 chars)*

**Alternates if the above is taken:**
- `Chess DNA – Skill Decoder` *(25)*
- `Chess DNA: Analyze & Grow` *(25)*

---

## 3. Subtitle (max 30 chars)

```
Decode your chess strengths
```
*(27 chars)*

**Alternates:**
- `Your chess in 8 dimensions` *(26)*
- `AI-powered game analysis` *(24)*
- `See how you really play` *(23)*

---

## 4. Full Description (max 4000 chars)

```
Chess DNA turns every game you play into a deep, personal readout of how you actually think at the board.

Import your chess.com or Lichess games, hit Analyze, and watch Stockfish 17 dissect every move on-device. In seconds you'll see a full breakdown of your play — the move qualities, the turning points, the missed tactics, the time trouble, the endgames that slipped away.

WHAT MAKES CHESS DNA DIFFERENT

• 8-dimension skill radar — not a single blur-rating. Your play is scored across Openings, Tactics, Defense, Positional Play, Endgames, Calculation, Time Management, and Resilience, so you know exactly where you're strong and where to train.

• 6 rank tiers from Pawn to King — a progression system built around real chess metrics, not Elo guesswork. Watch yourself climb as the patterns in your games improve.

• Weakness patterns — the engine identifies the mistakes you repeat: missed forks, hanging pieces, back-rank blunders, shaky opening lines, endgame technique gaps. You get the specific cost (in centipawns lost) of each pattern across your whole game history.

• AI coach in your pocket — ask for plain-English explanations of why a move was bad, what the better idea was, and what to study next. Supports Claude, OpenAI, and Gemini; pick the voice that works for you.

• Audio game reviews — Chess DNA generates podcast-style audio commentary of your games using natural two-voice TTS. Listen to your own games analyzed while you walk or commute.

• Practice your mistakes — every blunder and missed tactic becomes a personalized puzzle. Stockfish validates that every exercise is sound, so you only train real positions you personally failed.

• Shareable moments — turn a checkmate, a brilliant move, or a full-game summary into a story-ready card or short video with animated move replay. Post directly to Instagram, WhatsApp, or X.

• Multiple board themes, dark/light mode, full RTL and multi-language support.

HOW IT WORKS

1. Connect your chess.com or Lichess username.
2. Your games sync automatically.
3. Hit Analyze — Stockfish runs depth-18 analysis right in your browser.
4. Explore the results: skill radar, phase accuracy, the exact moves that cost you rating.
5. Train the weaknesses, listen to the audio review, and share the highlights.

PRIVACY & CONTROL

Chess DNA does not sell your data. Your games are stored under your account and never shared with other users. You can export or permanently delete everything from the Danger Zone in Settings.

AI features are optional. Bring your own API keys, or use the shared pooled keys the app ships with for casual use.

WHO IT'S FOR

• Club and online players who want to get unstuck from a plateau.
• Tournament players looking for a data-driven training plan.
• Coaches who want to show students exactly which pattern keeps losing them games.
• Anyone curious to see the shape of their own chess — the strengths and the holes — laid out visually.

Chess DNA is free to try. No ads, no paywalls on the core analysis, no gimmicks. Just a serious tool for serious players.

Bring your games. We'll show you who you really are at the board.
```
*(≈ 3,150 chars — well under the 4,000 cap.)*

---

## 5. Privacy Policy URL

```
https://chess-dna-fdd5fbde.base44.app/privacy
```

> **Action required**: host a real privacy policy at that path before submitting.
> Apple rejects apps whose Privacy URL 404s or shows placeholder text.
> A minimal policy must cover:
> - What data you collect (chess games from chess.com / Lichess via the user's stated username; email from OAuth login).
> - Third-party processors (Base44, Anthropic, OpenAI, Google Gemini — only when AI features are used).
> - Data retention + deletion (reference the in-app Danger Zone → Delete account).
> - Children's data (13+ only, in line with Apple's age gate).
> - Contact email for privacy requests.

---

## 6. Category

- **Primary**: `Games` → Sub-category: `Board`
- **Secondary**: `Sports`

> Board is mandatory for any chess app; Sports picks up search traffic from the non-game-category crowd looking for training tools.

---

## 7. Price

```
Free
```

In-app purchases: **none at launch**. (Leave room to add Pro AI tier later without re-categorising.)

---

## 8. Keywords (max 100 chars, comma-separated)

```
chess,stockfish,analysis,coach,openings,tactics,endgame,puzzles,training,lichess,chess.com,ai
```
*(98 chars)*

> Apple splits on commas and ignores spaces in the count — don't add spaces after commas. Do not repeat words already in the title/subtitle; Apple indexes those separately.

**Backup keyword set if chess.com brand keyword is rejected:**
```
chess,stockfish,analysis,coach,openings,tactics,endgame,puzzles,training,lichess,blunder,ai
```

---

## 9. App Icon (1024×1024, no alpha, PNG)

Use the teal DNA-king asset already shipped as the web favicon:

- Source file: `/public/favicon.png` (in this repo)
- Required output: 1024×1024 PNG, sRGB, **no transparency**, **no rounded corners** (Apple applies the mask automatically), no text overlay.

> If the current PNG has any alpha or isn't exactly square, re-export via Preview: Tools → Adjust Size → 1024×1024, then File → Export → PNG, uncheck Alpha.

---

## 10. App Screenshots

Apple requires at minimum the **6.9" iPhone set** (1320 × 2868). Recommended to also submit 6.5" (1284 × 2778) and iPad 13" (2064 × 2752) if you ever want iPad review reach.

Suggested 6 screenshots + captions (each caption under 45 chars):

| # | Screen | Caption |
| --- | --- | --- |
| 1 | Overview / Score Hero with radar | `Your chess, decoded in 8 dimensions` |
| 2 | Recent Games list with quality chips | `Every game, every move — analyzed` |
| 3 | Game Detail with EvalBar + MoveList | `Stockfish 17 runs on your phone` |
| 4 | Patterns page | `See the mistakes you keep making` |
| 5 | Practice / Exercises | `Train the positions you failed` |
| 6 | Share card (Sequence mode, checkmate) | `Turn highlights into stories` |

**How to capture**:
1. Open the deployed app in iOS Simulator (iPhone 15 Pro Max — 6.7") or use a real iPhone 16 Pro.
2. Safari → Share → Save to Files for each screen.
3. Crop to 1320 × 2868 exactly (no status-bar chrome required but permitted).
4. Upload in App Store Connect → App Store tab → Screenshots.

---

## 11. Contact Information (shown on App Store + used for review contact)

| Field | Value |
| --- | --- |
| First name | **[FILL IN]** |
| Last name | **[FILL IN]** |
| Phone number | **[FILL IN — include country code, e.g. +972 …]** |
| Email | `yuval.inc@gmail.com` |

---

## 12. Available Countries

**Recommended launch set** (all available, English metadata covers them):

```
All 175 App Store territories — no restrictions.
```

If you prefer a phased rollout, start with:

```
United States, United Kingdom, Canada, Australia, Ireland, New Zealand,
Israel, Germany, Netherlands, France, Spain, Italy, Sweden, Norway,
Denmark, Finland, Brazil, Mexico, Argentina, Japan, South Korea, India
```

> Chess is truly global and the app has no geo-locked content, so "all territories" is the default unless legal/tax reasons narrow it.

---

## 13. Support URL

```
https://chess-dna-fdd5fbde.base44.app/support
```

> **Action required**: host a simple support page (can be a single static page with contact email and FAQ).
> A one-page support URL with `mailto:yuval.inc@gmail.com` + a short FAQ is acceptable.

Minimum content:
- How to connect your chess.com / Lichess username.
- What to do if analysis is stuck.
- How to delete your account (Settings → Danger Zone → Delete account).
- Contact email for bugs: `yuval.inc@gmail.com`.

---

## 14. Review Test Credentials (App Review only — **required** if the app gates content behind login)

Create a dedicated review account so Apple's reviewer can sign in without touching your real one:

| Field | Value |
| --- | --- |
| Username / Email | `apple-review@chess-dna.app` *(create via Base44)* |
| Password | **[FILL IN — strong, unique; store in App Store Connect]** |

**Notes field to include with the credentials** (copy into App Store Connect):

```
Chess DNA uses Base44 OAuth for sign-in — tap "Sign in" on the first screen
and use the credentials above. The review account already has 10 sample
chess.com games pre-imported so you can see the full Overview / Game Detail /
Patterns / Share flows without waiting for a sync.

To test the share composer: open any game → tap Share (top-right) → switch
between Game / Move / Sequence tabs.

To test account deletion: Settings tab → scroll to Danger Zone → type DELETE.
(Creates a fresh account on next login.)

No hardware features (camera, location, Bluetooth) are required for review.
```

---

## 15. App Review — Additional Notes

- **Third-party SDK disclosures**: Base44 SDK (backend), Anthropic Claude, OpenAI, Google Gemini, Stockfish 17 (WASM — open source, GPL-3).
- **Encryption**: uses HTTPS (TLS) only — declare "uses only standard encryption" on the export-compliance form (no ITSAppUsesNonExemptEncryption required beyond HTTPS).
- **Age rating**: 4+ (no user-generated content visible to other users, no chat, no gambling).
- **Sign in with Apple**: **required** if you offer any third-party login. Because we use Base44 OAuth as the sole login, Apple considers the app to have a single sign-in option — SIWA is not strictly required, but adding it is a common reviewer ask. Plan to add it in v1.1 if rejected.

---

## 16. What's New (used on every update; keep ≤ 4,000 chars)

For v1.0:

```
Hello, world! Chess DNA is live.
• Stockfish 17 analysis on every game you import
• 8-dimension skill radar + 6 rank tiers
• Weakness patterns with centipawn cost
• AI coach (Claude / GPT / Gemini) explains your moves
• Audio podcast-style game reviews
• Share game highlights as MP4 with move sounds
```

---

## Submission Checklist

- [ ] Apple Developer account active (paid $99/yr)
- [ ] App bundle ID registered in Apple Developer portal
- [ ] `AppIcon.png` (1024 × 1024, no alpha) uploaded
- [ ] 6 × 6.9" iPhone screenshots uploaded
- [ ] Privacy Policy live at public URL
- [ ] Support page live at public URL
- [ ] Review account created and tested end-to-end
- [ ] Export-compliance declaration filled (HTTPS-only → exempt)
- [ ] Age rating questionnaire completed (4+ expected)
- [ ] TestFlight internal build green before promoting to App Store
