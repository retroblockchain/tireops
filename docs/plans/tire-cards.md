# Plan: Tire preview cards inline in chat search results

**Status:** Proposed, awaiting review. Plan-only sprint.
**Date:** 2026-05-22
**Backup tag:** `pre-tire-cards-2026-05-22` (pushed to origin)
**Rollback:** `git reset --hard pre-tire-cards-2026-05-22`

## The problem this solves

When you ask the chat agent "do we have any 225/65R17 winter?" it currently returns a text reply describing what it found — "we have 4 sets, 2 Michelins and 2 Continentals". That's accurate but text-heavy and loses the visual scanability of a tire card (badge, brand/model/size, condition, price, etc). The dashboard's "Recently added" surface and `/inventory` both render real tire cards with photos and pills; the chat doesn't.

After this sprint: when `search_tires` returns rows, the chat renders them as `TireCard`s right under the AI's reply, identical visual style to the dashboard cards. The agent's text becomes shorter — a one-liner summary — because the cards do the visual work.

## What this is NOT

- **Not** an edit-from-card flow. Tapping a card navigates to `/edit/{id}` (the existing detail+edit page). No inline edit, no swipe actions.
- **Not** pagination. If 30 tires come back, all 30 cards render. If long-results UX becomes a real complaint, that's a future sprint.
- **Not** a redesign of `TireCard`. We reuse the existing component as-is.
- **Not** photos in Phase 1. The card has space for a thumbnail but we won't fetch them from the chat in the first version. Photos in a future iteration.
- **Not** cards for any tool other than `search_tires`. `add_tire` already has the recent-adds pill from the Phase 2 smarter-chat sprint; `update_tire` / `delete_tire` results are confirmations, not browsing surfaces.
- **Not** a side panel or separate results view. Cards stay inline in the chat message bubble for mobile compatibility.

## What I discovered while researching

| | |
|---|---|
| **`TireCard` component** | Already exists at `app/components/TireCard.tsx`. Takes `tire` (full row shape) + optional `thumbUrl`. Already styled with shop badge, size headline, brand/model, status/season/location/condition pills, qty + price. Already links to `/edit/{id}` on tap. **We don't need to build this; we reuse it.** |
| **Chat state structure** | Two parallel states in `VoiceChat.tsx`: `apiMessages` holds the full ContentBlock structure with tool_use + tool_result blocks; `uiMessages` holds the rendered-to-user view as `{ role, text, attachmentName? }`. The rendered view currently flattens tool results away — the user sees only the AI's natural-language reply. |
| **Where messages render** | `VoiceChat.tsx` line ~1103, `uiMessages.map(...)`. Each `UiMsg` becomes a chat bubble. |
| **What needs to change** | Augment `UiMsg` to optionally carry tire-card data. When a `search_tires` tool_result streams in, parse the rows and attach them to the assistant's `UiMsg`. At render time, the assistant bubble shows text + cards. Old messages in sessionStorage without the new field still render fine (text only) — fully backward-compatible. |
| **No backend changes required** | The chat route already streams `search_tires` results as JSON inside `tool_result.content`. The data is there; we just start surfacing it. |

## File layout

| File | Change |
|---|---|
| `app/components/TireCard.tsx` | **No change.** Used as-is. |
| `app/components/VoiceChat.tsx` | Augment `UiMsg` with optional `cards?: Tire[]` field. In the stream handler, when a `tool_result` for `search_tires` arrives, parse its content JSON and attach `rows` (up to a reasonable cap) to the most recent assistant `UiMsg`. In the render loop, when `m.cards?.length > 0`, render `<TireCard>` for each below the message text. |
| `app/api/chat/route.ts` | One small system-prompt change: when `search_tires` returns rows, the AI's reply should be brief because cards handle the visual ("Found 4 winter tires in your size — see below.") rather than enumerating every row in text. Rule extension, not rewrite. |
| `docs/content-log.md` | Wrap-up entry after the sprint. |

## Where the cards appear in the bubble

For each assistant message with cards:

```
┌───────────────────────────────────────────┐
│  Found 4 winter tires in 225/65R17 —      │ ← AI's brief text reply
│  see below.                                │
│                                            │
│  ┌────────────────────────────────────┐   │ ← card 1
│  │ [Mission]              tire-141 ›  │   │
│  │ 225/65R17                          │   │
│  │ Michelin X-Ice                     │   │
│  │ [winter] [new]      qty 4    $200  │   │
│  └────────────────────────────────────┘   │
│                                            │
│  ┌────────────────────────────────────┐   │ ← card 2
│  │ ...                                 │   │
│  └────────────────────────────────────┘   │
└───────────────────────────────────────────┘
```

