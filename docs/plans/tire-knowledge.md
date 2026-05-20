# Plan: Tire knowledge base (catalog + fuzzy matching)

**Status:** Proposed, awaiting review
**Date:** 2026-05-20
**Sprint:** Phase A — knowledge base only. Hands-free voice (Phase B) is a separate sprint and is not included here.
**Backup tag:** `pre-tire-knowledge-2026-05-20` (already pushed to origin)

## The problem this solves

When shop staff dictate a tire into the voice chat, Whisper produces a transcript that is approximately right but often garbles brand and model names. Today's chat agent has nothing to compare those guesses against — it stores whatever string the model decided to extract. Real failures observed in the existing inventory (before today's reset): "Mishelin", "perrelli", "BFG", "puh-relli" all needed manual cleanup.

The system prompt's "be generous interpreting brand names" rule helps a little, but the model is still guessing in a vacuum. What we want is a controlled vocabulary the model can match against, with three branches:

1. **High confidence** — the canonical name substitutes silently. "Mishelin Pilot Spore for ess" becomes a `Michelin Pilot Sport 4S` insert with no extra turn.
2. **Medium confidence** — the chat agent surfaces alternates and asks the user to confirm before saving.
3. **No match** — the chat agent asks the user to spell it, then *learns* it: the new brand/model is appended to the catalog so next time it's a high-confidence match.

## Architecture at a glance

```
voice or text input
  ↓
Whisper / text → /api/chat
  ↓
model proposes add_tire({ brand: "...", model: "...", ... })
  ↓
runAddTire (server)              ← NEW LOGIC LIVES HERE
  ├─ matchBrand(input.brand)
  │     ↓
  │     high?     substitute, continue
  │     medium?   return { status: "needs_brand_confirmation", candidates }
  │     none?     return { status: "unknown_brand", original }
  │
  ├─ matchModel(brand, input.model)   (only if brand resolved)
  │     ↓
  │     same three branches
  │
  └─ supabase insert (only when both confirmed)
```

The matching is **server-side, before any Anthropic call returns** — no extra tokens spent on lookups. The model only sees results, not the catalog itself.

## File layout

| New file | Purpose |
|---|---|
| `lib/tire-catalog.json` | The catalog itself. ~30 brands, several models each, with aliases and common sizes. Source of truth. |
| `lib/tire-catalog.ts` | Loader + fuzzy match helpers (`matchBrand`, `matchModel`) + persistence helpers (`addBrandToCatalog`, `addModelToCatalog`). |

| Edited file | Change |
|---|---|
| `app/api/chat/route.ts` | `runAddTire` calls the matchers before the Supabase insert. System prompt gains rules for the new tool result statuses. |
| `docs/content-log.md` | Two entries: a brief WIP note during integration, a full entry at wrap. |
| `PROJECT_BRIEF.md` | New short section documenting the catalog. |

## Catalog JSON shape

```json
{
  "version": "0.1",
  "generated_at": "2026-05-20",
  "brands": [
    {
      "name": "Michelin",
      "aliases": ["Michellin", "Mishelin", "Mick-uh-lin"],
      "models": [
        {
          "name": "Pilot Sport 4S",
          "aliases": ["PS4S", "Pilot Sport Force"],
          "season": "summer",
          "common_sizes": ["245/40R18", "255/35R19", "265/35R20"]
        }
      ]
    }
  ]
}
```

Notes:
- `season` uses tireops's existing vocabulary plus a few new values: `summer | winter | all-season | all-weather | all-terrain | mud-terrain | performance`.
- `common_sizes` is informational only — the matcher doesn't use it yet, but it'll be useful for future "did you mean tire-size X?" suggestions.
- Aliases handle three categories of mishearing: phonetic ("Mishelin"), shorthand ("PS4S"), and Whisper-induced garbles ("Pilot Sport Force" for "Pilot Sport 4S").

## Fuzzy match approach — hand-rolled trigram similarity

Decision: **hand-rolled, not the `string-similarity` npm package.** Reasons:

- The package is tiny but it's another dependency to pin and audit. tireops's dep list is intentionally short (Supabase, Next, React, xlsx — that's it).
- Trigram similarity (Jaccard or Sørensen-Dice on character 3-grams) is ~15 lines of TypeScript. We control the behavior end-to-end.
- We need to match against *multiple* names per entry (canonical + aliases) and return the best match across all of them. That's a one-line wrapper around a similarity primitive.
- If hand-rolled performance is ever a problem (it won't be — catalog has 100s of strings, not millions), we can swap in a package later behind the same interface.

Sketch of the helper:

```ts
function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase().replace(/[^a-z0-9 ]/g, '')}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function similarity(a: string, b: string): number {
  const A = trigrams(a), B = trigrams(b);
  const inter = [...A].filter(t => B.has(t)).length;
  return (2 * inter) / (A.size + B.size); // Sørensen-Dice
}
```

For each input string, score against every canonical and alias in the catalog; return the best match plus any alternates above the threshold.

## Confidence tiers

| Tier | Score | Behavior |
|---|---|---|
| High | `> 0.85` | Use the canonical name, no user-facing prompt. Add a system note so the assistant can mention the correction in passing if it wants to. |
| Medium | `0.6 – 0.85`, OR multiple candidates above 0.6 | Don't insert. Return `status: "needs_brand_confirmation"` with up to 3 alternates and their scores. The assistant asks the user. |
| No match | `< 0.6` | Don't insert. Return `status: "unknown_brand"` (or `"unknown_model"`) with the user's original string. The assistant asks for the correct spelling, then calls `addBrandToCatalog` / `addModelToCatalog` to persist it before retrying `add_tire`. |

The two-stage flow (brand first, then model) means the model-match function always has a brand context, so "Pilot Sport" doesn't have to disambiguate between Michelin's and Continental's same-named lines.

## Integration point in app/api/chat/route.ts

`runAddTire` at line 340 is the surgical point. The current flow:
1. Build `row` from input fields
2. Insert into Supabase
3. Log activity, return result

The new flow inserts the catalog check between steps 1 and 2:

```ts
async function runAddTire(input, currentShop, userEmail, source) {
  const row = { /* same as before */ };

  // NEW: brand/model lookup
  if (typeof input.brand === 'string' && input.brand.trim()) {
    const brandResult = matchBrand(input.brand);
    if (brandResult.status === 'high') row.brand = brandResult.match;
    if (brandResult.status === 'medium') return { status: 'needs_brand_confirmation', ... };
    if (brandResult.status === 'none') return { status: 'unknown_brand', original: input.brand };
  }
  if (typeof input.model === 'string' && input.model.trim() && row.brand) {
    const modelResult = matchModel(row.brand as string, input.model);
    // same shape, same branches
  }

  // Existing: supabase insert + photos + activity log
}
```

Two new tool definitions get added to the tools array so the assistant can call:
- `confirm_brand(canonical_name)` — re-runs the add with the user-confirmed name
- `add_brand_to_catalog(name, alias?)` — persists a brand to the JSON, then asks the assistant to retry

Or — simpler — just expose `add_tire` with new optional fields `confirmed_brand` and `confirmed_model` that bypass the matcher. Plus a separate `learn_tire_term(kind, name, brand?)` tool for the persistence step. I lean toward the second shape because it keeps the destructive-action confirmation pattern clean (existing rule 9 covers add_tire confirmation; learn_tire_term is read-only-ish from the user's perspective).

System prompt additions: rules teaching the assistant to handle the three response shapes — silently accept high-confidence substitutions, prompt for medium, ask + learn for unknown. Show the diff at A3.3.

## Persistence: how the catalog grows

`lib/tire-catalog.json` is a regular file in the repo. Writes happen via Node's `fs/promises` writeFile in the server route handler. Once the dev server is running on Vercel, this becomes problematic — Vercel's filesystem is read-only at runtime.

Two options for the persistence layer:

1. **Local-only growth, manual commit.** Writes work in development; on Vercel they no-op (or throw). The catalog grows on the developer's laptop, and growth gets committed to git like any other change. Pro: dead simple, no new infra. Con: real shop usage on Vercel can't teach the catalog.
2. **Supabase-backed.** A new `tire_catalog` table mirrors the JSON. JSON in the repo is the seed; runtime additions go to Supabase. Pro: works in prod. Con: adds a table to the schema, which the prompt explicitly says NOT to touch this sprint.

Decision: **Option 1 for this sprint.** Don't touch Supabase. The growth pattern is "local dev sessions reveal new brands → developer commits the JSON → deploy." That's fine while inventory is being built up. If/when high-volume Vercel-side growth becomes a need, migrate to option 2 as a separate sprint.

## Testing strategy

Three smoke-test scenarios required by the prompt:

1. **High confidence path:** ask the chat agent to "add a Michelin Pilot Sport 4S" (or similar exact-from-catalog phrasing). Expect: row inserted, brand stored as canonical name, no confirmation turn.
2. **Medium confidence path:** ask to "add a Michellin pilot sport force." Expect: tool returns `needs_brand_confirmation` (or `_model_`), assistant relays alternates and waits for user.
3. **Unknown brand:** "add a Fakebrand SuperTire." Expect: tool returns `unknown_brand`, assistant asks for spelling, user confirms, `addBrandToCatalog` persists, retry succeeds, JSON file gets the new entry.

Verification after the test:
- `lib/tire-catalog.json` should have an extra brand entry from test 3.
- The `tires` table should have exactly the rows the high-confidence test added (i.e., 1 new row — the medium and unknown tests don't insert until confirmed; if confirmed, those count too).
- The pre-existing 22 inventory entries are untouched. Verify by counting rows and spot-checking 2–3 rows.

If any test fails or behaves unexpectedly, stop and report (per the prompt's "don't fix on the fly" rule).

## Rollback plan

If anything goes wrong at any phase:

```bash
git reset --hard pre-tire-knowledge-2026-05-20
```

That tag is already pushed to origin. It restores every file in the repo to the pre-sprint state. Re-running `npm run dev` after the reset returns the app to today's working state. No Supabase changes happen this sprint (we promised), so the database doesn't need touching.

If a partial state is committed and needs to be discarded, the reset also handles it.

## Out of scope (do NOT do in this sprint)

- Hands-free voice (Phase B — separate sprint).
- Supabase schema changes — none. The catalog lives in the repo, not the database.
- Refactoring the existing chat route beyond the surgical edit in `runAddTire` and the system-prompt additions.
- Coverage for tire *sizes* — `common_sizes` is recorded but not used for matching this sprint.
- Migration of the catalog to Supabase for Vercel-side growth.

## Estimated effort

| Phase | Estimate |
|---|---|
| A1 catalog generation | 20–30 min (the catalog content is the bulk of it) |
| A2 matcher + smoke tests | 20 min |
| A3 integration + system prompt | 30 min |
| A4 testing | 15 min (depends on dev server) |
| A5 wrap-up | 15 min |
| **Total** | **~2 hours of work**, gated turn-by-turn |
