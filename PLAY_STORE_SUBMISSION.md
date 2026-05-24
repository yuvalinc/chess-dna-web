# Chess DNA — Google Play Store Submission Package

> **Status**: ready to copy/paste into Google Play Console.
> Fields marked **[FILL IN]** need values that live outside the codebase (account credentials, signing keys, etc.).
> Character limits are noted; each text field is within its limit.
> Play Store rules differ meaningfully from Apple's — read §8 (no keywords field), §9 (icon has alpha, unlike iOS), §10 (feature graphic is mandatory), §17 (Data Safety form), and §18 (you must ship an AAB, not a URL).

---

## 0. Current state (verified 2026-05-13)

Console URL: https://play.google.com/console/u/0/developers/9167056806914618264/account

### Play Console
| Item | Status |
| --- | --- |
| Developer account paid + provisioned | ✅ `yuval.inc@gmail.com` — Personal account "Yuval Incze" (ID 9167056806914618264, Israel) |
| Public developer name | ✅ `Yuval Incze` (consider changing to `Chess DNA` before listing goes live) |
| Existing apps in console | 1 — `One Word Trap` (`com.base693c5001d8ca11e0f5d21989.app`), Draft / Internal testing, **AAB 2.115978.0 uploaded by Base44 on 2026-02-03** |
| ID-document verification | ⛔ **pending — blocks everything below** |
| Contact phone verification | ⛔ pending (gated on ID verification) |
| Android device verification (install Play Console app on phone) | ⛔ pending |
| "Create app" button | ⛔ disabled — `Complete account verifications to create new apps` |
| Chess DNA app entry in console | ⛔ does not exist yet |

### Public URLs Play Console requires
| URL | Status | Renders |
| --- | --- | --- |
| `https://chess-dna-fdd5fbde.base44.app/privacy` | ✅ live | [PrivacyPolicy.tsx](src/pages/PrivacyPolicy.tsx) — full policy, last updated 2026-04-18 |
| `https://chess-dna-fdd5fbde.base44.app/support` | ✅ live | [Support.tsx](src/pages/Support.tsx) — FAQ + contact form + email |
| `https://chess-dna-fdd5fbde.base44.app/data-access-request` | ✅ live | [DataAccessRequest.tsx](src/pages/DataAccessRequest.tsx) — public, default request type = "Delete my account". **Use this URL for Play's "Account Deletion" field** (Play accepts any URL that lets users request deletion without re-installing the app). |

### Store-listing assets
| Asset | Status |
| --- | --- |
| 512 × 512 icon | ✅ designer-finished asset received (more polished than the favicon export — teal stroke border, embossed king+helix, dramatic highlights). Save as `play-store-assets/icon-512.png` (will replace the favicon-derived placeholder). |
| Adaptive icon foreground/background | Bundled inside the AAB by Base44 — no manual upload needed |
| Feature graphic (1024 × 500) | ⛔ not yet provided — needs designer (the homemade HTML draft was discarded). |
| Phone screenshots ×5 (portrait, designer-finished) | ✅ all 5 received: hero, Patterns/Replays, Replay flow, Analyze, Skill Radar. Save as `play-store-assets/screenshot-1-hero.png` etc. — captions baked into the images already. |

### What the "One Word Trap" AAB proves + Base44 Mobile-app flow (verified 2026-05-13)

Base44 has a **first-class Play Store packaging pipeline**, surfaced in the no-code editor: top-right **Publish** button → **Mobile app** tab → 3 steps (Check, Build, Submit). Step 2 produces a downloadable `.aab` for Play Console — exactly the path that produced One Word Trap's signed bundle (`2.115978.0`, "Active", Play App Signing).

### ⚠️ But — verified that ChessDNA does NOT currently expose this flow

When I navigated to ChessDNA at `https://app.base44.com/apps/69a04516fd2be6e9fdd5fbde/editor/preview/` the page renders the **Dashboard view only**: no Preview/Dashboard tabs, no GitHub icon, **no Publish button**. The Publish→Mobile-app panel is unreachable from ChessDNA's UI in its current state. One Word Trap (a pure no-code Base44 app) shows the full editor chrome and the Publish flow. ChessDNA does not.

