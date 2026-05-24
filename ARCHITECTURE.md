# Chess DNA — Architecture Diagrams

Current state of the app as of 2026-05-22. Mermaid diagrams covering system layers, UX flows, backend, and data flows.

---

## 1. System Overview

High-level view: browser app, Base44 backend, third-party services.

```mermaid
graph TB
    subgraph Browser["Browser (React 19 SPA)"]
        UI[Pages & Components]
        CTX[Context Providers]
        Engine[Stockfish WASM<br/>Web Worker, depth 18]
        IDB[(IndexedDB<br/>audio sessions)]
        LS[(localStorage<br/>JWT, guest games,<br/>tutorial, theme)]
    end

    subgraph Base44["Base44 Cloud (BaaS)"]
        Auth[Auth + JWT]
        RLS{Row-Level<br/>Security}
        Entities[(14 Entities:<br/>Game, Analysis, Pattern,<br/>Lesson, Exercise, Insight,<br/>TrainingPlan, UserPrefs,<br/>Feedback, AIPrompt,<br/>AnalyticsEvent, BetaTester,<br/>BetaWaitlist, PatternSnapshot)]
        Proxy[claude-proxy<br/>server function]
        Secret[CLAUDE_API_KEY<br/>server-side]
    end

    subgraph External["External Services"]
        ClaudeAPI[Anthropic Claude<br/>sonnet-4 / haiku-4-5]
        OpenAI[OpenAI TTS<br/>gpt-4o-mini-tts]
        Gemini[Gemini 2.0-flash<br/>legacy fallback]
        ChessCom[Chess.com<br/>public API]
        Lichess[Lichess<br/>public API]
    end

    UI <--> CTX
    CTX <--> Engine
    CTX <--> IDB
    CTX <--> LS
    CTX -->|REST + JWT| Auth
    Auth --> RLS
    RLS --> Entities
    CTX -->|via Base44 fn| Proxy
    Proxy --> Secret
    Proxy --> ClaudeAPI
    CTX -.->|user-supplied key| OpenAI
    CTX -.->|legacy fallback| Gemini
    CTX -->|game import| ChessCom
    CTX -->|game import| Lichess

    classDef browser fill:#1e3a5f,stroke:#4a9eff,color:#fff
    classDef backend fill:#2d4a2d,stroke:#5cb85c,color:#fff
    classDef external fill:#4a2d4a,stroke:#c78fc7,color:#fff
    class UI,CTX,Engine,IDB,LS browser
    class Auth,RLS,Entities,Proxy,Secret backend
    class ClaudeAPI,OpenAI,Gemini,ChessCom,Lichess external
```

---

## 2. Context Provider Hierarchy

Defined in [src/App.tsx](src/App.tsx). Order matters — child providers depend on parents.

```mermaid
graph TD
    EB[ErrorBoundary] --> DMT[DevModeToggle]
    DMT --> BR[BrowserRouter]
    BR --> PUB{Route<br/>public?}
    PUB -->|yes| PUBROUTES[Privacy / Support /<br/>DataAccessRequest]
    PUB -->|no| AUTH[AuthProvider<br/>JWT, userId, betaStatus]
    AUTH --> AG[AuthGuard<br/>redirect to login]
    AG --> THEME[ThemeProvider<br/>dark/light, settings]
    THEME --> I18N[I18nProvider<br/>en/es/he]
    I18N --> TOAST[ToastProvider]
    TOAST --> CDP[ChessDataProvider<br/>games + analyses + patterns<br/>40+ derived values]
    CDP --> AUDIO[AudioPlayerProvider<br/>TTS playback]
    CDP --> TUT[TutorialProvider<br/>coachmark tour]
    CDP --> ANL[AnalyticsProvider<br/>event tracking]
    AUDIO --> SHELL[AppShell + Routes]
    TUT --> SHELL
    ANL --> SHELL

    classDef auth fill:#5c2929,stroke:#ff6b6b,color:#fff
    classDef data fill:#1e3a5f,stroke:#4a9eff,color:#fff
    classDef ui fill:#2d4a2d,stroke:#5cb85c,color:#fff
    class AUTH,AG auth
    class CDP,AUDIO,TUT,ANL data
    class THEME,I18N,TOAST,SHELL ui
```

---

## 3. Routes & Navigation Map

19 routes, segmented by auth requirement and audience.

