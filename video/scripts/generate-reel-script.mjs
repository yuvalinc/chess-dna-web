#!/usr/bin/env node
// Generate a viral chess reel storyboard via Claude Opus 4.7.
//
// Usage:
//   node scripts/generate-reel-script.mjs \
//     --content "Légal Trap: 1.e4 e5 2.Nf3 d6 3.Bc4 Bg4 4.Nc3 g6 5.Nxe5! Bxd1 6.Bxf7+ Ke7 7.Nd5#" \
//     --vibe "viral, meme-heavy, AK-47 overlays" \
//     --out src/storyboard/generated/legal-trap.json
//
// What it does:
//   1. Reads our storyboard type definitions from src/storyboard/types.ts
//   2. Builds a cached system prompt teaching Opus 4.7 the shot vocabulary
//      (hook / vsTitle / streak / moveSequence / videoClip / spotlight /
//      punchline / outro), available SFX, meme icons, and timing constraints.
//   3. Streams a structured JSON response via output_config.format.
//   4. Validates the JSON parses, sanity-checks shot totals == 17.4s, and
//      saves the storyboard ready to import into Root.tsx.
//
// Env: ANTHROPIC_API_KEY required.

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// ------------------------------------------------------------ CLI parsing
const { values } = parseArgs({
  options: {
    content: { type: "string", short: "c" },
    vibe: { type: "string", short: "v", default: "viral, fast cuts, meme overlays, gun reactions" },
    out: { type: "string", short: "o" },
    "audio-bed": { type: "string", default: "sfx/ambient-bed.wav" },
    "audio-start": { type: "string", default: "0" },
    "duration-sec": { type: "string", default: "17.4" },
    "dry-run": { type: "boolean", default: false },
  },
});

if (!values.content) {
  console.error("Usage: node generate-reel-script.mjs --content <chess content> [--out <path.json>]");
  console.error("  --content   Brief about the chess game/trap/moment (required)");
  console.error("  --vibe      Style/tone hint (default: viral, fast cuts, meme overlays)");
  console.error("  --out       Output JSON path (default: src/storyboard/generated/<slug>.json)");
  console.error("  --duration-sec  Total reel length (default: 17.4)");
  console.error("  --dry-run   Print to stdout instead of writing file");
  process.exit(1);
}

const totalSec = parseFloat(values["duration-sec"]);
const audioStartSec = parseFloat(values["audio-start"]);

// ------------------------------------------------------------ Load reference context
const typesPath = join(REPO_ROOT, "src/storyboard/types.ts");
const typesSource = readFileSync(typesPath, "utf8");

// Load one example storyboard so Opus 4.7 has a concrete reference of the shape
const examplePath = join(REPO_ROOT, "src/storyboard/win-in-4-meme.ts");
const exampleSource = existsSync(examplePath) ? readFileSync(examplePath, "utf8") : "";