**Most likely explanation**: ChessDNA is **code-managed** — the codebase is owned by the developer (`/Users/yuval/Chess-dna`), built locally (`npm run build`), and deployed via `npx base44 site deploy`. Base44's no-code editor is bypassed, so the Publish button (which builds from the no-code state) is hidden. The Mobile-app pipeline expects Base44 to be the source of truth.

**Concrete next step**: ask Base44 support whether the Publish → Mobile app flow can be enabled for a code-managed app (or whether they can run it server-side from a git push). Two outcomes:

1. **Best case** — Base44 can produce an `.aab` for ChessDNA's code-managed source. You get a Play-ready AAB without any additional engineering. §18 describes the manual upload to Play Console once you have it.
2. **Fallback** — Base44 can't ship code-managed apps to Play. You wrap the `dist/` output in Capacitor yourself. The git history of this file has the full Capacitor + TWA fallback instructions; restore them if needed.

This is now the single biggest unknown before submission. Everything else (verifications, store-listing copy, assets, public URLs) is unblocked.

---

## 1. Google Play Developer Account (login credentials)

| Field | Value |
| --- | --- |
| Google account (email) | `yuval.inc@gmail.com` (verified) |
| Developer name (public, shown on store listing) | currently `Yuval Incze` — change to `Chess DNA` in Developer account settings |
| Developer account type | Personal |
| Developer account ID | `9167056806914618264` |
| Legal address | `Bar kochva 35, Tel aviv 8, Tel aviv 6500091, Israel` |
| Contact phone (private, used by Google only) | `+972545507207` (entered, not yet verified) |
| Website | `https://chessdna.app/` |
| Two-factor device | **[FILL IN — Google Authenticator / hardware key]** |

> **Cost**: one-time **$25 USD** already paid — account is active.
> **Verification status**: 2 of 3 blockers still outstanding (see §0). Until they're cleared, the "Create app" button is greyed out and no Chess DNA listing can be started.

---

## 2. App Name (max 30 chars)

```
Chess DNA
```
*(9 chars)*

**Alternates if the above is taken:**
- `Chess DNA – Skill Decoder` *(25)*
- `Chess DNA: Analyze & Grow` *(25)*

> Play Store forbids ranking words ("#1", "Best"), pricing language ("Free"), and emojis in the title. The alternates above are clean.

---

## 3. Short Description (max 80 chars)

```
Decode your chess strengths across 8 dimensions with Stockfish 17 analysis.
```
*(75 chars)*

**Alternates:**
- `AI-powered chess analysis. Stockfish 17 on your phone. See how you play.` *(72)*
- `Your chess in 8 dimensions — radar, patterns, audio reviews, AI coach.` *(70)*
- `Decode your chess. 8-dim skill radar, weakness patterns, AI explanations.` *(73)*

> The short description is what users see first on the listing card — it's load-bearing for click-through. Keep keywords ("chess", "Stockfish", "analysis") near the front.

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
3. Hit Analyze — Stockfish runs depth-18 analysis right on your device.
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

> Play Store **does** index the full description for search (unlike Apple, which only indexes title/subtitle/keywords). Lead with high-intent terms — "chess analysis", "Stockfish", "chess coach", "Lichess", "chess.com" — in the first 167 characters.

---

## 5. Privacy Policy URL

```
https://chess-dna-fdd5fbde.base44.app/privacy
```

