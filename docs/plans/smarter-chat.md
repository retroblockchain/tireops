# Plan: Smarter chat — improving the tap-to-record + catalog flow

**Status:** Plan only, awaiting your pick
**Date:** 2026-05-21
**Background:** Hands-free voice (B1/B2/B3.2) is shipped to dormant — see `docs/plans/handsfree-b3.md`. The chat agent + tire-catalog flow from `c01e01e` is the daily-driver surface. This plan surveys what could make it smarter without overengineering.

## What we're doing here

Tap-to-record + the fuzzy catalog matcher is working in real shop use — 22+ tires entered, catalog grew from 39 to 40 brands with one user-confirmed learn. The system prompt is 16 rules deep and well-tuned. But there are concrete moments where the chat feels dumber than it could be, and a few of those are very cheap to fix.

This plan surveys seven categories of "smarter," ranks the candidates by leverage, and picks the order I'd suggest. **Pick from this — don't merge it all.**

## What we're explicitly NOT doing

- **Not** building hands-free voice. The B2 button stays visible-but-dormant; revisit when there's a real pain point.
- **Not** doing database migrations unless the payoff is clearly worth it.
- **Not** replacing the conversational pattern with a form wizard. The chat is the product.
- **Not** adding tools just because the agent could be "smarter" — every tool adds misfire surface.
- **Not** breaking tap-to-record or the catalog confirmation flow from `c01e01e`.

---

## Category 1 — Smarter catalog matching

### Current behavior

The catalog matcher (`lib/tire-catalog.ts`) scores brand and model names against canonical + alias lists using Sørensen-Dice trigram similarity. **It doesn't use `common_sizes` at all** — the field exists in `lib/tire-catalog.json` (1,075 size entries across 215 models) but is purely informational metadata today.

### Concrete improvements

| # | Idea | Effort | Impact | Depends on |
|---|---|---|---|---|
| 1.A | **Validate against `common_sizes`.** When saving a tire with `brand=Michelin, model=Pilot Sport 4S, size=215/65R15`, check that 215/65R15 appears in the catalog's `common_sizes` for that model. If not, return a `needs_size_confirmation` status — the agent asks "215/65R15 is unusual for a Pilot Sport 4S, did you mean 245/40R18?" | **S** | **Medium** | Reuses the existing catalog flow; just add a third matcher tier |
| 1.B | **Nearest-size suggestion on garbles.** If user says "245/40R88" (Whisper digit error), check the model's `common_sizes` for the closest match — likely "245/40R18". If a single close candidate exists, auto-suggest. | **M** | **High** | Builds on 1.A. Small Levenshtein/edit-distance helper on size strings |
| 1.C | **Learn from your actual inventory.** Augment the catalog's `common_sizes` with shop-specific frequency data — every time a Bridgestone Blizzak WS90 gets added in 215/55R17, increment a counter. Over time, "your shop's common sizes" beat the generic catalog seed. | **L** | **Medium** | New persistence layer (either grow the JSON or add a small Supabase table). Long tail of usage data before it pays off |

**Risk:** 1.A surface friction. If the `common_sizes` list is incomplete, false positives ("215/55R17 is unusual...") become annoying. Mitigation: start with a HIGH similarity threshold (only flag clearly suspect combos), and treat the prompt as "double-check, not blocker."

---

## Category 2 — Smarter handling of partial / messy entries

### Current behavior

Rule 3 of the system prompt says: "if a critical identifying field is missing (size or brand) AND the user seems done giving info, ask ONE focused question." So the agent already partly does this — but only for size + brand. Quantity, condition, price, season all get saved as null with a passing "you can fill these in later" mention. No active follow-up.

### Concrete improvements

| # | Idea | Effort | Impact | Depends on |
|---|---|---|---|---|
| 2.A | **Extend the conversational fill-in.** Add quantity to the "critical fields to ask about" list. "How many tires is that — a set of four?" before saving. Tone stays brief; one question at a time. Prompt-only change. | **S** | **High** | None — pure prompt edit |
| 2.B | **Parse extras into `notes`.** When user says "set of 4, customer John's tires" — split: `quantity:4`, `notes:"Customer John's tires"`. Prompt rule teaching the agent to route stray context into `notes`. | **S** | **Medium** | None — pure prompt edit |
| 2.C | **Disambiguate vague quantity.** "a bunch" / "a few" / "some" → ask for a number. "a set" → ask "set of 2 or 4?". Prompt rule. | **S** | **Medium** | None — pure prompt edit |

**All three of these are prompt-only edits.** No code, no schema changes. Combined ~15 minutes of work. The agent already has the conversational machinery — we're just giving it more rules to apply.

---

