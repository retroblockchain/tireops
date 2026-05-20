# tireops — Project Brief

A handoff document for another LLM (or developer) picking up this codebase. Comprehensive, current as of 2026-05-19.

---

## 1. Product Mission

**tireops** is a voice-first inventory management system for BuySellTires shops. Shop staff manage tire stock primarily by **talking to an AI assistant** rather than filling out forms — adding new tires, searching for matches by size/season/brand, updating prices, and tracking what's sold or stale.

**Real value proposition:** Replace clipboard-and-spreadsheet inventory with a hands-busy, voice-driven assistant the staff can use between customer interactions. Photos are uploaded straight from a phone; the assistant lists out what was just added and confirms.

**User profile:** Shop staff who are usually mid-task on the shop floor. The owner is a beginner programmer — explanations should be plain, and the UI should be forgiving.

**Sibling project:** [BuySellTires CRM](c:\Users\chedd\crm-app) — the customer/lead-management side of the same business. The two apps are designed to talk to each other eventually (see PROJECT_BRIEF.md §11a "Vertical Packs" + the planned `ask_inventory` tool in the CRM's AskBox).

---

## 2. Tech Stack

- **Frontend / Server:** Next.js 16.2.6 App Router (TypeScript, strict mode, React 19.2.4)
  - This is breaking-changes Next.js — see `AGENTS.md`. Don't assume Next 14/15 conventions apply.
- **Language:** TypeScript 5 (strict)
- **AI:**
  - Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`) via direct HTTP to `https://api.anthropic.com/v1/messages` (not the SDK)
  - OpenAI Whisper (speech-to-text)
  - OpenAI TTS (text-to-speech)
- **Database / Auth / Storage:** Supabase
  - PostgreSQL for `tires`, `tire_photos`, `activity_log`, `bug_reports`
  - Supabase Auth for email/password login
  - Supabase Storage bucket `tire-photos` for tire imagery (public URLs)
- **UI:** React components with **inline CSS** — no Tailwind, no CSS-in-JS library. Shared design tokens live in `lib/theme.ts` (COLORS, SHADOWS, RADII).
- **Other libraries:** SheetJS (`xlsx`) for parsing spreadsheets dropped into chat (CSV/TSV/XLSX/XLS)
- **Hosting:** Vercel-ready (not yet confirmed deployed)

---

## 3. Top-Level Directory Map

```
tireops/
├── app/
│   ├── page.tsx                  # Dashboard: chat-focused home, stock counts, recent additions
│   ├── add/page.tsx              # Manual "add tire" form (with photo upload)
│   ├── edit/[id]/page.tsx        # Edit single tire (form view)
│   ├── inventory/page.tsx        # Full inventory list, sortable + filterable
│   ├── history/page.tsx          # Activity log view
│   ├── sold/page.tsx             # Recently sold tires
│   ├── chat/page.tsx             # Full-page chat view (alternative to embedded)
│   ├── bugs/page.tsx             # Bug report log + manual submission form
│   ├── auth-gate.tsx             # Login screen + session check (wraps the app)
│   ├── components/
│   │   ├── VoiceChat.tsx         # The big chat widget — mic, text input, attachments, streaming
│   │   ├── TireCard.tsx          # Tire display card (thumbnail + key stats)
│   │   └── LocationInput.tsx     # Location picker with presets
│   └── api/
│       ├── chat/route.ts         # THE agent endpoint — streaming NDJSON, 1128 lines
│       ├── transcribe/route.ts   # POST audio → Whisper → text
│       └── speak/route.ts        # POST text → OpenAI TTS → MP3 stream
├── lib/
│   ├── supabase.ts               # Supabase client init
│   ├── photos.ts                 # Photo upload/delete/gallery logic
│   ├── activity.ts               # Activity log insertion
│   ├── parseSpreadsheet.ts       # XLSX/CSV/TSV reader (for chat attachments)
│   ├── shops.ts                  # Email → shop name mapping
│   ├── locations.ts              # Location presets + canonicalization
│   ├── theme.ts                  # COLORS, SHADOWS, RADII shared tokens
│   ├── tireStatus.ts             # "Stale tire" detection (≥ 90 days in stock)
│   ├── useCurrentShop.ts         # Hook: get logged-in user's shop from email
│   ├── imageCompress.ts          # Client-side photo resize (4-10 MB → ~200-500 KB)
│   └── version.ts                # App version string
├── public/                       # Static assets
├── AGENTS.md                     # "This is NOT the Next.js you know" — one-liner
├── CLAUDE.md                     # Just `@AGENTS.md`
├── README.md
├── package.json
├── next.config.ts
└── tsconfig.json
```

---

## 4. Database Schema

Schema is **not** committed as a `.sql` file in this repo — it lives in Supabase only. Reconstructed below from query usage across the codebase.

### `tires` (main inventory)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Primary key |
| `tire_number` | bigint, auto-incrementing | Shown to users as `tire-25` — friendly identifier |
| `shop` | text | Which shop (Mission, Lethbridge, etc.) owns this tire |
| `brand` | text | e.g. "Michelin" |
| `model` | text | e.g. "X-Ice" |
| `size` | text | e.g. "225/65R17" |
| `season` | text | "summer" \| "winter" \| "all-season" |
| `condition` | text | "new" \| "used" |
| `tread_pct` | numeric (0–100) | Used tires only |
| `quantity` | numeric | Stock count |
| `price` | numeric | Per-tire price |
| `notes` | text | Free-text |
| `location` | text | Physical storage. Preset values OR custom: "Showroom", "Warehouse", "Container", "Yard", or arbitrary |
| `status` | text | "available" (default) \| "reserved" \| "pending" \| "sold". `sold` hides from main inventory. |
| `is_complete` | bool | Auto-computed flag |
| `created_at`, `updated_at` | timestamptz | |

### `tire_photos`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `tire_id` | uuid FK → tires(id) | One-to-many; cascade on delete |
| `url` | text | Public URL into Supabase Storage `tire-photos` bucket |
| `created_at` | timestamptz | Used to order — oldest = "primary" thumbnail |

### `activity_log`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `action` | text | "added" \| "edited" \| "deleted" |
| `tire_id` | uuid, nullable | |
| `tire_description` | text | Human-readable snapshot like `"tire-25 — Michelin X-Ice 225/65R17"` |
| `shop` | text | |
| `user_email` | text | From Supabase Auth |
| `source` | text | "form" \| "voice" \| "file" |
| `created_at` | timestamptz | |
| `employee_name` | text | **Legacy column — no longer written to** |

### `bug_reports`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `description` | text | What the user said was broken |
| `reported_by` | text | User email |
| `shop` | text | |
| `source` | text | "manual" (form) \| "ai" (logged via the `report_bug` tool) |
| `created_at` | timestamptz | |

---

## 5. Core User Flows

### A. Login
1. `AuthGate` wraps the entire app
2. User enters email/password → Supabase `signInWithPassword`
3. Session detected → app unlocks
4. User's email maps to a shop via `lib/shops.ts`. Examples:
   - `buyselltiresmission@gmail.com` → "Mission"
   - Substring match on "lethbridge" → "Lethbridge"
   - Fallback: `UNASSIGNED_SHOP` ("Unassigned")

### B. Dashboard
1. Land on `/` (chat-focused)
2. Sees: stock counts per shop, recently added tires, the chat box (front and center)
3. Top nav: Inventory, Add, History, Sold, Chat, Bugs

### C. Adding a tire by voice (the canonical flow)
1. User taps mic in `VoiceChat.tsx`
2. Speaks: *"Add a Michelin X-Ice, two thirty-five fifty-five seventeen, set of four, used, eight thirty-second tread, two hundred each, in the warehouse"*
3. Audio → `/api/transcribe` → text
4. Text sent to `/api/chat` with the chat history
5. Claude (Sonnet 4.6) interprets the speech (e.g., "two thirty-five fifty-five seventeen" → "235/55R17") and calls the `add_tire` tool
6. Server-side: tool executes, INSERT into `tires`, activity_log row written
7. Streamed response confirms: *"Added tire-26 — Michelin X-Ice 235/55R17, qty 4, used, $200 each, in Warehouse."*
8. Optionally: TTS plays the confirmation out loud

### D. Adding a tire via form (alternative)
1. Click "Add" in nav → `/add`
2. Fill out the form (with photo upload)
3. Photos compress client-side (`imageCompress.ts`) → upload to Supabase Storage → store URL in `tire_photos`
4. On submit: insert tire + photos + activity_log

### E. Searching / asking
1. User types or speaks: *"Do we have any 225/65R17 winter tires?"*
2. Claude calls `search_tires` with `{ size: "225/65R17", season: "winter" }`
3. Streamed reply lists matches with their `tire-N` IDs and stock counts

### F. Updates and deletes
1. *"Mark tire-25 as sold"* or *"Delete tire-25"*
2. **Confirmation gate:** Claude proposes the change, asks for "yes" in a separate turn
3. Only after user confirms does the tool fire (`update_tire` with `status: "sold"`, or `delete_tire`)
4. Activity log records the change with `source: "voice"`

### G. Photo attachment in chat
1. User drops a photo into the chat input → uploaded to `pending/{timestamp}-{token}.{ext}` first
2. Claude is told "the user attached this photo (URL: X)"
3. Conversation flow: assistant asks which tire it belongs to, then calls `attach_photo_to_tire` (with confirmation)

### H. Spreadsheet upload in chat
1. User drops an XLSX/CSV/TSV into chat
2. `lib/parseSpreadsheet.ts` parses it server-side
3. Claude sees the rows and walks the user through bulk import (each row becomes a candidate tire)

---

## 6. AI Agent System

### The endpoint
- **`POST /api/chat`** — streaming NDJSON
- 1128 lines in `app/api/chat/route.ts` — does **everything**: history pruning, attachments handling, system prompt, tool definitions, tool execution, streaming response
- Model: **Claude Sonnet 4.6** (`claude-sonnet-4-6`), called via direct HTTP (not the official SDK)

### History management
- `MAX_HISTORY_TURNS = 12` — only the 12 most recent user turns get sent to the API
- Client renders the full history visually; the server-side truncation just caps token spend per request
- No prompt caching detected — see Cost Guardrails §7 below

### System prompt
- ~2500+ words of domain rules + conversational guidance
- Personalized: includes the current user's email, name (if known), shop assignment, app version
- Different copy when the user is unassigned vs. assigned to a known shop
- Teaches Claude to: interpret tire-shop speech ("two thirty-five fifty-five seventeen" → "235/55R17"), handle multi-attachment messages, confirm destructive actions

### Tools (six)

| Tool | What it does | Confirmation? |
|---|---|---|
| `search_tires` | Query inventory by brand/model/size/season/condition/shop/location/tire_number/free-text. Returns rows including friendly `tire-N` IDs. | No |
| `add_tire` | Insert a new tire. Most fields optional. Accepts `photo_url` (single) or `photo_urls` (array). Returns a list of fields it inferred plus what's still missing. | No (data added directly) |
| `update_tire` | Edit existing tire by uuid OR friendly ID. Accepts any subset of fields. | **Yes** — for status changes and location changes; the system prompt enforces the two-turn confirmation pattern |
| `delete_tire` | Remove a tire (and cascades to its photos). | **Yes** — separate-turn confirmation required |
| `attach_photo_to_tire` | Append photos to an existing tire's gallery. | **Yes** — confirmation required |
| `report_bug` | File a bug report when the user says "this is broken" / "log a bug". Inserts into `bug_reports`. | No |

### Confirmation pattern (server-enforced via prompt)
The system prompt is strict about destructive actions — Claude must describe the proposed action, ask for a clear "yes" in a SEPARATE turn, and only call the tool with `confirm: true` AFTER. This is the same pattern used in the [CRM's AskBox](c:\Users\chedd\crm-app\lib\agents\assistant.js).

---

## 7. Cost Guardrails

⚠️ **Weaker than the CRM.** Notable:
- No per-day spend cap
- No per-request budget check
- No usage logging table
- The only protection is `MAX_HISTORY_TURNS = 12` which caps payload size

The sibling [CRM project](c:\Users\chedd\crm-app) had a $28 incident that led to a `DAILY_AI_BUDGET_USD` cap, a `ai_usage_log` Supabase table, and a settings-page spend display. tireops has **not** been hardened the same way yet. **If tireops volume grows, port the CRM's guardrails over.**

Specifically, the patterns to copy from the CRM:
- [lib/anthropic.js](c:\Users\chedd\crm-app\lib\anthropic.js): `assertWithinBudget()`, `logUsage()`, `todaysAiSpend()`
- [scripts/add-ai-usage-log.sql](c:\Users\chedd\crm-app\scripts\add-ai-usage-log.sql): the migration for the usage table

---

## 8. Environment Variables

| Var | Where it's set | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Supabase anon (public) key |
| `ANTHROPIC_API_KEY` | server only | Claude API key |
| `OPENAI_API_KEY` | server only | Whisper + TTS |

### Env file status (verified 2026-05-19)

`.env.local` exists locally (correctly — it's the working config) and is **not** tracked by git. Verified via `git ls-files -- ".env*"` (empty), `git log --all --diff-filter=A -- ".env*"` (empty), and `git check-ignore -v .env.local` (matched by `.gitignore` line 34 — `.env*`). An earlier draft of this brief flagged a security issue here; that flag was based on a survey misread. No keys have been exposed via git history.

---

## 9. UI / Theme Conventions

- **Inline CSS everywhere.** No Tailwind, no CSS modules, no styled-components.
- **Design tokens** in [lib/theme.ts](c:\Users\chedd\tireops\lib\theme.ts): `COLORS`, `SHADOWS`, `RADII`. Dark mode.
- **Component patterns:**
  - `TireCard` — thumbnail (first photo) + brand/model/size + tread % badge for used + stale flag if ≥ 90 days
  - `VoiceChat` — text input, mic toggle, attachment area, streamed response area, history
  - `LocationInput` — datalist with presets + free-text fallback
- **Mobile:** Designed primarily for desktop; mobile-responsive is incomplete

---

## 10. Photo Handling

### Upload flow
1. **Client compress:** `lib/imageCompress.ts` resizes a 4–10 MB phone photo down to ~200–500 KB (max 2048px on the long edge, JPEG quality ~0.85)
2. **Upload:** to Supabase Storage bucket `tire-photos` at path `{tireId}/{timestamp}-{randomToken}.{ext}` (or `pending/{timestamp}-{token}.{ext}` for chat attachments before they're assigned to a tire)
3. **Persist:** public URL stored in `tire_photos` row tied to `tire_id`
4. **Display:** thumbnails on cards; gallery on detail view (ordered by `created_at` asc — first photo = primary thumbnail)

### Confirmation flows
- New tire from chat: `add_tire` accepts `photo_urls` array and ties them at creation
- Existing tire: `attach_photo_to_tire` (requires explicit confirmation in chat)

### Bucket config
- Bucket name: `tire-photos`
- RLS: authenticated users upload + read
- Public access for thumbnails: yes (via `getPublicUrl(path)`)

---

## 11. Auth

- **Supabase Auth, email + password only.**
- No social login, no magic link, no SSO
- `AuthGate` is the entire enforcement — wraps the app at the root layout level (client-side check + redirect)
- **No `middleware.js`** — all auth handling is in `AuthGate.tsx`. Routes don't check auth themselves; they trust the gate.
- **Shop assignment** happens by email lookup in `lib/shops.ts`. Adding a new staff member = adding their email to `EMAIL_TO_SHOP`.

---

## 12. Recent Activity (git)

Latest 7 commits:
```
55a37b7 remove location filter from all tires page
de024f5 ui: move nav into a clean top menu bar
80b91b9 ui: nav spacing, chat-focused home, remove recently-sold, bigger chat
ef25ee0 ui: nav spacing, chat-focused home, static sold list, bigger chat
5c586bf inventory: add sort-by feature
dbafb55 dashboard: chat focus, per-shop stats, recent + recently-sold lists
… (earlier: chat agent, photos, locations, status tracking, friendly IDs, voice)
```

Working tree: clean. No uncommitted work.

Recent theme: UI refinement (chat prominence on home, navigation cleanup, inventory filtering/sorting).

---

## 13. Things to Avoid

- **Don't commit `.env.local`.** It's currently gitignored (see §8) — keep it that way.
- **Don't assume Next.js 14/15 conventions apply.** This is Next 16; check `node_modules/next/dist/docs/` if uncertain.
- **Don't bypass the confirmation pattern** for destructive Claude tools (`delete_tire`, `update_tire` status/location changes, `attach_photo_to_tire`). The system prompt enforces a two-turn flow; respect it.
- **Don't add cost-blind features** that fire on every message. Without a budget cap, a rate-limit loop or runaway agent could burn through the Anthropic balance fast. See §7 — port the CRM's guardrails before scaling usage.
- **Don't drop the `tire_number` auto-increment behavior.** Users speak in friendly IDs ("tire-25"). UUIDs alone would break the conversational UX.
- **Don't remove `MAX_HISTORY_TURNS = 12`** without replacing it with another payload cap.

---

## 14. Known Issues / Pending

- **No cost guardrails** (see §7). Highest-priority hardening item before any volume increase.
<!-- removed: `.env.local in git` was a false alarm; see §8 -->
- **No prompt caching** despite a 2500-word system prompt that gets sent on every chat turn. Adding `cache_control: { type: "ephemeral" }` to the system block would cut input token cost by ~90% on repeat calls within 5 min. Easy win.
- **Schema not in source.** The Supabase tables are real but no `schema.sql` is committed. If the project is forked or restored, the structure must be inferred from code. Recommend: capture the live schema as a one-off and commit it.
- **No migration system.** Changes to the DB happen ad-hoc in the Supabase dashboard. Risky.
- **No tests.** Zero unit/integration/E2E tests. Acceptable for a single-shop tool, risky if this becomes a multi-shop SaaS.
- **Activity log's `employee_name` column** is legacy — not written to. Could be dropped.
- **Mobile-responsive incomplete.** Designed for desktop. Phone usage is implied by the voice + photo flows; the UI doesn't fully cooperate yet.

---

## 15. Integration with the CRM (planned)

The [CRM](c:\Users\chedd\crm-app) is designed to call into tireops eventually. The plan:

1. Add an `ask_inventory(question: string) → string` tool to the CRM's AskBox assistant
2. The tool POSTs to tireops's `/api/chat` (with an auth header to be defined) and returns the streamed answer
3. The CRM's customer-facing replies become inventory-aware — "do we have 225/65R17 in winter?" becomes answerable inline

**Auth between the two apps:** TBD. Options being considered:
- Shared secret header (`X-Inventory-Token`)
- Service-account JWT from a shared Supabase project
- Cross-account access via Supabase service-role keys (simplest; risky for the principle of least privilege)

See the CRM's `docs/inventory-integration-plan.md` (will exist after Phase 3 of the CRM work) for the full design.

---

## 16. How to Run Locally

```bash
cd C:\Users\chedd\tireops
npm install
# Ensure .env.local is populated (see §8)
npm run dev
# Open http://localhost:3000
```

Login with a Supabase Auth account whose email maps to a shop (see `lib/shops.ts`). For an unmapped email, the app falls back to "Unassigned" — many features still work but shop scoping is generic.

---

End of brief. ~2900 words. Use this verbatim with another LLM (paste, upload as a file, or print to PDF).
