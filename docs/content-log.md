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

---

## 2026-05-19 — Two AI apps just had their first conversation

Fired the first end-to-end integration query against the new endpoint. From a curl on the command line, posing as the CRM:

```
POST /api/integration/inventory
X-Inventory-Token: <shared secret>

{ "query": "do we have any winter tires in stock?", "shop": "Mission" }
```

The response streamed back through NDJSON: Claude called the `search_tires` tool, the database returned 20 winter tires across Bridgestone Blizzak, Continental VikingContact, Michelin X-Ice/X-Ice Snow, and Pirelli Winter Sottozero. Claude grouped them by brand, summarized the size ranges and condition mix, and ended with "Want me to narrow it down by size or anything else?" — the same voice the in-app chat uses. The CRM, when it eventually calls this endpoint, will pipe that text directly into its customer-facing reply.

Two things worth recording:

The spend log captured the call correctly. Today's usage went from $0.103 to $0.139 — that's a single integration query, but it was a *two-step* call (Claude first invoked the search tool, then synthesized the answer in a second Anthropic round-trip), and the cost guardrail logged both as separate rows. So if a CRM customer ever generates an unusual spike, I can break it down per tool-loop step in the database.

The integration call shares the daily budget cap with the voice UI. There's one $5/day pool covering both surfaces. If integration volume ever crowds out the shop floor's voice chat, that's the moment to split them into separate budgets — but it's a problem worth not solving until it exists.

**The lesson worth keeping:** the moment two AI agents start talking is anticlimactic in the best way. There's no celebration screen, no "AI shakes hands with AI" animation. There's just a streamed natural-language answer that flows back through a channel you built, with all the usual safety rails (auth, RLS, budget cap, prompt cache) applying invisibly. The dramatic version is what we promise. The quiet version is what we ship.

---

## 2026-05-19 — `.env.local.example` because setup deserves a map

Wrote a real `.env.local.example` covering the seven env vars tireops cares about: Supabase URL + anon key, Anthropic key, OpenAI key, the CRM integration shared secret, plus the optional daily budget cap and emergency bypass. Each one is documented in the file with: what it does, where to get the value, whether the app works without it.

The reason this matters: tireops is going to be a Gumroad starter-kit companion to the CRM, and "set up your env" is the very first thing a buyer does after cloning the repo. A `.env.local.example` is the silent welcome handshake — the difference between "this looks intimidating" and "ok, I know what to fill in." It's also a small piece of public-build content. The story is "I made it easy for someone else to start" rather than "I'm secure" — which is the better headline anyway.

---

## 2026-05-19 — Tested the guardrail by actually triggering it

The cost cap had been verified in one direction only — calls go through, get logged, spend appears in the dashboard widget. Today, drove it the other way: tightened `DAILY_AI_BUDGET_USD` to `$0.01` in `.env.local`, restarted the dev server, sent a chat request, and got back exactly the response the failure path is supposed to produce — `HTTP 429` with the body `{"error":"AI daily budget reached: $0.1393 of $0.01 spent today. Raise DAILY_AI_BUDGET_USD in your env to continue, or wait until UTC midnight."}`. The message came verbatim from the `assertWithinBudget()` throw, surfaced through the `try/catch` at the top of `/api/chat`.

The pre-flight nature mattered: today's spend stayed at $0.139 after the 429, not $0.139 + epsilon, because the request never reached Anthropic. The cap fires *before* the API call rather than after — so once the budget is hit, no further Anthropic dollars accrue. Removed the override afterwards and confirmed the budget is back to $5 and the chat flow resumes.

**The lesson worth keeping:** a guardrail isn't trustworthy until you've watched it stop you. The happy path looks identical whether your safety net works or not. Five minutes of "deliberately break it" is worth more than five months of "I'm sure it'll fire when it has to."

---

## 2026-05-19 — Closing the security-and-guardrails arc