```mermaid
graph LR
    subgraph Public["Public (no auth)"]
        P1[/privacy/]
        P2[/support/]
        P3[/data-access-request/]
    end

    subgraph User["Authenticated User"]
        U1[/ Overview<br/>profile, radar, recent]
        U2[/games RecentGames]
        U3[/games/:id GameDetail<br/>move analysis]
        U4[/patterns Patterns<br/>weakness themes]
        U5[/lessons Lessons]
        U6[/exercises Exercises]
        U7[/training GettingBetter]
        U8[/timemachine TimeMachine<br/>opponent puzzles]
        U9[/compare Compare<br/>friend skill radar]
        U10[/settings Settings]
    end

    subgraph Admin["Admin only (yuval.inc@gmail.com)"]
        A1[/skill SkillStudio]
        A2[/affiliate AffiliateAdmin]
        A3[/prompts PromptsAdmin]
        A4[/feedbacks FeedbackAdmin]
        A5[/analytics AnalyticsAdmin]
    end

    subgraph Dev["Dev tools"]
        D1[/nav NavFlow sitemap]
        D2[/graph Graph viz]
    end

    U1 -.->|gate by<br/>journey stage| U4
    U1 -.->|gate by<br/>journey stage| U5
    U3 -->|share card| Share[html2canvas<br/>SHARE_COLORS]
    U8 -->|select opponent| U9

    classDef pub fill:#3a3a3a,stroke:#aaa,color:#fff
    classDef usr fill:#1e3a5f,stroke:#4a9eff,color:#fff
    classDef adm fill:#5c2929,stroke:#ff6b6b,color:#fff
    classDef dev fill:#4a4a2d,stroke:#cccc5c,color:#fff
    class P1,P2,P3 pub
    class U1,U2,U3,U4,U5,U6,U7,U8,U9,U10 usr
    class A1,A2,A3,A4,A5 adm
    class D1,D2 dev
```

---

## 4. UX Flow: New User Onboarding → First Insights

Journey stage 0 → 5. Gates locked features at each stage.

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant App as React App
    participant Auth as Base44 Auth
    participant Gate as WaitlistGate
    participant Onb as OnboardingFlow
    participant CC as Chess.com API
    participant SF as Stockfish<br/>(Web Worker)
    participant B44 as Base44 Entities
    participant Claude

    User->>App: visit site
    App->>Auth: check JWT in localStorage
    Auth-->>App: { token, email }
    App->>Gate: check beta whitelist
    alt not whitelisted
        Gate-->>User: waitlist form → BetaWaitlist entity
    else whitelisted
        Gate-->>App: pass
        App->>Onb: stage 0 — collect chesscom username
        User->>Onb: enter username, time class
        Onb->>B44: save UserPreferences (singleton)
        Onb->>CC: GET /pub/player/{user}/games/archives
        CC-->>Onb: PGN list
        Onb->>B44: bulk insert Game entities
        Note over App,B44: stage 1 — games imported
        App->>SF: queueForAnalysis (batch)
        loop per game
            SF->>SF: analyze depth 18
            SF->>B44: insert Analysis entity
            SF-->>App: analysisEvents emitter
        end
        Note over App: stage 2 — analyses ready
        App->>App: calculateSkillProfile<br/>(8 dimensions)
        App->>B44: upsert Pattern (singleton)
        Note over App: stage 3+ — patterns unlock
        User->>App: request lesson
        App->>Claude: generate via claude-proxy
        Claude-->>App: lesson content
        App->>B44: cache Lesson entity
    end
```

---

## 5. UX Flow: Game Detail Analysis

User opens a single game to study moves.

```mermaid
sequenceDiagram
    actor User
    participant GD as GameDetail Page
    participant CTX as ChessDataContext
    participant B44 as Base44
    participant SF as Stockfish
    participant Claude
    participant TTS as OpenAI TTS
    participant IDB as IndexedDB

    User->>GD: navigate /games/:id
    GD->>CTX: useChessData()
    CTX->>B44: fetch Game + Analysis
    B44-->>CTX: { game, analysis (JSON) }
    CTX->>CTX: deserializeAnalysis()
    alt analysis missing
        GD->>SF: analyze on-demand
        SF-->>GD: moves[] with eval
        SF->>B44: persist Analysis
    end
    GD->>GD: render MoveList + EvalBar + EvalChart + Board
    User->>GD: click "Explain this move"
    GD->>Claude: explanation prompt
    Claude-->>GD: text
    GD->>GD: cache in explanation-cache
    User->>GD: click "Listen"
    GD->>Claude: generateSummaryAudioScript
    Claude-->>GD: AudioScript (speakers[])
    GD->>TTS: stream chunks
    TTS-->>GD: MP3 chunks
    GD->>IDB: persist session
    GD-->>User: MiniAudioPlayer playback
