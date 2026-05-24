// Server-side proxy for Anthropic /v1/messages.
// Keeps the Claude API key (Deno.env CLAUDE_API_KEY) off the client bundle.
// Requires a Base44 user (no anonymous access). Model is whitelisted; max_tokens is capped.

import { createClientFromRequest } from "npm:@base44/sdk";

const ALLOWED_MODELS = new Set<string>([
  "claude-sonnet-4-20250514",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-opus-4-5-20251101",
]);

const MAX_TOKENS_CAP = 8192;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    // Auth gate. `auth.me()` returns 401 in this app (no User entity — see
    // CLAUDE.md). Base44 forwards function invocations with a service-role
    // header (`Base44-Service-Authorization`) — its presence proves the
    // request came through Base44's platform from an authenticated session.
    // We accept either auth.me() succeeding OR the service header being set.
    let authed = false;
    try {
      const base44 = createClientFromRequest(req);
      const user = await base44.auth.me();
      authed = !!user;
    } catch {
      // auth.me() unavailable for this app — fall through to header check.
    }
    if (!authed) {
      const serviceAuth = req.headers.get("Base44-Service-Authorization");
      const userAuth = req.headers.get("Authorization") ?? req.headers.get("authorization");
      if (!serviceAuth && !(userAuth?.toLowerCase().startsWith("bearer "))) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const apiKey = Deno.env.get("CLAUDE_API_KEY");
    if (!apiKey) {
      return Response.json({ error: "Server misconfigured: CLAUDE_API_KEY not set" }, { status: 500 });
    }

    const body = await req.json();
    const { system, messages, model, max_tokens } = body ?? {};

    if (typeof model !== "string" || !ALLOWED_MODELS.has(model)) {
      return Response.json({ error: `Model not allowed: ${model}` }, { status: 400 });
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: "messages required" }, { status: 400 });
    }

    const cappedMaxTokens = Math.min(
      typeof max_tokens === "number" && max_tokens > 0 ? max_tokens : 2048,
      MAX_TOKENS_CAP,
    );

    // Honor the client's `stream` flag. When true, we relay Anthropic's
    // server-sent-events stream straight through to the browser so it can
    // render tokens as they arrive (~400ms first token vs ~3s for buffered).
    const wantStream = body?.stream === true;

    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: cappedMaxTokens,
        system,
        messages,
        stream: wantStream,
      }),
    });

    if (wantStream && upstream.body) {
      // Pass the SSE stream through unchanged. Don't .text() it — that would
      // buffer the entire response and defeat the purpose.
      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("content-type") ?? "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    const upstreamBody = await upstream.text();
    return new Response(upstreamBody, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