## Category 3 — Smarter context across entries

### Current behavior

Each chat turn is independent from the agent's point of view, except that the last 12 turns are in its context (the `MAX_HISTORY_TURNS = 12` cap). The agent CAN see the last 12 user/assistant turns and could in principle reason "the last tire was a Bridgestone, this 'and another one in 215/55R17' refers to that." But the system prompt doesn't tell it to. There's no UI scaffolding showing the previous entry.

### Concrete improvements

| # | Idea | Effort | Impact | Depends on |
|---|---|---|---|---|
| 3.A | **"Previous tire" pill in the chat UI.** Small horizontal strip above the chat input showing the last 1–3 tires added in this session ("tire-141 Bridgestone Blizzak WS90 215/55R17"). Tappable to view details. Purely UI; gives the user a visual anchor and primes the agent (since the previous tire is already in its context). | **S** | **Medium-High** | None — pure UI add in VoiceChat |
| 3.B | **"Same as last" inference rule.** Prompt rule: "if user starts a new entry with only some fields, and the previous entry was an add_tire, infer missing brand/model/size from that previous entry — but confirm before saving." Caveat: confirmation prevents wrong-tire bugs. | **S** | **High** | 3.A makes this user-visible; the rule itself is prompt-only |
| 3.C | **"And another one in X" reference parsing.** Prompt rule: "phrases like 'another one in 215/55R17' or 'same but a pair' refer to the previous tire — copy brand/model from it, override the named field." | **S** | **High** | Subset of 3.B; same prompt edit |

**Risk:** 3.B + 3.C can misfire if the user adds a tire and then asks an unrelated question — the agent might try to "fill in" from the wrong context. Mitigation: only apply when the user's turn looks like a new add (begins with "add", "another", "same", or contains a size/quantity).

---

## Category 4 — Smarter database operations via chat

### Current behavior

Single-row tools: `search_tires`, `add_tire`, `update_tire` (one tire), `delete_tire` (one tire). For bulk operations the agent has to loop, which means N rounds of confirmation. There's no natural-language reporting beyond `search_tires` returning rows.

### Concrete improvements

| # | Idea | Effort | Impact | Depends on |
|---|---|---|---|---|
| 4.A | **Natural-language reports.** "How many summer tires under 17 inch?" → use `search_tires` with filters, count, report. Prompt rule teaching the agent to *summarize* instead of listing when the question is a count. | **S** | **Low-Medium** | None — pure prompt rule. Agent already has search_tires |
| 4.B | **Bulk update tool.** New `bulk_update_tires({ ids, patch })` with strict confirmation ("I'll change status to SOLD on these 5 tires: ... Confirm?"). | **M** | **Medium** | New tool; destructive — careful confirmation rules |
| 4.C | **Bulk delete tool.** Same pattern as 4.B but for deletes. | **M** | **Medium** | Higher risk than 4.B since irreversible. Recommend NOT building. |

**Strong recommendation: skip 4.C.** A delete-loop-via-chat is a foot-cannon for a shop staff member misinterpreting a sentence. The cost of "I'll delete each one by name in sequence" via the single `delete_tire` tool with confirmation per row is annoying but appropriate friction.

---

## Category 5 — Smarter CRM integration

### Current behavior

`POST /api/integration/inventory` exists and delegates to `/api/chat`. The CRM can ask "do you have any 225/65R17 winter tires?" and get a streamed natural answer. When the search comes up empty, the agent says "no results" plainly (rule 6 of the system prompt prevents inventing alternatives).

### Concrete improvements

| # | Idea | Effort | Impact | Depends on |
|---|---|---|---|---|
| 5.A | **Context-rich "no results."** When search_tires returns 0 and the question came from the integration endpoint, run a broader follow-up search (drop the size, drop the season) and offer the closest alternatives. "No 225/65R17 winter — we have 225/60R17 winter and 235/65R17 winter, want either?" | **M** | **High for CRM users; nil for direct chat** | Builds on existing search_tires + a prompt rule scoped to the integration path |
| 5.B | **Track "wanted but missing."** When the integration endpoint returns 0 results, log the query into `activity_log` with `source='ask_inventory_miss'`. Reuses the existing table; no migration. Eventually surfaceable as a "what customers want that you don't carry" report. | **S** | **Low-Medium** | activity_log already has the right columns; just need a route hook |
| 5.C | **"Wanted tires" widget on the dashboard.** Build on 5.B — show top 5 wanted-but-missing sizes/brands in the last 30 days. Shop owner sees a real demand signal. | **M** | **Medium** | Needs 5.B first |

---

## Category 6 — Smarter understanding of intent

### Current behavior

