# Content Log

Raw material from the tireops build. Each entry is a narratively-complete moment — a security fix, a guardrail added, a integration wired up. Plain English, date-stamped. The owner turns these into his own voice for posts.

---

## 2026-05-19 — Investigated a security alarm; the alarm was wrong

Started the session expecting to fix an "actively bleeding" security issue: a prior handoff brief claimed `.env.local` was committed to git with live Anthropic, OpenAI, and Supabase keys, and that the keys needed urgent rotation.

Ran the verification before the panic:

```
git ls-files -- ".env*"                    # empty
git log --all --diff-filter=A -- ".env*"   # empty
git check-ignore -v .env.local             # matched by .gitignore line 34
```

`.env.local` exists on disk (it has to — the app needs the values to run) but it has never been in any commit on any branch. The `.gitignore` already had `.env*` covered. The brief's "survey" had misread the situation.

Updated the brief to reflect reality: §8 now reads "Env file status (verified 2026-05-19)" instead of "⚠️ Security Issue." §13 and §14 cleaned up to match.

**The lesson worth keeping:** a handoff document is a snapshot, and snapshots can be wrong. Verify before you rotate. It would have been easy to burn an hour rotating three sets of keys and rewriting git history for an issue that didn't exist.

---

## 2026-05-19 — Brought the CRM's $28-incident guardrails to tireops

The sibling CRM project had a $28 surprise Anthropic bill earlier in the year — the fix was a daily-budget cap, a `ai_usage_log` table, and a pre-flight assertion that hard-stops AI calls once the day's spend hits the cap. tireops had none of that. Today, ported the pattern over.

A few things that made the port more interesting than a copy-paste:

1. **tireops calls Anthropic via raw `fetch` and streams the response** — no SDK to wrap. So the budget pre-flight became a try/catch at the top of the route handler, and the usage logging had to extract token counts from the streaming events (`message_start` carries the initial input/cache tokens, `message_delta` carries the final output total). Two new event handlers in the stream parser, one new `usage` accumulator, and that's it.

2. **The chat route runs a tool-loop up to 6 times per turn** (search a tire → confirm → update). Each loop is a separate Anthropic call, so each loop now logs its own row. A turn that calls 3 tools costs 3+ API calls — and now I can see each one in `ai_usage_log` with its own row, model, and cost.

3. **Discovered the brief was wrong about caching too.** It claimed tireops had "no prompt caching despite a 2500-word system prompt." Reading the code showed prompt caching was already on. Smoke-tested it: first chat cost $0.020, second chat (within 5 min) cost $0.003 — a 6.7× drop because Anthropic served the system prompt from cache at 10% of the input-token rate. Phase 3 of the original plan ("add prompt caching") became "verify caching works" instead. Took five minutes.

**The lesson worth keeping:** the financial guardrails from one project transfer almost completely to a sibling project that does similar work. The shapes differ (SDK vs raw fetch, batch vs stream) but the building blocks — pre-flight budget assert, usage log table, after-the-fact cost computation, daily reset — are the same. Worth front-loading this pattern into any new agent-driven app from day one.

---

## 2026-05-19 — Two AI apps, one shared secret, talking to each other

Tireops's integration endpoint — the door the sibling CRM will eventually walk through to ask "do we have any 225/65R17 winter tires?" — has been sitting uncommitted in the working tree for who knows how long. Today, finished the job: wrote the missing decision record explaining why a shared-secret header beat the alternatives, updated the brief's §15 from "TBD" to "decided", and fixed a stale line in the integration doc that claimed there was no daily budget cap (there is now, see the previous entry).

The auth choice itself is almost boring in retrospect, which is the point. Two apps, one owner, no other callers — the cheapest thing that works is a long random string in an env var on both sides, sent via `X-Inventory-Token` header, checked once at the door. The CRM's tool dispatches a POST, tireops's integration route validates the token, then delegates to the same `/api/chat` handler the voice UI uses. Everything downstream — the system prompt, the tool layer (search_tires, add_tire), the confirmation pattern, the daily budget cap, the prompt cache — applies identically to integration traffic. The CRM can't enter through a side door and skip the safety rails, because there is no side door. There's just a different door that opens onto the same hallway.

Worth recording why I *didn't* go fancier:
- A JWT scheme would have meant standing up a shared Supabase project, key rotation infrastructure, and verification code, for the privilege of authenticating a single static caller.
- Cross-account Supabase service-role access would have given the CRM a key that bypasses every RLS policy in tireops. One CRM bug, one bad tool call, and the tires table is corrupted from across the network.

The smallest auth that fits the threat model. The decision record at `docs/decisions/0001-crm-integration-auth.md` spells out when it'll be time to graduate to something heavier (third-party callers, audit needs, multi-tenancy).

**The lesson worth keeping:** match the auth complexity to the actual threat model. Two-app shared ownership is a different problem from a public API, and pretending otherwise costs weeks of integration work for zero security gain.