```

---

## 6. Data Flow: Game Import → Analysis → Patterns → Skill Profile

Core pipeline that powers the entire skill model.

```mermaid
flowchart LR
    subgraph Import["1. IMPORT"]
        CC[Chess.com API]
        LI[Lichess API]
        Manual[Paste PGN]
    end

    subgraph Parse["2. PARSE"]
        PGN[parsePgnToGameRecord<br/>chess.js]
    end

    subgraph Store1["3. PERSIST"]
        GE[(Game entity<br/>Base44)]
    end

    subgraph Analyze["4. ANALYZE"]
        Q[queueForAnalysis<br/>batch mode]
        SC[StockfishClient<br/>singleton worker<br/>depth 18]
        GA[game-analyzer<br/>classify moves]
        EC[eval-classifier<br/>win-chance loss]
        PD[phase-detector<br/>opening/mid/end]
        TD[tactical-detector<br/>fork/pin/skewer]
    end

    subgraph Store2["5. PERSIST"]
        AE[(Analysis entity<br/>JSON stringified)]
    end

    subgraph Compute["6. COMPUTE"]
        Snap[createSnapshot]
        PE[pattern-engine<br/>19 themes]
        WP[windowed-profile<br/>last 50 games]
        SK[skill-calculator<br/>8 dimensions]
        Bench[score-benchmarks<br/>percentile]
    end

    subgraph Store3["7. PERSIST"]
        PA[(Pattern entity<br/>singleton)]
        PS[(PatternSnapshot<br/>history)]
    end

    subgraph Surface["8. SURFACE"]
        Radar[SkillRadar UI]
        Tier[getTierForScore<br/>Pawn→King]
        Lessons[Lesson generator]
    end

    CC --> PGN
    LI --> PGN
    Manual --> PGN
    PGN --> GE
    GE --> Q
    Q --> SC
    SC --> GA
    GA --> EC
    GA --> PD
    GA --> TD
    EC --> AE
    PD --> AE
    TD --> AE
    AE --> Snap
    Snap --> PE
    Snap --> WP
    PE --> SK
    WP --> SK
    SK --> Bench
    SK --> PA
    PA --> PS
    PA --> Radar
    PA --> Tier
    PE --> Lessons

    classDef src fill:#4a2d4a,stroke:#c78fc7,color:#fff
    classDef proc fill:#2d4a2d,stroke:#5cb85c,color:#fff
    classDef store fill:#1e3a5f,stroke:#4a9eff,color:#fff
    classDef ui fill:#5c4a29,stroke:#ffb84a,color:#fff
    class CC,LI,Manual src
    class PGN,Q,SC,GA,EC,PD,TD,Snap,PE,WP,SK,Bench proc
    class GE,AE,PA,PS store
    class Radar,Tier,Lessons ui
```

---

## 7. Data Flow: AI Generation (Router + Fallback)

How any AI request (lessons, exercises, insights, explanations) is routed.

```mermaid
flowchart TB
    Trigger[Component requests<br/>AI generation]
    Builder[prompt-builder<br/>system + user msgs]
    Router{ai-router<br/>sendWithFallback}

    Trigger --> Builder
    Builder --> Router

    Router -->|priority 1| C1[claude-client<br/>via claude-proxy fn]
    C1 -->|429/error| Router
    C1 -->|success| Track[Token usage tracker<br/>localStorage +<br/>UserPreferences sync]

    Router -.->|legacy| O1[openai-client]
    O1 -.->|429/error| Router
    Router -.->|legacy| G1[gemini-client]

    Track --> Validate{needs<br/>validation?}
    Validate -->|exercise| SV[stockfish-validator<br/>depth 16, 50cp tol]
    Validate -->|other| Cache
    SV -->|valid| Cache
    SV -->|invalid| Builder

    Cache[Persist as<br/>Lesson / Exercise /<br/>Insight entity]
    Cache --> UI[Surface in UI<br/>+ explanation-cache<br/>session memory]

    classDef trigger fill:#5c4a29,stroke:#ffb84a,color:#fff
    classDef ai fill:#2d4a2d,stroke:#5cb85c,color:#fff
    classDef store fill:#1e3a5f,stroke:#4a9eff,color:#fff
    class Trigger,Builder trigger
    class Router,C1,O1,G1,SV ai
    class Track,Cache,UI store