> ✅ **Already live** ([PrivacyPolicy.tsx](src/pages/PrivacyPolicy.tsx), last updated 2026-04-18). Verified to render on production.
> Google rejects apps whose Privacy URL 404s, redirects to a homepage, or shows placeholder text — ours is real content.
> A minimal policy must cover:
> - What data you collect (chess games from chess.com / Lichess via the user's stated username; email from OAuth login).
> - Third-party processors (Base44, Anthropic, OpenAI, Google Gemini — only when AI features are used).
> - Data retention + deletion (reference the in-app Danger Zone → Delete account, plus the Account Deletion URL in §15 below).
> - Children's data (13+ only; Play requires a separate Designed-for-Families opt-in if you want under-13 distribution — we are **not** opting in).
> - Contact email for privacy requests.

---

## 6. Category

- **App category**: `Games`
- **Sub-category**: `Board`
- **Tags** (up to 5, picked from Google's controlled list): `Chess`, `Strategy`, `Brain`, `Training`, `Single player`

> Sub-category `Board` is mandatory for any chess app. Tags are a Play-specific feature — they are not free-text like Apple keywords; you pick from a fixed list during the Store Listing step.

---

## 7. Price

```
Free
```

In-app products: **none at launch**.

> If you later add a Pro AI tier you'll need to set up Google Play Billing (the only billing system Play allows for digital goods) and re-submit the data-safety form. Leave the "Contains ads" toggle **off** — Chess DNA shows no ads.

---

## 8. Discovery / Indexing (Play Store has no keywords field)

Play Store does **not** have a separate keywords field. Search ranking is driven by:

1. **App title** (highest weight) — "Chess DNA" already contains the head term.
2. **Short description** (high weight) — front-loaded with "chess", "Stockfish", "analysis" above.
3. **Full description** (medium weight) — keyword density of 1–3 % is ideal; over-stuffing is penalized.
4. **Backlinks + install velocity** (external) — out of scope here.

**Target query set** (the searches we should rank for):
```
chess analysis, chess coach, stockfish, chess training, chess.com analysis,
lichess analysis, chess puzzles, blunder check, chess ai, chess endgame
```

> All of these terms appear naturally in the full description above. Do **not** add a "Keywords:" line at the end of the description — Google explicitly flags that as keyword stuffing and may reject.

---

## 9. App Icon (512 × 512, PNG, with alpha)

| Spec | Value |
| --- | --- |
| Dimensions | **512 × 512 px exactly** |
| Format | 32-bit PNG |
| Alpha | **Allowed** (unlike Apple — Play uses alpha for adaptive icons) |
| Max file size | 1 MB |
| Color space | sRGB |
| Rounded corners | **Do not pre-round** — Play applies the mask |

Designer-finished icon received (more refined than the favicon export): teal stroke border, embossed king + DNA helix in mint green on a deep navy background, dramatic glow + drop shadow.

- **Upload-ready file**: [play-store-assets/icon-512.png](play-store-assets/icon-512.png) — replace the existing 512×512 favicon-derived file with the designer asset.
- **Compatibility check**: should be saved as 512 × 512 sRGB PNG with alpha. Inset roughly 8 % from edge so Play's mask doesn't clip the brand stroke.

### Adaptive icon (strongly recommended)

For modern Android (8.0+) Play encourages **adaptive icons** — two separate layers that the launcher composes:

| Layer | Spec | Purpose |
| --- | --- | --- |
| Foreground | 432 × 432 PNG, transparent bg, logo centered in safe zone of 264 × 264 | The DNA-king mark |
| Background | 432 × 432 PNG, solid color or simple pattern | The teal brand background |

> These are bundled inside the AAB at `res/mipmap-anydpi-v26/ic_launcher.xml` — not uploaded to the Play Console. The 512×512 icon **is** uploaded separately.

---

## 10. Feature Graphic (1024 × 500, mandatory)

| Spec | Value |
| --- | --- |
| Dimensions | **1024 × 500 px exactly** |
| Format | JPEG or 24-bit PNG (no alpha) |
| Max file size | 1 MB |

> **Apple has no equivalent — this is Play-specific.** The feature graphic is the wide banner at the top of your store listing. It's also used as the autoplay thumbnail for the promo video if you have one.
>
> **Design rules:**
> - **Do not** rely on text — Play crops the graphic for tablets and the text often gets clipped.
> - Lead with the brand mark + a single hero image (e.g., the 8-dimension radar against the teal background).
> - Same teal as the icon, so the listing reads as one brand.

**Suggested composition**: DNA-king mark on the left third, the 8-dim radar in the center, "Chess DNA" wordmark in small type bottom-right — text small enough to survive tablet crop.

---

## 11. App Screenshots

Play requires at minimum **2 phone screenshots**. Up to **8** per device class. Recommended sets:

| Device class | Dimensions (px) | Required? |
| --- | --- | --- |
| Phone | 1080 × 1920 or 1080 × 2400 (9:16 or 9:19.5) | **Yes** (min 2, recommended 6–8) |
| 7" tablet | 1200 × 1920 | Optional |
| 10" tablet | 1920 × 1200 or 2560 × 1600 | Optional (improves tablet ranking) |

**Verified designer-finished set (5 of 8 max)** — all portrait, brand teal + black, with the Chess DNA icon + wordmark baked into the top-left of each. Captions are already overlaid in the image, so no extra Play Console caption field is needed.

| # | Filename | Subject | Headline overlay |
| --- | --- | --- | --- |
| 1 | `screenshot-1-hero.png` | DNA-helix-king render with sweeping particle effects | `Understand. Improve. Dominate.` |
| 2 | `screenshot-2-patterns.png` | Replays / patterns screen — "Your Worst Pattern: Start with Missed Tactic", impact ranking | `Find Patterns. Fix Weaknesses.` |
| 3 | `screenshot-3-replay.png` | Replay flow — board mid-replay, "Find a better move" prompt, Hint/Skip controls | `Replay. Learn. Get Better.` |
| 4 | `screenshot-4-analyze.png` | Analyze screen — board with eval arrows, mistake explanation, Stats/Key-Moments/Patterns tabs | `Instant Game Analysis` |
| 5 | `screenshot-5-radar.png` | Skill Radar — 8-dimension chart with dimension scores, ELO + tier line, "What we did together" recap | `Your 8-Dimension Skill Radar` |

**Where they belong**: `play-store-assets/` (alongside `icon-512.png`).

**Play Console upload**: Main store listing → Phone screenshots → drag-drop these 5. Minimum is 2; we're at 5, which is healthy.

> If a 6th + 7th + 8th screenshot get produced later, candidates are: AI-coach conversation, audio-podcast playback, share-card composer.
>
> **Note**: Play requires Android screenshots (no iOS notch / Dynamic Island visible). These designer-finished compositions show app UI mocks framed inside an Android phone bezel — clean, no iOS artefacts. Good.

---

## 12. Contact Information (shown on the listing, used for Play review contact)

| Field | Value |
| --- | --- |
| Developer name (public) | `Chess DNA` |
| Contact email (public, required) | `yuval.inc@gmail.com` |
| Contact phone (public, **optional** — leave blank if you don't want it shown) | **[FILL IN OR LEAVE BLANK]** |
| Website (public) | `https://chess-dna-fdd5fbde.base44.app` |
| Physical address (required for paid apps or apps with in-app purchases; optional for free apps) | **[FILL IN if applicable]** |

> Unlike Apple, Play does **not** require a phone number for free apps. The email **is** required and **is** publicly displayed — use a dedicated alias (e.g., `support@chess-dna.app`) if you want to keep your personal gmail off the listing.

---

## 13. Available Countries

**Recommended launch set** (all available, English metadata covers them):
```
All Play Store territories — no restrictions.
```

If you prefer a phased rollout, start with:
```
United States, United Kingdom, Canada, Australia, Ireland, New Zealand,
Israel, Germany, Netherlands, France, Spain, Italy, Sweden, Norway,
Denmark, Finland, Brazil, Mexico, Argentina, Japan, South Korea, India
```

> Chess is global and the app has no geo-locked content. Note that Play has stricter country-specific tax / compliance flows than Apple — for paid apps you must complete tax forms per country. For a free app with no IAP, "all countries" has no extra paperwork.
> **Excluded by default**: countries on US OFAC list (Iran, North Korea, Syria, Cuba, etc.) — Play handles this automatically.

---

## 14. Support URL

```
https://chess-dna-fdd5fbde.base44.app/support
```

> ✅ **Already live** ([Support.tsx](src/pages/Support.tsx)). Has FAQ entries covering chess.com/Lichess connect, stuck analysis, account deletion via Settings → Danger Zone, and a contact form that opens email to `yuval.inc@gmail.com`. Same URL works for both iOS and Play submissions.

---

## 15. Account Deletion URL (Play Store **required** since 2023-12)

```
https://chess-dna-fdd5fbde.base44.app/data-access-request
```

> ✅ **Already live** ([DataAccessRequest.tsx](src/pages/DataAccessRequest.tsx)). The page is public (no login required), defaults to request type "Delete my account and all associated data", explains what gets wiped, shows the in-app self-service path (Settings → Danger Zone), and contact email. Satisfies Play's deletion-URL requirement without needing a separate `/account-deletion` route.
>
> Configure in Play Console → Policy → App content → Data deletion → enter this URL.

---

## 16. Review Test Credentials (Play Console "App access" — **required** if any feature is gated behind login)

Create a dedicated review account so Google's reviewer can sign in without touching your real one:

| Field | Value |
| --- | --- |
| Username / Email | `play-review@chess-dna.app` *(create via Base44)* |
| Password | **[FILL IN — strong, unique; store in Play Console "App access"]** |
| Login type | Base44 OAuth (tap "Sign in" on the first screen) |

**Instructions field to include with the credentials** (copy into Play Console → App access):

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
Network connection is required for the initial game sync; analysis runs on-device.
```

---

## 17. Data Safety Form (Play-specific — replaces Apple's privacy nutrition labels)

> The Data Safety form is filled out in Play Console → App content → Data safety. It is shown to users on the listing page **before they install**. Lying on this form is a top-3 cause of Play removal — be conservative and truthful.

### Section A: Data collection and security

| Question | Answer | Rationale |
| --- | --- | --- |
| Does your app collect or share any of the required user data types? | **Yes** | OAuth email + chess games. |
| Is all of the user data collected by your app encrypted in transit? | **Yes** | HTTPS only. |
| Do you provide a way for users to request that their data be deleted? | **Yes** | Settings → Danger Zone → Delete account, plus the Account Deletion URL in §15. |

### Section B: Data types collected

| Data type | Collected? | Shared with third parties? | Optional or required? | Purpose |
| --- | --- | --- | --- | --- |
| **Personal info → Email address** | Yes | No | Required | Account management, sign-in |
| **Personal info → Name** | No | — | — | — |
| **App activity → App interactions** | Yes | No | Required | Analytics (errors, feature usage) |
| **App activity → In-app search history** | No | — | — | — |
| **App info & performance → Crash logs** | Yes | No | Optional | Error reporting |
| **App info & performance → Diagnostics** | Yes | No | Optional | Performance monitoring |
| **Files & docs** | No | — | — | — |
| **Photos & videos** | No | — | — | — |
| **Audio** | No | — | — | — |
| **Location (precise / approximate)** | No | — | — | — |
| **Web browsing history** | No | — | — | — |
| **Contacts** | No | — | — | — |
| **Messages** | No | — | — | — |
| **Financial info** | No | — | — | — |
| **Health & fitness** | No | — | — | — |
| **Device or other IDs** | No | — | — | — |
| **Other → Chess game records (PGN)** | Yes | **Yes** (to AI providers only when user invokes AI features) | Optional | The core product — user explicitly imports their own games. AI explanation is opt-in. |

### Section C: Data sharing disclosure

For the **chess game records** row above, the third parties are:
- **Anthropic (Claude)** — only when user invokes AI explanation; only the relevant PGN excerpt is sent.
- **OpenAI** — same as above.
- **Google (Gemini)** — same as above.
- **Base44** — the backend processor (not a sharing relationship — they are a data processor under contract).

> Disclose Anthropic / OpenAI / Google as third-party processors in §5 (Privacy Policy) too. The Data Safety form and the policy must agree — Google's review bot cross-checks them.

---

## 18. Get the Android App Bundle (AAB)

> **Verified end-to-end on a no-code Base44 app** (One Word Trap) on 2026-05-13. **Not yet verified for ChessDNA** — see §0's "ChessDNA does NOT currently expose this flow" caveat. Read that first; this section assumes Base44 can be coaxed into running its Mobile-app flow against the code-managed Chess DNA source.

### The Mobile-app panel — 3 steps

Base44 editor → **Publish** (top-right) → **Mobile app** tab. You'll see three sections:

| # | Section | What it does |
| --- | --- | --- |
| 1 | **Check Your App** | Pre-flight scanner. Click **Run App Scan** to validate the bundle against the latest App Store and Play Store guidelines (icon dimensions, permission declarations, metadata, etc.). Fix any issues it surfaces before building. |
| 2 | **Build Stores Files** | Produces two downloadable artifacts: **App Store files** (for App Store Connect) and **Google Play files** (the `.aab` for Play Console). Click the **Download** button next to Google Play files to get the AAB. |
| 3 | **Submit Your App** | Links to Base44's step-by-step submission guide for App Store + Play. |

That's the full pipeline. Base44 handles signing (Play App Signing — Google holds the app-signing key, Base44's pipeline holds the upload key), adaptive icons, version coding. You don't touch Capacitor, Bubblewrap, keytool, or Android Studio.

### Per-release flow

1. Make sure the latest Chess DNA code is published to Base44's Web (so the Mobile build uses the current code).
2. Open the Base44 editor → **Publish** → **Mobile app**.
3. Click **Run App Scan** (step 1). Fix anything it flags.
4. Click **Download** next to **Google Play files** (step 2). You'll get an `.aab` file.
5. In Play Console (assumes account verifications cleared and the Chess DNA app entry exists — see §0):
   - **Test and release → Internal testing → Create new release**
   - Drag the `.aab` into the upload area
   - Add release notes (see §20)
   - **Save → Review → Start rollout to Internal testing**
6. Google runs an automated build check (~minutes). Fix any rejections.
7. Once Internal is green, promote to **Closed testing** with ≥ 12 testers / ≥ 14 days.
8. Apply for **Production access** and submit.

### Verified-from-One-Word-Trap details

- **One Word Trap's AAB**: version code `1`, version name `2.115978.0` (Base44 auto-generates this build-counter style), File type `App bundle`, Release status `Active`. Same shape Chess DNA will produce.
- **Signing**: `Signing by Google Play` — Play App Signing is enrolled. Google holds the app-signing key, Base44 holds the upload key. You never see a keystore.
- **Package ID format**: `com.base<APP_ID>.app` (One Word Trap's was `com.base693c5001d8ca11e0f5d21989.app`). Chess DNA's Base44 app ID is `69a04516fd2be6e9fdd5fbde`, so its package will likely be `com.base69a04516fd2be6e9fdd5fbde.app`. **If you want a vanity package like `app.chessdna`**, ask Base44 support — the auto-generated ID locks once published.

### Open questions for Base44 support (only if you hit a wall)

1. Can the auto-generated package name be overridden to `app.chessdna` (or similar) **before first publish**? (Once published you can't change it under the same listing.)
2. Does the **App Scan** step (1) actually catch Play-rejection causes (target SDK, manifest issues), or just lint?
3. What is the version-code increment policy? (Suspect it auto-increments off a global counter; that's fine.)

### Where the Play Console fields connect to Base44 metadata

| Play Console field | Source in Base44 |
| --- | --- |
| App icon | Base44 editor → app logo (currently set — verified on ChessDNA dashboard) |
| App description | Base44 editor → app description (already says: *"Understand your strengths and weaknesses, spot recurring patterns, and practice the positions where you struggle most."*) — note: this is the Base44 *internal* description, NOT the Play listing description. The Play listing fields in §2–§4 of this doc are what you copy/paste into Play Console manually. |
| Custom domain (Play listing "Website") | `chessdna.app` (Verified in Base44 → Domains) |

### Target SDK on submission day

Google enforces a minimum target SDK version that rises ~yearly. Verify against [developer.android.com/google/play/requirements/target-sdk](https://developer.android.com/google/play/requirements/target-sdk) before downloading the AAB. If Base44's build targets an older API than the current floor, contact Base44 support and ask them to update their build target before you download.

### Fallback if Base44's Mobile-app flow fails for Chess DNA

If the App Scan blocks or the AAB download fails, the previous Capacitor / TWA paths (in this file's git history) are the fallback. But based on the verified One Word Trap output, the Base44 pipeline is production-grade for Play Store delivery — no reason to expect it to fail for Chess DNA.

---

## 19. App Review — Additional Notes

- **Third-party SDK disclosures** (Play Console → App content → SDK index, auto-populated from the AAB): Base44 SDK, Anthropic Claude (HTTPS), OpenAI (HTTPS), Google Gemini (HTTPS), Stockfish 17 (WASM, GPL-3 — bundled, not a SDK).
- **Encryption**: HTTPS / TLS only. Declare "uses only standard encryption" — no US export-compliance forms required for Play (this is Apple-only).
- **Content rating (IARC questionnaire)**: answer **No** to all violence / gambling / user-generated-content questions. Expected result: **Everyone** (the Play equivalent of Apple's 4+).
- **News apps / Government apps / Health apps**: N/A — Chess DNA is none of these.
- **Ads**: **No ads.** Set "Contains ads" → **No**.
- **Target audience and content**: select **13 and older**. Do **not** opt into Designed-for-Families — that program adds COPPA obligations we don't need.
- **Sign in with Google**: not required by Play, but recommended in a future version. Apple's SIWA rule has no Play equivalent.

---

## 20. What's New (release notes, max 500 chars per locale — short!)

For v1.0:

```
Hello, world! Chess DNA is live.
• Stockfish 17 analysis on every game
• 8-dimension skill radar + 6 rank tiers
• Weakness patterns with centipawn cost
• AI coach (Claude / GPT / Gemini)
• Audio podcast-style game reviews
• Share game highlights as MP4
```
*(255 chars)*

> Play's release-notes cap is **500 chars** — significantly tighter than Apple's 4000. Keep each future release note to 4–6 bullet lines max.

---

## Submission Checklist

### Unblock-the-pipeline (today — these gate everything else)
- [x] Google Play developer account paid + provisioned ($25 one-time) — done
- [ ] **ID-document verification** — upload Israeli ID / passport in Play Console → Home → "Verify your identity". 1–3 day Google review.
- [ ] **Android device verification** — install the *Google Play Console* mobile app on an Android phone, sign in with `yuval.inc@gmail.com`, pick the developer account from the prompt. (Scan the QR code from Home → "Verify that you have access to an Android mobile device".)
- [ ] **Contact phone verification** — gated on ID verification above; once unblocked, request SMS code on `+972545507207`.
- [ ] **Resolve the AAB-source question** — confirm with Base44 support whether their Publish → Mobile app flow can produce a `.aab` for code-managed ChessDNA. (Verified to work for no-code apps like One Word Trap; ChessDNA's editor currently does not show the Publish button.) If yes, this is the build path. If no, fall back to Capacitor (git-history of this doc).

### Once "Create app" is enabled
- [ ] Click **Create app** on Play Console Home — name "Chess DNA", App, Free, accept declarations.
- [ ] Upload AAB to Internal testing track. Verify Play App Signing is enabled.
- [ ] Bump versionCode for every subsequent upload (Base44 should auto-handle this).
- [ ] Target SDK matches current Play floor (verify against developer.android.com on submission day).

### Store listing assets (can be prepared in parallel — don't need verifications)
- [x] App icon (512 × 512, with alpha, PNG) — [play-store-assets/icon-512.png](play-store-assets/icon-512.png).
- [x] Adaptive icon (432 × 432 foreground + 432 × 432 background) — bundled inside the AAB by Base44, no manual action.
- [ ] Feature graphic (1024 × 500, no alpha) — design needed.
- [ ] 6 × phone screenshots (1080 × 2400) — **captured on Android emulator/device, not iOS**.

### Public-URL requirements (host these before submitting)
- [x] Privacy Policy live at `https://chess-dna-fdd5fbde.base44.app/privacy` (§5).
- [x] **Account Deletion** covered by `https://chess-dna-fdd5fbde.base44.app/data-access-request` (§15).
- [x] Support page live at `https://chess-dna-fdd5fbde.base44.app/support` (§14).

### Play Console forms
- [ ] Review account created and tested end-to-end (§16).
- [ ] App access form filled with the review credentials.
- [ ] Data Safety form filled (§17) — cross-checked against Privacy Policy.
- [ ] Content rating IARC questionnaire completed (expected: Everyone).
- [ ] Target audience set to 13+, Designed-for-Families opt-in OFF.
- [ ] Ads declaration: "Contains ads" → No.

### Release path
- [ ] Internal testing track populated and a teammate confirmed install + open works.
- [ ] Closed testing track (≥ 12 testers for ≥ 14 days) — **required for new personal-developer accounts since 2023-11** before promoting to production.
- [ ] Apply for production access, answer closed-test questionnaire.