The system prompt's rules cover ADD (rule 3), question/search (rule 2), and three destructive operations (rules 7, 12, 14). It does NOT have a rule for **corrections after a save**. If the user says "Add a Michelin Pilot Sport 4S, 215/55R17, set of four, done" → tire-150 inserted → "actually that was 225 not 215", the agent might create a new tire instead of updating tire-150.

### Concrete improvements

| # | Idea | Effort | Impact | Depends on |
|---|---|---|---|---|
| 6.A | **Correction-after-add rule.** Add to the system prompt: "if the user's next turn after a tool result of `add_tire` looks like a correction ('actually...', 'I meant...', 'no, that was...', 'change that to...'), call `update_tire` on the just-inserted tire's id rather than treating as a new entry. Confirm with the user briefly: 'Got it — updating tire-150 from 215 to 225, confirm?' if it's a non-trivial change." | **S** | **Very High** | None — pure prompt rule. **The single highest-leverage tweak in the survey.** |
| 6.B | **Confidence-tier behavior for ambiguous parses.** The catalog already does this for brand/model. Extend the pattern to other parses — "eight thirty-seconds" (tread 8 or 80%?), "a pair of new ones" (qty 2?), "the warehouse one" (location reference?). For each, the agent picks a confidence and either acts / confirms / asks based on it. | **M** | **Medium-High** | None — prompt rule, but more involved to write |
| 6.C | **Self-correction-in-tool-call awareness.** The agent already handles mid-utterance self-corrections (e.g. "two twenty-five — wait, two thirty-five sixty-five seventeen"). Tighten this with explicit examples in the system prompt. | **S** | **Low** | Prompt edit |

**6.A is the highest-leverage prompt edit in this entire plan.** Estimated 10-minute change, saves an annoying recovery dance on every typo-or-rethink moment of every day.

---

## Category 7 — Things I observed that aren't in your list

Reading through `app/api/chat/route.ts` and the system prompt, three additional opportunities surfaced:

| # | Idea | Effort | Impact | Depends on |
|---|---|---|---|---|
| 7.A | **Undo last action tool.** New `undo_last_action` tool: looks up the user's most recent add/update/delete in `activity_log` from the last ~5 minutes and reverses it. Friction-saving safety net. "Undo" or "scratch that last one" → agent calls the tool, confirms, done. | **M** | **Medium-High** | New tool + a small server function that reads activity_log and reverses. Adds destructive surface so needs solid confirmation |
| 7.B | **Sticky session shop override.** Currently the agent has to pass `shop` on every `add_tire` when the user is entering for a non-default shop ("doing the Lethbridge container today"). A small UI control to override the session-scoped default shop would eliminate per-tire boilerplate. | **S** | **Low-Medium** | UI add to VoiceChat; chat endpoint already accepts `currentShop` in the body |
| 7.C | **Clean up the system-prompt rule numbering.** Rules currently skip 8 and 11 from earlier edits. Aesthetic — but a clean numbered list helps when adding new rules. | **S** | **Negligible** | Pure cosmetic |

**Other observations (worth noting, not yet building):**

- `MAX_HISTORY_TURNS = 12` is fine for single conversations but can drop early context in a long batch session. If batch entry sessions ever feel "forgetful," that's the knob.
- The catalog's `common_sizes` field is unused metadata today (highlighted in Category 1).
- Auto-TTS on every assistant reply was a request the owner made elsewhere (suppress during hands-free). For non-hands-free, the TTS sometimes overlaps with the user dictating the next tire. Worth a toggle.

---

## Recommended top 5 — in order

These are the picks I'd build first, ranked by leverage-per-hour. **All five could ship in a single afternoon.**

| # | Improvement | Effort | Impact | One-line rationale |
|---|---|---|---|---|
| **1** | **6.A — Correction-after-add rule** | S | Very High | Prompt-only fix for a daily annoyance. Almost free. |
| **2** | **2.A + 2.B + 2.C — Conversational fill-in, notes routing, quantity disambiguation** | S each, ~15 min total | High | Bundled prompt edits that smooth every tire entry. No new code. |
| **3** | **3.A — Previous-tire pill in UI** | S | Medium-High | Visual anchor that primes the user AND the agent for cross-entry context. |
| **4** | **3.B + 3.C — Same-as-last inference + "and another one" parsing** | S | High | Prompt rules that exploit the UI from #3. Builds on top of it. |
| **5** | **1.A — Common-sizes validation** | S | Medium | Catches Whisper digit-garble cases and the occasional human typo. Uses metadata that already exists. |

**Notable runners-up not in the top 5:**