// ------------------------------------------------------------ System prompt
// This is large + stable across runs — perfect candidate for prompt caching.
// Put dynamic content (the brief, the vibe) AFTER the cache breakpoint.
const SYSTEM_PROMPT = `You are a viral chess content director writing storyboards for short-form vertical video (TikTok / Reels / Shorts, 1080×1920, ${totalSec}s).

The storyboard is consumed by a Remotion-based renderer. You MUST output JSON that matches the schema below — the renderer typechecks every field.

# Storyboard type definitions (source of truth)

\`\`\`typescript
${typesSource}
\`\`\`

# Available SFX (procedurally synthesized, no licensing concerns)

Files live at \`public/sfx/*.wav\` and are wired per-event automatically by MoveSequenceShot — you do NOT schedule them yourself. The renderer picks the SFX based on what happens in each move:

- \`sfx/move.wav\` — soft click for normal moves
- \`sfx/capture.wav\` — low thud (auto-fires when a piece is captured)
- \`sfx/check.wav\` — two-tone alarm (auto-fires on check, no mate)
- \`sfx/mate.wav\` — boom + descending tone (auto-fires on checkmate)
- \`sfx/brilliant.wav\` — bell ding (auto-fires on the move marked \`brilliantMoveIndex\`)
- \`sfx/promotion.wav\` — rising glissando (auto-fires on promotion)
- \`sfx/castle.wav\` — rolling whoosh (auto-fires on O-O / O-O-O)
- \`sfx/ambient-bed.wav\` — 18s low drone (loaded once as the bed track in Root.tsx)

# Available MemeIcon kinds (original SVG art)

Set \`squareMemes: [{ square: "a2", kind: "ogre" }, ...]\` to overlay these on specific board squares. Optional \`replacePiece: true\` hides the underlying FEN piece.

- \`ogre\` — green ogre face (use on white pawn rank for "noob army")
- \`cryingCat\` — white cat with tears (use on a piece about to die)
- \`shockHead\` — yellow shock face
- \`fire\` — orange flame
- \`skull\` — skull (use on a doomed king or trap-spring piece)
- \`explosion\` — jagged BOOM star
- \`lightning\` — yellow zigzag bolt
- \`alarm\` — red bell with vibration lines
- \`thumbsDown\` — orange downvote fist
- \`trophy\` — gold cup with star

# Available Sticker kinds (badges with text)

Used in HookShot / PunchlineShot via \`sticker: "??", stickerKind: "blunder"\`:

- \`brilliant\` (\`!!\` green), \`blunder\` (\`??\` red), \`good\` (\`!\`), \`mistake\` (\`?\`)
- \`interesting\` (\`!?\` blue), \`dubious\` (\`?!\` purple)
- \`fire\`, \`skull\`, \`wow\`, \`shock\`, \`crown\`, \`lightning\`
- \`warning\` (red triangle, e.g. \`+18\`), \`resign\` (black circle, e.g. \`RESIGNS\`)

# Available themes (board palettes)

\`pinkBerry\` (pink-on-burgundy, hook drama), \`monoSlate\` (B&W, title cards), \`classicGreen\` (standard chess.com green), \`brilliantGold\` (gold tint), \`noir\` (dark)

# Shot vocabulary (composable in any order)

- **hook** — 1-2s grabber. Sets up the question. Almost always uses \`pinkBerry\` + a sticker like \`??\` or \`!?\`.
- **title** / **vsTitle** — text + optional player photos. Use \`vsTitle\` when there are two named players (white vs black).
- **streak** — counter that ticks up (e.g. 0 → 53) then crashes to 0 with a thud. Use for "streak broken" narratives.
- **moveSequence** — animates a list of SAN moves. The renderer auto-attaches SFX/particles per event. Set \`brilliantMoveIndex\` (zero-based) for the dramatic move (gold spin + 1.6× duration). Set \`showGuns: true\` for AK-47 overlays. Pass \`squareMemes\` for persistent overlays.
- **spotlight** — zoom + glow on a single square after the move. Set \`electric: true\` for the lightning treatment on mate. Set \`layingPiece\` to tip a piece over with a colored glow.
- **punchline** — final close-up zoom with a sticker. \`zoomSquares: ["a1", "f7"]\` defines the bounding box.
- **outro** — Chess DNA brand card with optional credit (Reegan Palmer).
- **videoClip** — letterboxed video (e.g. SpongeBob "A Few Moments Later" at \`clips/few-moments-later.mp4\`) for time-skip bridges.

# Hard constraints

1. **Total duration must equal ${totalSec}s** (sum of \`durationSec\` across all shots).
2. Every shot's \`durationSec\` must be ≥ 0.6 (shorter than that flashes too fast).
3. Use only the shot \`type\` values defined in the schema. Typos will crash the renderer.
4. FEN strings must be valid standard chess positions. SAN moves must be legal from \`startFen\`.
5. \`brilliantMoveIndex\` is ZERO-BASED.
6. \`startMoveNumber\` should reflect the actual game move number for the first ply (default 1).
7. For meme reels with persistent square overlays, AVOID squares involved in the early moves (the pieces move and the overlay stays — looks weird).
8. End with an \`outro\` shot crediting Chess DNA + Reegan Palmer (use \`iconUrl: "brand/chess-dna-icon.png"\`, \`creditPhotoUrl: "photos/reegan.jpg"\`).

# Output format

Reply with a single JSON object matching this shape — no preamble, no commentary, no markdown fences:

\`\`\`json
{
  "title": "Short internal name",
  "shots": [ /* array of shot objects per the schema */ ]
}
\`\`\`

# Reference example (a 7-move Légal Trap reel — study the shape, do NOT copy verbatim):

\`\`\`typescript
${exampleSource}
\`\`\`
`;

// ------------------------------------------------------------ User prompt (dynamic, NOT cached)
const userPrompt = `Write a ${totalSec}-second viral chess reel storyboard for the following.

CHESS CONTENT:
${values.content}

VIBE / STYLE:
${values.vibe}

Treatment notes:
- Be specific about FEN strings and SAN moves (use chess.js conventions).
- Pick a brilliantMoveIndex that lands on the most dramatic moment.
- Place 4-7 squareMemes that REINFORCE the story (e.g. cryingCat on the piece that's about to die, skull on the king's tomb square, ogre army on the noob's pawn rank).
- Distribute durations so cuts land on natural beats — opening hook should be punchy (~1-1.5s), the main move sequence gets the bulk of time, mate moment + spotlight + punchline together get ~4-5s, outro 1.5-2s.
- Set \`showGuns: true\` on the moveSequence to enable the AK-47 overlay treatment.
- The audio bed and per-event SFX are wired automatically — you don't schedule them.

Output ONLY the JSON storyboard. No preamble, no markdown, no commentary.`;

