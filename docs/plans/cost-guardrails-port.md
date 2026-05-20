# Plan: Port CRM cost guardrails to tireops

**Status:** Proposed, not yet executed
**Date:** 2026-05-19
**Reference:** PROJECT_BRIEF §7, §14 (cost guardrails section)

## Why

tireops has no per-day spend cap, no per-request budget check, and no usage log. The sibling CRM had a $28 surprise bill that drove a hardening pass: a `DAILY_AI_BUDGET_USD` env var, an `ai_usage_log` table, an `assertWithinBudget()` pre-flight, and a `logUsage()` post-call write. Porting that pattern to tireops before voice-driven chat usage scales up.

## What's different about tireops (vs the CRM)

The CRM uses the official Anthropic SDK; tireops calls `https://api.anthropic.com/v1/messages` via raw `fetch` and **streams** the response. Three implications:

1. **No SDK to hook into.** The guardrails have to wrap the route's `fetch` call directly.
2. **Usage data arrives mid-stream.** Anthropic streams emit `message_start` (initial input/cache tokens) and `message_delta` (final output tokens + final usage). We need to extract usage during stream parsing, then log after the stream completes.
3. **One feature, not many.** The CRM tags calls by `feature` (`triage`, `extract`, `reply`, etc.). tireops has one entry point — the chat route — so `feature` is just `"chat"`.

A fourth consideration: tireops uses the Supabase **anon** key for all server operations (see `lib/supabase.ts` — single client, anon key). Adding a service-role client just for the usage log would mean a new env var and a bigger blast radius. Simpler: insert via anon, with the new table's RLS configured permissively (matches how `activity_log` and `bug_reports` work today). Confirm this matches the existing RLS posture before running the migration.

## Step-by-step

### 1. Migration: `scripts/add-ai-usage-log.sql`

Copy the CRM's schema verbatim — it's already minimal and correct. Same columns: `created_at`, `model`, `feature`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_creation_tokens`, `cost_usd`. Same two indexes. Add a comment at top noting it mirrors `crm-app/scripts/add-ai-usage-log.sql`.

I won't run it. Owner runs it in the Supabase dashboard and confirms.

### 2. New file: `lib/anthropic.ts` (TypeScript port of `crm-app/lib/anthropic.js`)

Exports:

- `PRICING` — same per-million-token table as CRM (Sonnet/Opus/Haiku, with `in`, `out`, `cacheRead`, `cacheWrite` rates)
- `estimateCostUsd(model, usage)` — returns USD cost for one call given a usage object with `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`
- `dailyBudgetUsd()` — reads `DAILY_AI_BUDGET_USD` env var, defaults to $5 (more headroom than the CRM's $2 — voice chat turns are richer than CRM's email-triage one-shots)
- `todaysAiSpend()` — queries `ai_usage_log` since UTC midnight, sums `cost_usd`, returns 0 on any error
- `assertWithinBudget()` — throws if `todaysAiSpend() >= dailyBudgetUsd()` with a clear message. Bypassable via `AI_BUDGET_DISABLED=true` for emergencies.
- `logUsage({ model, feature, usage })` — best-effort insert into `ai_usage_log`. Never throws. Returns the cost it just logged so callers can include it in a response if useful.

Differences from the CRM file:
- Uses the existing `supabase` client from `lib/supabase.ts` (anon key) instead of a service-role client.
- TypeScript types for `usage` and the function signatures.
- No `callStructured` / `callMessages` wrappers — tireops doesn't use the SDK so there's nothing to wrap. The route will call `assertWithinBudget()` and `logUsage()` directly.

### 3. Wire into `app/api/chat/route.ts`

Two surgical edits:

**a) Pre-flight check (before the stream loop opens).** Call `assertWithinBudget()` near the top of `POST`, right after the env-var check at line 970. If it throws, return a 429 with the error message so the client can show a friendly "AI is paused until tomorrow" notice.

**b) Capture usage during stream parsing, log after stream completes.** Currently `parseAnthropicStream` (lines 866-967) parses `content_block_*` events but ignores `message_start` / `message_delta`. Add:
- A `usage` accumulator in the parser
- Handlers for `message_start` (initial usage with `input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`)
- Handler for `message_delta` (final `output_tokens` — may overwrite earlier values)
- Return the final usage object as part of `StepResult` (already returns `{ content }`; widen to `{ content, usage }`)

Then in the tool-loop in `start()`, after each `parseAnthropicStream` call, fire `logUsage({ model: MODEL, feature: 'chat', usage: result.usage })`. Don't await it — fire-and-forget so it never delays the response. (If it errors, `logUsage` already swallows it.)

The loop runs up to 6 times per turn — each iteration is a separate Anthropic call and gets its own log row. This is the correct shape: a turn that calls 3 tools costs 3+ API calls, and we want to see each one.

### 4. Spend display

The owner's preference (from the brief): "a small widget on the existing dashboard." Looking at `app/page.tsx`, the natural slot is below the "Stock" section, before the footer — a single one-row strip showing "AI today: $0.0123 of $5.00 budget" with a faint progress bar. Color the bar:
- Green at <50% of budget
- Yellow at 50-90%
- Red at ≥90%

New client function: fetches via a `/api/ai-spend` route (small GET that calls `todaysAiSpend()` server-side and returns `{ spent, budget }`). Avoids exposing the table directly to the client.

This is the most cuttable part of Phase 2 — if owner wants to skip the widget for now and just rely on the budget cap, that's fine. The cap protects the wallet; the widget is informational.

### 5. Smoke test plan

1. Run the migration in Supabase, verify the table exists with `select * from ai_usage_log limit 1` (empty result OK).
2. `npm run dev`, send one chat message.
3. Check `ai_usage_log` — expect 1 row with non-zero token counts and a small `cost_usd` value.
4. Temporarily set `DAILY_AI_BUDGET_USD=0.00001` in `.env.local`, restart dev server, send another chat — expect a 429 error and a clear "budget reached" message in the UI.
5. Restore `.env.local` to no override (default $5).

### 6. Commit + content log

One commit, focused message:
```
chat: add daily AI budget cap + usage logging

Ports the CRM's $28-incident guardrails: a daily spend cap
(DAILY_AI_BUDGET_USD, default $2), an ai_usage_log table that
records every Anthropic call with token + cost breakdowns, and a
small dashboard widget showing today's spend against budget.
```

Content-log entry: 3-5 sentences on bringing the lesson from the CRM to the second app.

## What I won't do without checking first

- Run the migration. (Owner-only operation.)
- Switch tireops to a service-role Supabase client. (Bigger blast radius; not needed for this work.)
- Refactor `app/api/chat/route.ts` structure beyond the two surgical edits above. (Respects the "don't touch confirmation patterns" rule.)
- Touch `MAX_HISTORY_TURNS`. (Brief flags it as protected.)

## Out of scope (revisit later)

- Per-shop budgets (e.g., $2 for Mission, $2 for Lethbridge separately). Defer until multi-shop volume is real.
- Streaming the spend widget in real-time. The widget loads on dashboard mount; refresh is via page reload. Good enough.
- Rate-limiting per user. The budget cap already bounds the worst case to $2/day across all users — fine for now.