- 7.A (undo) — strong utility but adds a destructive tool; needs confirmation patterns done carefully. Save for a separate sprint focused on safety nets.
- 5.A (CRM context-rich no-results) — high impact for the CRM-side flow but only matters once CRM integration sees real traffic. Defer until CRM-side use grows.
- 6.B (confidence-tier behavior generally) — good idea but harder to write a robust prompt for; the catalog's existing three-tier flow does the heavy lifting where it's most needed.

## Quick wins (each <1 hour, almost zero risk)

You could ship these in a single morning before considering anything bigger:

| Quick win | Time | What it does |
|---|---|---|
| 6.A — Correction-after-add | 10 min | Add one rule (rule 17) to the system prompt about treating "actually..." as an update intent |
| 2.A — Quantity in fill-in | 5 min | Extend rule 3's "critical fields" list to include quantity |
| 2.B — Notes routing | 5 min | Prompt rule: stray context goes in `notes` |
| 2.C — Quantity disambiguation | 5 min | Prompt rule: "a bunch" → ask for number |
| 4.A — Natural-language reports | 5 min | Prompt rule: count, don't list, when the question is "how many" |
| 7.C — Renumber the rules | 10 min | Cosmetic but tidy |

**Total: ~40 minutes for six quick wins.** Then commit, smoke-test, decide what's next.

## Anti-patterns — things to NOT build

| Avoid | Why |
|---|---|
| **Bulk delete via natural language** | One misheard sentence could wipe inventory. The current "delete one at a time with confirmation" is correct friction. |
| **A form-filling wizard mode** | The chat IS the product. A wizard mode hides the conversational model the user has trained on. |
| **An intent-classifier preprocessing step** | The agent already does this implicitly. Adding an explicit `[INTENT: ADD]` step adds a token tax and a misclassification surface. |
| **Aggressive auto-fill that doesn't confirm** | The system's current conservative posture (e.g., always confirm catalog substitutions if they differ) is what makes it trustworthy. Don't trade trust for speed. |
| **Wake-word detection** | Out of scope; tap-to-start is the right design. |
| **A new tool just because "the agent could be smarter"** | Every tool is a chance for the agent to misfire. New tools must clear a high bar of "this directly solves a felt pain." |
| **Caching previous search results client-side for "instant" recall** | Sounds smart, ends up showing stale data. Search the DB each time. |
| **Pre-summarization of long batches** | If a session gets so long that context drops, `MAX_HISTORY_TURNS` is the knob to tune, not a summarization layer. |

## Open questions before picking

- **6.A correction window** — when should "actually..." be treated as a correction vs. a new entry? My default: within 30 seconds of the last `add_tire` tool result, or while the chat has no intervening user turn. Tunable.
- **3.A pill — top of chat or below the input?** My default: above the input, at the bottom of the chat scroll, so it's visible when you're about to type/dictate.
- **1.A threshold strictness** — how unusual does a size need to be before flagging? My default: only flag when the user-given size isn't in the model's `common_sizes` list AND no `common_size` differs from it by ≤1 digit (which would suggest a typo). Otherwise silent.
- **Anything I'm missing?** This survey is grounded in the current codebase, but if you've hit a pain point I didn't list, name it — easier to add to the plan than to discover mid-build.

## What's NOT in this plan

- Rich tire imagery / photo recognition / OCR off photos
- An admin dashboard with charts
- A mobile-first responsive layout pass
- Multi-language support
- TTS voice options / TTS toggle UI (probably worth a separate tiny sprint)
- Anything CRM-side (that's the CRM Claude Code's job)

## How I'd approach the execution sprint

When you pick from the top 5 (or quick wins), I'd suggest:

1. **Bundle all the prompt-only changes into one commit.** They're independent, all touching the same file, all low-risk. Easy to revert as a unit.
2. **Test the highest-stakes one first.** 6.A (correction-after-add) is most likely to misfire — test with a couple of real corrections before considering it shipped.
3. **Stop and live-test between prompt-only and UI changes.** Prompt-only changes ship instantly; UI changes (3.A) need a deploy. Don't mix them in one push.
4. **Update the content log as a quick-wins narrative.** "Five prompt rules in 40 minutes made the chat noticeably smarter" is great build-in-public material.

Estimated end-to-end execution sprint:

| Step | Time |
|---|---|
| Quick wins commit (6.A, 2.A, 2.B, 2.C, 4.A, 7.C) | 1 hr including a few real chat tests |
| 3.A previous-tire pill UI | 1 hr |
| 3.B + 3.C prompt rules to use 3.A | 30 min |
| 1.A common-sizes validation in `lib/tire-catalog.ts` + new tool result status | 1.5 hr |
| Content-log entry + brief update + commit | 30 min |
| **Total** | **~4.5 hours of focused work** |
