# 0006 — Truck-tire fields, wipe approach, text-only mode, speed audit

## Context

Four loosely-related improvements bundled into one arc, with one big destructive operation (an inventory wipe) gated behind a safety tag and a script that does not auto-run.

## Decisions

### 1. Truck-tire fields: `service_type` + `load_range`

Added two nullable TEXT columns to `tires`. `service_type` holds `P` or `LT` (passenger / light truck). `load_range` holds a single letter (`B` = 4-ply, `C` = 6, `D` = 8, `E` = 10, `F` = 12, etc.) — the modern letter form of the old "ply rating." Stored as the letter; displayed alongside the ply equivalent (`E (10-ply)`) in `formatLoadRange()`. The audit showed `brand` already existed in the schema and was already surfaced on cards and in search, so the new column count is two, not three.

Wired into all four write paths (add_tire tool, update_tire tool, manual add form, manual edit form) on day one — no asymmetric validation, no "we'll add the other paths later." Display lives in `TireCard` (LT pill + load-range pill) and the manual forms (ply equivalent under the input).

**Explicitly not wired** into any price/comp logic. The columns are display-only for now. They become matching criteria later, alongside the planned price-anchor feature, once enough truck tires exist in the data to make matching meaningful.

### 2. Wipe-inventory script

Destructive — clears every row from `tires` plus the dependent `tire_photos`. Built behind three safety layers:

- **Git tag `pre-brand-and-wipe`** snapshots the code state from before this arc (commit `7135dd1`) so the app can be reverted if needed.
- **JSON backup** to `backups/inventory-<ISO-ts>.json` is dumped BEFORE deleting any rows. The wipe is recoverable from this file (hand-write an import or one-off SQL).
- **`--confirm` flag required.** Without it, the script just prints the row count.

The script is committed but NOT run. The owner runs it manually when ready.

### 3. Text-only mode

A single toggle, persisted in `localStorage` as `bs-text-only`. When on:
- Mic button is hidden from the chat footer.
- `startRecording()` bails before calling `getUserMedia`.
- `transcribeAndSend()` bails defensively before calling `/api/transcribe` (so no Whisper invocation fires).
- TTS `speak()` is skipped at stream-end (so no `/api/speak` call fires).

Toggling on also stops any in-flight TTS playback. Setting is per-device, not synced across devices — appropriate for a per-shop preference.

### 4. Speed + credit-leak audit

Audited the chat pipeline. Findings:

- **History is already capped** at `MAX_HISTORY_TURNS = 40` via `buildRequestMessages()` on every Anthropic call. Not unbounded; not a credit leak. The 40-turn ceiling is intentional from the smarter-chat sprint (content-log 2026-05-21) and supports long batch sessions; not reduced.
- **Prompt caching is already on** (`cache_control: ephemeral` on the system block) — confirmed cost drop in the original guardrails sprint. No change.
- **`max_tokens = 600`** per call is reasonable for the tool-loop pattern.
- **No duplicate/parallel calls** per turn. The tool loop is strictly sequential.

**Action taken:** added timing logs around all three external boundaries so latency surfaces in Vercel logs:
- `[timing] whisper ok in <ms>`
- `[timing] anthropic step <n> in <ms> (history=<n> msgs, tools_used=<n>)`
- `[timing] anthropic turn total <ms> (<n> steps)`
- `[timing] tts first-byte in <ms> (<n> chars)`

No risky fixes applied. Nothing left in a "we should change this but I'm not sure" state.

## Mobile chat overflow

Side fix in the same arc. The embedded chat could push past the viewport on narrow phones (≤390px) when a bubble contained long unbreakable strings. Already had `overflowWrap: 'anywhere'`; the missing piece was `overflowX: 'hidden'` + `minWidth: 0` on the embedded body wrapper and scroll container, so the bubble's 82% width is measured against the parent rather than its natural content width. Tested implicitly via the typecheck and the same-page render; not a UI test.

## Deferred

- Apply `scripts/add-truck-tire-fields.sql` in Supabase (owner action — requires service role).
- Run `scripts/wipe-inventory.ts --confirm` (owner action, when ready).
- Verify timing logs in Vercel after a few real chats; consider widening any boundary that shows up as a routine outlier.