// ------------------------------------------------------------ Output schema
// Discriminated unions with chess-square literals are too complex for strict
// JSON schema validation — use a permissive schema and validate post-hoc.
const STORYBOARD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "shots"],
  properties: {
    title: { type: "string" },
    shots: {
      type: "array",
      minItems: 3,
      items: {
        type: "object",
        required: ["type", "durationSec"],
        properties: {
          type: {
            type: "string",
            enum: [
              "hook", "title", "spotlight", "kenburns", "punchline",
              "moveSequence", "vsTitle", "outro", "videoClip", "streak",
            ],
          },
          durationSec: { type: "number" },
        },
      },
    },
  },
};

// ------------------------------------------------------------ Call Claude Opus 4.7
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ERROR: ANTHROPIC_API_KEY is not set in the environment.");
    process.exit(1);
  }

  const client = new Anthropic();

  console.error("→ Streaming script from Claude Opus 4.7 (adaptive thinking, effort: high)...");
  const t0 = Date.now();

  const stream = client.messages.stream({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: {
        type: "json_schema",
        name: "storyboard",
        schema: STORYBOARD_SCHEMA,
      },
    },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  // Light progress indicator on stderr — keeps the cache warm without buffering
  let thinkingDots = 0;
  stream.on("contentBlock", (block) => {
    if (block.type === "thinking") {
      process.stderr.write(".");
      thinkingDots++;
    }
  });

  const final = await stream.finalMessage();
  if (thinkingDots) process.stderr.write("\n");

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  const usage = final.usage;
  console.error(`→ Done in ${elapsed}s. Tokens: in=${usage.input_tokens}, out=${usage.output_tokens}, cache_read=${usage.cache_read_input_tokens ?? 0}, cache_write=${usage.cache_creation_input_tokens ?? 0}`);
  console.error(`→ Stop reason: ${final.stop_reason}`);

  // Pull the text content
  const textBlock = final.content.find((b) => b.type === "text");
  if (!textBlock) {
    console.error("ERROR: No text block in response");
    process.exit(2);
  }

  // Parse — output_config.format=json_schema guarantees parseable JSON
  let storyboard;
  try {
    storyboard = JSON.parse(textBlock.text);
  } catch (err) {
    console.error("ERROR: Response was not valid JSON:");
    console.error(textBlock.text);
    console.error("Parse error:", err.message);
    process.exit(2);
  }

  // Validation pass: total duration + shot sanity
  const total = storyboard.shots.reduce((s, sh) => s + (sh.durationSec ?? 0), 0);
  const tolerance = 0.02;
  console.error(`→ Validation: ${storyboard.shots.length} shots, total ${total.toFixed(2)}s (target ${totalSec}s)`);
  if (Math.abs(total - totalSec) > tolerance) {
    console.error(`⚠️  Total duration ${total.toFixed(2)}s differs from target ${totalSec}s by ${(total - totalSec).toFixed(2)}s`);
    console.error("   The model can re-target — re-run or hand-tweak durations.");
  }

  // Output
  if (values["dry-run"]) {
    console.log(JSON.stringify(storyboard, null, 2));
    return;
  }

  const outPath = values.out
    ? resolve(process.cwd(), values.out)
    : join(REPO_ROOT, "src/storyboard/generated", slugify(storyboard.title) + ".json");

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(storyboard, null, 2) + "\n", "utf8");
  console.error(`✓ Wrote ${outPath}`);
  console.error(`  Audio bed will be: ${values["audio-bed"]} (start=${audioStartSec}s)`);
  console.error("");
  console.error("Next steps:");
  console.error("  1. Convert JSON → TS by importing in a storyboard file, OR add a JSON-loading composition in Root.tsx");
  console.error("  2. npx remotion render src/index.ts <CompositionId> out/<name>.mp4");
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
}

main().catch((err) => {
  if (err instanceof Anthropic.APIError) {
    console.error(`Claude API error (status ${err.status}, type ${err.type}):`);
    console.error(err.message);
    if (err instanceof Anthropic.RateLimitError) {
      console.error("→ Rate limited. Wait and retry.");
    }
    process.exit(3);
  }
  console.error("Unexpected error:", err);
  process.exit(1);
});