Single-column stack on both mobile and desktop (chat container is 600px wide; cards fill the width like they do on the dashboard). Same TireCard styling everywhere, so the visual rhythm of `/inventory`, `/sold`, the dashboard's "Recently added", and the chat all match.

## Card fields (already in TireCard, no design needed)

The existing TireCard already displays everything you'd want on a preview:

- Shop badge (red pill, top-left)
- Tire number (`tire-141`) + chevron (top-right, indicates tappable)
- Size (large, headline)
- Brand + model (subtitle, muted)
- Status pill (only shows when status != 'available' — sold/reserved/pending)
- Stale indicator (only when in stock > N days)
- Season pill
- Location pill
- Condition pill (new = filled dark, used = outline)
- Qty + price (right-aligned, bottom row)

No new fields needed.

## What changes in the AI's behavior

When `search_tires` returns rows AND the chat surface is the in-app voice chat (not the CRM integration endpoint), the agent should keep its text short — a one-line summary count + a "see below" or "see the cards" pointer. The rows are visible as cards, so enumerating them in prose duplicates work and clutters the conversation.

Counter-example to be careful about: the CRM integration endpoint (`/api/integration/inventory`) goes through the same chat handler but the consumer is a different agent / different UX. The integration consumer doesn't render cards — it surfaces the agent's text directly to a customer-facing email reply. So the agent needs to still produce a useful natural-language description when the request came in via integration.

**Proposed rule:** add to rule 2 (the search rule) something like: "When you receive search_tires results AND you're answering the in-app voice chat (signal: the request has currentShop / currentUserEmail consistent with shop-floor staff), keep your text response brief — the client renders cards visually below your reply, so listing every row in text is redundant. A one-line summary count is enough. When you're answering via the CRM integration endpoint (signal: currentUserEmail is the crm-integration@... address), continue to enumerate rows in text since the consumer doesn't render cards."

The `currentUserEmail = 'crm-integration@buyselltires.local'` is set by `app/api/integration/inventory/route.ts` — so the agent can distinguish the two surfaces by sniffing that.

Open consideration: is the distinction clean enough? An alternative is to always-be-brief in the chat surface and let the CRM-side handle its own enrichment. For Phase 1 I'd take the simpler approach: agent stays brief for both surfaces. The CRM agent can still produce a "we have 4 sets, here are the closest" summary; it just doesn't enumerate every row. That's cleaner than asking the agent to detect its own surface.

## Edge cases