The sprint started with a false alarm ("`.env.local` is committed to git!" — it wasn't) and ends with a working budget cap fired in both directions and verified RLS that makes `ai_usage_log` append-only from the anon role. The integration endpoint inherits the cap automatically because it delegates to `/api/chat`, so one $5/day ceiling protects both the voice UI and the CRM-to-tireops bridge. Five commits, two content-log moments worth posting (the false-alarm story and the first two-app handshake), zero keys rotated unnecessarily, zero git history rewrites. Tireops goes dormant now until either a real bug, a CRM-side change that needs a counterpart here, or the eventual Phase 5 schema-capture pass.

---

## 2026-05-20 — Clean slate for the first real tire

Tireops had 113 test tires sitting in the database under "TEST" and "Test Shop" — leftovers from earlier development. Today, before adding real inventory for the first time, wiped them. Snapshotted everything to `backups/snapshot-2026-05-20_181307Z.json` (96 KB, all 189 rows across 4 tables, gitignored so it stays local) so the test setup can be restored if there's ever a reason. Ran `scripts/reset-test-data.sql` in Supabase: cleared `tires`, `tire_photos`, `activity_log`, `bug_reports`, reset the `tire_number` sequence to start fresh. Kept `ai_usage_log` intact since the budget-cap baseline is still useful even if the test calls that produced it aren't.

The next tire added to this database becomes **tire-1**. A real one this time.

**The lesson worth keeping:** snapshot before you wipe, even when you're sure it's all test data. The snapshot took 5 seconds to generate and zero seconds to be glad I had it. Reversible destruction beats irreversible destruction every time.

---

## 2026-05-20 — Tire knowledge base: catalog + fuzzy matcher + self-teaching

The failure mode that started this: voice chat staff would say "Michelin Pilot Sport 4S" but Whisper would transcribe it as something garbled — "Mishelin Pilot Spore for ess" or worse. The chat agent had no controlled vocabulary to compare against, so it would either save the garbled string verbatim ("Mishelin" goes into the brand column) or interpret it with help from a hand-written rule in the system prompt ("be generous with brand names"). The system-prompt rule helped sometimes; the garbled brand still ended up in the database often enough.

Today: built a fuzzy-match knowledge base, plumbed it into `add_tire`, and watched it work end-to-end.

**Catalog** — `lib/tire-catalog.json`, 39 brands × 215 models with aliases for three categories of mishearing: phonetic ("Mishelin" → Michelin), shorthand ("PS4S" → Pilot Sport 4S, "BFG" → BFGoodrich), and Whisper-induced word splits ("Pilot Sport Force" → Pilot Sport 4S, "Wildpeak A T 3 W" → Wildpeak A/T3W). Picked the top 30 brands the user asked for plus 9 obvious ones (Vredestein, Avon, Kelly, Riken, Westlake, Linglong, Sailun, Triangle, Roadmaster). Each model has 5 common sizes recorded as metadata — not used by the matcher today, but easy to plug into future "did you mean size X?" suggestions.

**Matcher** — `lib/tire-catalog.ts`, hand-rolled Sørensen-Dice on character trigrams (~15 lines, zero new deps). Each input scored against every canonical + alias for every entry; best score wins. Three tiers:

- **HIGH** (score > 0.85 *and* clear gap to the runner-up): silent canonical substitution.
- **MEDIUM** (in the 0.6–0.85 range, or two candidates both above 0.6 with a tight gap): return alternates, let the assistant ask the user.
- **NONE** (best score < 0.6): trigger the learn flow.

The "gap to runner-up" rule was a bug I had to fix mid-test. My first version flagged any exact match as medium if a sibling model in the same brand scored above 0.6 — so "Pilot Sport 4S" came back as medium just because "Pilot Sport 5" also scored 0.77. Wrong. The corrected rule: top must clear 0.85 AND be more than 0.15 ahead of the second-best. A 1.000 with a 0.77 runner-up has a 0.23 gap → clean winner, HIGH. Two candidates at 0.696 each (the Bridgestone Blizzak WS90 vs DM-V2 case) have a gap of 0 → ambiguous → MEDIUM. Real ambiguity vs apparent ambiguity.

**Integration** — `runAddTire` in the chat route now runs the brand matcher first, then (if brand resolved) the model matcher. On a non-HIGH result, it returns a status field — `needs_brand_confirmation`, `needs_model_confirmation`, `unknown_brand`, or `unknown_model` — instead of inserting. The assistant follows rule 16 in the system prompt: present alternates, wait for user reply in a separate turn, retry `add_tire` with `confirmed_brand: true` (and/or `confirmed_model`) to bypass the matcher on the second pass. For the learn flow, a new `learn_tire_term` tool persists user-confirmed terms to the JSON via `fs.writeFile`. On Vercel that write is silently no-op'd because the runtime FS is read-only — the catalog grows in dev sessions and gets committed to git like any other change.

**Three live tests passed:**

1. *High path:* "Michelin Pilot Sport 4S, 245/40R18, set of 4..." — one HTTP turn, silent canonical substitution, tire-140 inserted.
2. *Medium path:* "Birdgestone Blizzak..." — interesting wrinkle: Claude pre-corrected "Birdgestone" → "Bridgestone" before even calling the tool, so the matcher saw "Bridgestone" → HIGH. The actual medium tier fired on the model: "Blizzak" alone matches both WS90 and DM-V2 at exactly the same trigram score (0.696). AI asked "WS90 or DM-V2?", user clarified, retry with `confirmed_model: true` succeeded. tire-141 inserted.
3. *Unknown path:* "ZyloTires ThunderMax..." (fictional). First call returned `unknown_brand`. User spelled. AI called `learn_tire_term(kind=brand)` → success. Then `learn_tire_term(kind=model, brand=ZyloTires)` → success. Then `add_tire` with both confirmed flags → tire-142 inserted. The catalog grew from 39 to 40 brands; the JSON file on disk now contains ZyloTires.

Late refinement: when the canonical substitution differs from what the user said, rule 16 now requires the AI to flag the change explicitly in its reply ("I saved that as Michelin Pilot Sport 4S — let me know if you meant something different") rather than mention it in passing. The user asked for this after seeing the silent substitution behavior in the test transcripts and worrying that a wrong correction would slip through. Good catch.

**What's NOT yet here, by design:** hands-free voice (separate sprint). Sizes-aware matching ("did you mean 235/55R17?"). Supabase-backed catalog (deferred — Vercel-side learning would require it, but the local-only commit-to-grow pattern works today). Cross-brand model disambiguation (Michelin's "Latitude" vs Continental's same name).

**The lesson worth keeping:** the tier rule was wrong on first write because it treated "similar siblings exist" as ambiguity. A real ambiguity test isn't "any near-miss exists" — it's "the runner-up is close to the winner." That's the actual user-experience question: would the user have to think about which one? If yes, ask. If no, just substitute. Smoke-testing across 24 inputs caught the bug before it shipped; would have been a confidence-shaking demo otherwise.

---

## 2026-05-21 — Pivoting from hands-free to "smarter chat" (Phase 1)

Hands-free voice (the B-sprint) stalled at B3.2 in a working-but-not-finished state. The B2 plumbing — VAD library, session UI, postinstall asset copy, the `.mjs` fix — all works on Android. But the leap from "captures voice segments" to "submits tires through chat" never landed because the underlying truth surfaced during real shop entry: tap-to-record plus the c01e01e tire-catalog flow is *already* fast enough. Hands-free was a theoretical improvement, not a felt pain point. So the B3 libs (Whisper transcribe + trigger-word detection) got committed dormant, and the energy moved to the surface that actually gets used every day.

Today's Phase 1 was six prompt-only edits to make the existing chat noticeably smarter, no new code, no schema changes:

1. **Correction-after-add (rule 16)**. If the user says "actually that was 225 not 215" right after adding a tire, the agent now calls `update_tire` on the just-inserted tire id instead of treating it as a fresh add. Single-sentence confirm for low-stakes tweaks ("Updated tire-170 to 225/55R17."); explicit yes for big changes (size, brand, model). Live-tested with `tire-170` and it worked exactly as designed — no duplicate, one-turn fix, AI used the correct id.

2. **Counting-questions get summaries, not row dumps (rule 2)**. "How many summer tires?" now returns "we have 8 summer tires in 17 inch — 4 Michelins, 4 Continentals" instead of listing every row.

3. **Stray context routes to `notes` (rule 3)**. "Add a Continental ExtremeContact DWS06 Plus 225/45R18 set of 4 customer John's truck 250 each done" now correctly extracts `notes: "For customer John's truck"` instead of dropping it or asking about it. Field-shaped content goes in fields; freeform context goes in notes. Worked first try.

4. **Quantity is now a critical field for fill-in (rule 3)**. The asking-for-info priority was already "size, then brand, then quantity, then condition", but rule 3 only enforced asking for size or brand. Now quantity gets the same conversational follow-up if it's missing.

5. **Rule numbering cleaned up.** Rules went 1-7, 9, 10, 12, 13, 14, 15, 16 — skipping 8 (a runtime-interpolated shop rule) and 11. Now it's a clean 1-16 with shopRule interpolating as 8.

6. **"a set" → ask "set of 2 or 4?" — reverted.** Tried it; the AI overrode the rule because "a set" → 4 is too strong a prior in tire-shop English. Live tests confirmed the AI saved silently as quantity:4 anyway. Decided to keep "a set" → 4 silently and rely on rule 16 (correction-after-add) for the rare case where the user actually meant a pair. Friction beat correctness on this one.

**The lesson worth keeping:** not all "should ask" rules actually fire when they fight a strong language prior. Test the rule against the real model before declaring it shipped. And when a rule fights a prior, look at whether a downstream safety net (in this case rule 16) already covers the rare case — if yes, accept the prior and skip the friction.

---

## 2026-05-21 — Smarter chat Phase 4: size validation finally uses the catalog's `common_sizes`

The tire catalog from sprint c01e01e had recorded 1,075 "common sizes" across 215 models as informational metadata, but the matcher never looked at them. So if a voice transcription garbled "245/40R18" into "245/40R88," the agent would happily save the wrong size and the user would have to catch it later in /inventory.

Today's edit closes that loop. New `matchSize(brand, model, inputSize)` in `lib/tire-catalog.ts` runs after the brand + model matchers in `runAddTire`. It's deliberately conservative — only flags when there's a clear single-digit typo in the size relative to one of the model's known common_sizes. No common_sizes recorded for the model? Pass through. User-given size has no close catalog candidate? Pass through. The friction-cost of false positives is too high for incomplete catalog data, so the matcher errs on the side of silence.

When a typo IS caught, the new `needs_size_confirmation` status flows through to a fourth sub-bullet in rule 15 of the system prompt. The agent asks once, the user confirms, the retry passes `confirmed_size: true` to bypass the check. Same exact pattern as brand and model confirmation — third tier of the catalog's three-tier confidence model, now extended to sizes too.

Live-tested on the real chat. A user dictating "Michelin Pilot Sport 4S 245/40R88" gets back: *"That size looks off — did you mean 245/40R18? Sounds like '88' might have been a garble for '18.' Say yes to confirm or give me the correct size."* The agent generated that natural explanation itself from the data (`original: "245/40R88"`, `suggested: "245/40R18"`) — no hardcoded phrasing. After "yes" → tire-173 saved with the correct 245/40R18.

And the contrast case: dictating "Michelin Pilot Sport 4S 215/65R15" (legitimate but unusual size, no catalog near-match) passed through silently in a single tool call to tire-174. No friction on real edge-case inventory.

11 unit tests on the matcher itself pass — exact match, digit typos at every position, case/whitespace normalization, unknown brand/model, empty common_sizes, length differences (LT prefix vs not). The matcher's regex is precise about what counts as a "digit typo" — same length, exactly one position differs, both characters at that position must be digits. Letter swaps (R vs Z, P prefix) don't qualify, length mismatches don't qualify. Pure single-digit substitutions only.

**The lesson worth keeping:** when validation data is incomplete, the right default is silence, not friction. The catalog's common_sizes covers maybe 40-60% of real shop inventory; flagging every non-match would mean the user gets bugged on every odd-size truck tire and old retro size. Limiting the flag to "differs by exactly one digit" cuts the false-positive rate to near zero while still catching the actual Whisper failures the feature exists to catch.