```

**Notes:**
- `claude-proxy` is a server-side Base44 function — `CLAUDE_API_KEY` never reaches the browser
- `openai-client` / `gemini-client` use user-supplied keys from `UserPreferences`; mostly legacy now
- Stockfish validates AI-generated exercises before they're persisted
- Token cost is tracked client-side and synced to `UserPreferences.tokenUsage`

---

## 8. Backend: Base44 Entities & RLS

14 entities, server-side row-level security. No `User` entity — identity comes from JWT.

```mermaid
erDiagram
    USER_PREFS ||--o| BETA_TESTER : "whitelisted by email"
    USER_PREFS ||--o{ GAME : "owns"
    GAME ||--o| ANALYSIS : "1:1 via gameId"
    GAME }o--o{ PATTERN_SNAPSHOT : "contributes to"
    USER_PREFS ||--o| PATTERN : "singleton per user"
    PATTERN ||--o{ PATTERN_SNAPSHOT : "history"
    USER_PREFS ||--o{ INSIGHT : "owns"
    USER_PREFS ||--o{ LESSON : "owns"
    USER_PREFS ||--o{ EXERCISE : "owns"
    USER_PREFS ||--o| TRAINING_PLAN : "owns"
    USER_PREFS ||--o{ FEEDBACK : "submits"
    AI_PROMPT ||--o{ LESSON : "version used"
    AI_PROMPT ||--o{ EXERCISE : "version used"
    ANALYTICS_EVENT }o--|| USER_PREFS : "userId"
    BETA_WAITLIST }o--o| BETA_TESTER : "promoted to"

    GAME {
        string gameId PK
        text pgn
        string player
        string opponent
        string timeClass
        date playedAt
        string analysisStatus
    }
    ANALYSIS {
        string gameId FK
        text moves_json
        json summary
        int engineDepth
    }
    PATTERN {
        json patterns
        date lastUpdated
        int gamesInWindow
    }
    USER_PREFS {
        string claudeApiKey
        string chesscomUsername
        string selectedTimeClass
        string theme
        string locale
        json tokenUsage
        int journeyStage
    }
    LESSON {
        string title
        text content
        array patterns
        array relatedGames
    }
    EXERCISE {
        text pgn
        array solution
        string theme
        bool stockfishValidated
    }
    AI_PROMPT {
        string title
        int version
        text system
    }
    ANALYTICS_EVENT {
        string eventName
        string userId
        json properties
        date timestamp
        int journeyStage
    }
```

---

## 9. Storage Architecture

Where data lives and what survives a reload / sign-out.

```mermaid
graph TB
    subgraph Server["Server-side (Base44)"]
        S1[(Game, Analysis,<br/>Pattern, PatternSnapshot)]
        S2[(UserPreferences<br/>singleton)]
        S3[(Lesson, Exercise,<br/>Insight, TrainingPlan)]
        S4[(Feedback,<br/>AnalyticsEvent)]
        S5[(AIPrompt — versioned)]
        S6[(BetaTester,<br/>BetaWaitlist)]
        SEC[CLAUDE_API_KEY<br/>server env]
    end

    subgraph Client["Client-side"]
        L1[localStorage<br/>base44_access_token]
        L2[localStorage<br/>guest games array]
        L3[localStorage<br/>tutorial seen steps]
        L4[localStorage<br/>theme + locale]
        L5[localStorage<br/>chess-dna-token-usage]
        L6[localStorage<br/>last-compared-player]
        I1[(IndexedDB<br/>chess-dna-audio DB<br/>sessions + chunks)]
        M1[Memory cache<br/>chesscom avatars]
        M2[SessionStorage<br/>explanation-cache]
    end

    Server -. RLS per user .- Client
    L1 -.->|JWT identifies user| S2
    L2 -.->|guest → migrate on signup| S1
    L5 -.->|periodic sync| S2

    classDef cloud fill:#2d4a2d,stroke:#5cb85c,color:#fff
    classDef persist fill:#1e3a5f,stroke:#4a9eff,color:#fff
    classDef ephem fill:#4a2d4a,stroke:#c78fc7,color:#fff
    class S1,S2,S3,S4,S5,S6,SEC cloud
    class L1,L2,L3,L4,L5,L6,I1 persist
    class M1,M2 ephem
```

**Survival rules:**
| Storage | Survives reload | Survives sign-out | Synced to server |
|---|---|---|---|
| localStorage (JWT) | yes | no (cleared on logout) | n/a |
| localStorage (guest games) | yes | yes | only via migrate-on-signup |
| localStorage (token usage) | yes | yes | periodic sync to UserPrefs |
| IndexedDB (audio) | yes | cleared on sign-out | no |
| Memory cache (avatars, explanations) | no | no | no |
| Base44 entities | yes | yes | source of truth |

---

## 10. UX Flow: Friend Compare / Time Machine

How comparison and the time-machine puzzle mode work together.

```mermaid
sequenceDiagram
    actor User
    participant Comp as Compare Page
    participant LB as chess-com-leaderboard
    participant CC as Chess.com API
    participant TM as TimeMachine Page
    participant SF as Stockfish
    participant CTX as ChessDataContext

    User->>Comp: open /compare
    Comp->>LB: fetch top players
    LB->>CC: GET /leaderboards
    CC-->>LB: players[]
    User->>Comp: select friend / top player
    Comp->>CC: GET player profile + games
    CC-->>Comp: PGNs
    Comp->>CTX: importGames(skipCrossUserDedup: true)
    CTX->>SF: queueForAnalysis (batch)
    SF-->>CTX: analyses persisted
    CTX->>CTX: calculateSkillProfile for friend
    Comp->>Comp: render dual SkillRadar
    User->>TM: "Play their opening"
    TM->>CTX: load opponent game
    TM->>SF: bot-mover at configurable depth
    User->>TM: make move
    TM->>SF: evaluate user move vs opponent's actual
    SF-->>TM: classification (best/good/blunder)
    TM-->>User: show feedback + opponent's real move
```

---

## 11. Key Cross-Cutting Concerns

```mermaid
mindmap
  root((Chess DNA))
    Auth
      Base44 JWT
      Guest mode<br/>(localStorage games)
      Beta whitelist + waitlist
      Admin role<br/>(yuval.inc@gmail.com)
    Performance
      Stockfish singleton<br/>(one Web Worker)
      Heavy computations<br/>in useMemo
      Batch mode disables<br/>incremental re-renders
      Streaming TTS chunks
      Watermark-based polling
    AI Routing
      claude-proxy<br/>(server-side key)
      Fallback router<br/>(429 → next provider)
      Token usage tracking
      Stockfish validates<br/>AI exercises
      Versioned prompts<br/>(AIPrompt entity)
    Theming
      Tailwind 4 CSS vars
      dark/light via<br/>data-theme attr
      SHARE_COLORS hex<br/>(html2canvas can't<br/>resolve CSS vars)
      8 board themes
    i18n
      en / es / he
      RTL support for he
      Locale in UserPrefs
    Analytics
      AnalyticsProvider<br/>(side-effect only)
      data-track attrs<br/>on clickables
      AnalyticsEvent entity
      Journey-stage funnel
    Deploy
      npm run build →<br/>tsc -b + vite build
      base44 site deploy
      PREBUILD GUARD:<br/>blocks worktree<br/>deploys when main<br/>has uncommitted work
```

---

## 12. Critical Files Index

Files that punch above their weight — break these and a lot breaks.

| File | Why it's critical |
|---|---|
| [src/contexts/ChessDataContext.tsx](src/contexts/ChessDataContext.tsx) | Core data hub, 40+ derived values, all-hooks-before-returns |
| [src/pages/GameDetail.tsx](src/pages/GameDetail.tsx) | Complex hook ordering (React error #300/#310 risk) |
| [src/engine/stockfish-client.ts](src/engine/stockfish-client.ts) | Singleton WASM worker — breaks all analysis if broken |
| [src/patterns/skill-calculator.ts](src/patterns/skill-calculator.ts) | 8-dimension profile + fallback for broken joins |
| [src/shared/constants.ts](src/shared/constants.ts) | Thresholds cascade across the entire app |
| [src/hooks/useEntity.ts](src/hooks/useEntity.ts) | Base44 entity hooks with guest/auth branching |
| [src/ai/ai-router.ts](src/ai/ai-router.ts) | AI fallback orchestration |
| [src/ai/prompt-builder.ts](src/ai/prompt-builder.ts) | 32KB templated system prompts |
| [src/App.tsx](src/App.tsx) | Context nesting + route table |

---

*Generated 2026-05-22. Update when major flows change (new entities, new providers, new external services).*