| Case | Behavior |
|---|---|
| `search_tires` returns zero rows | No cards rendered. AI's text reply + the broaden-and-suggest behavior from rule 6 (smarter-chat 5.A) handles it. |
| Search returns > 10 rows | All cards render. Long scroll. **No pagination in Phase 1.** Note the limit param in search_tires already caps at 100 by default; the AI typically uses limit=20. If real shop use shows 20-result responses are too long, we add pagination later. |
| Search returns rows but the tool_result JSON is malformed (rare) | Parse fails silently, no cards rendered, AI's text still shows. Fail-safe. |
| Old message in sessionStorage (no `cards` field) | Renders text-only as before. Backward-compatible by design. |
| Tap a card while a new message is streaming | Standard `<a href>` navigation; chat state persists in sessionStorage so user comes back to the same conversation. Same as existing dashboard `<TireCard>` behavior. |
| Multiple search_tires calls in one assistant turn | The tool-loop in the chat route can call search_tires multiple times before producing final text. Each call produces its own tool_result. We attach cards from the LAST search_tires result (most relevant to the user's final question), not concatenate all of them. |
| Cards in mobile portrait | Existing TireCard already works at narrow widths — used on the dashboard at 360px. No change needed. |

## Implementation order

| Step | What | Effort |
|---|---|---|
| A | **Backend: no change.** Tool result data is already in the stream. Skip. | — |
| B | **Augment `UiMsg` and the parse-on-tool-result logic** in `VoiceChat.tsx`. Add `cards?: Tire[]` to the type; in the NDJSON stream handler, when an `end` event delivers messages, walk back through the new turns looking for the most recent `search_tires` tool_use + matching tool_result; parse `rows` from the result content; attach to the matching assistant `UiMsg`. About 30 lines of code. | **S** |
| C | **Render cards in the chat bubble** below the AI text. Inside `uiMessages.map(...)`, when `m.role === 'assistant' && m.cards && m.cards.length > 0`, render `{m.cards.map(t => <TireCard tire={t} />)}`. About 5 lines added. | **XS** |
| D | **Update rule 2** in the system prompt for brief replies when cards do the visual work. About 60 words added to the rule. | **XS** |
| E | **Live test** end-to-end: search, observe cards render with correct data, confirm tap navigates to `/edit/{id}`, confirm cards persist across page navigation (via sessionStorage), confirm zero-result and error states behave. | **S** |

**Total: about 1 hour of focused work.** Most of the design effort happened in earlier sprints (TireCard already exists, dashboard already shows cards, etc.) — this is a wiring sprint.

## Anti-patterns — things to NOT build

| Don't | Why |
|---|---|
| Edit from card | Out of scope. Cards link to `/edit/{id}` for that. |
| Inline price-change widget | Editable widgets in chat history desync from DB state and become misleading. Use the edit page. |
| Swipe-to-delete on cards | Destructive actions need confirmation. Use the chat agent's delete flow (separate-turn confirmation). |
| Photos in Phase 1 | Adds a Supabase fetch per search, complicates the parse path. Ship cards without thumbnails first; add photos as a small follow-up if useful. |
| Separate "search results panel" | Sidebar/drawer UIs break mobile portrait. Cards stay inline. |
| Cards for `add_tire` results | Already covered by the recent-adds pill strip (smarter-chat Phase 2). |
| Custom layouts per result count (e.g. grid for many, list for few) | Adds complexity. Single-column stack is fine at 600px chat width. |
| Pagination | Premature optimization. Wait for evidence. |

## Risks

| Risk | Mitigation |
|---|---|
| Parsing tool_result JSON fails on edge content | Wrap in try/catch; fail to no-cards rather than blow up. Same pattern as the recent-adds pill's parse loop. |
| sessionStorage size grows because each `UiMsg` carries card data | Cards are small JSON. 20 tires × ~10 fields each ≈ 5 KB per result. Multiple searches in a session add up to maybe 50-100 KB. Still well under any browser sessionStorage limit (typically 5-10 MB). Acceptable. |
| AI's brief text rule misfires for the CRM integration path | The integration receives the AI's text directly — if the agent says "see below" but the CRM consumer doesn't render cards, customers get a useless reply. The proposed rule keeps the agent brief for both surfaces but doesn't require text-only enumeration. CRM-side enrichment can compensate if needed in a future sprint. |
| TireCard's `<a href>` from inside chat does a full-page navigation, losing chat scroll position | Existing pattern (the recent-adds pill also uses `<a href>`). sessionStorage preserves the conversation across the round-trip; the user comes back to the same place. |
| Streaming order: tool_result arrives before the AI's text reply | The card-attach logic runs at `end` event time, after the full message is constructed. By then, both the tool_result and the assistant's text are present. No race. |

## Style consistency

The cards in chat will be visually identical to:
- Dashboard "Recently added" cards (`app/page.tsx` uses `<TireCard>`)
- `/inventory` cards (likely uses `<TireCard>` — verify in Step B)
- `/sold` cards (same)

If `TireCard` is ever updated (e.g., new pill, new field), all surfaces benefit at once. Single source of truth, by design.

## Open questions to answer before Step B

(All have defaults; flag if you'd change them.)

- **Render all rows from the search, or cap at some max in the cards?** My default: render whatever the AI's `search_tires` call returned (typically capped at 20 by the agent already; the tool defaults to limit=20). If a search explicitly returns 100 rows, render 100 cards. Document "long scroll" as known and revisit if it bothers in real use.

- **Should the agent's text "see below" be literal, or should the rule just say "be brief"?** My default: rule says "be brief, the client renders cards." Don't prescribe specific wording — the agent will pick something natural like "here are the matches", "see below", "scroll for details", whichever fits.

- **What happens when no rows are returned, but the agent still wants to suggest alternatives (rule 6 zero-result broaden)?** My default: the alternative search ALSO produces a tool_result with rows. Those rows become cards. So zero-result-with-alternatives still ends up with cards rendered — the alternatives, not the original empty search. Natural fit.

## Rollback plan

```bash
git reset --hard pre-tire-cards-2026-05-22
```

Tag pushed to origin. No DB changes in this sprint, so rollback is just code.
