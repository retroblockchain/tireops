# Plan: Schema management for tireops

**Status:** Proposed, not yet executed
**Date:** 2026-05-19
**Reference:** PROJECT_BRIEF §4, §14 (schema not in source; no migration system)

## Where we are today

The Supabase tables that hold the entire business state of tireops — `tires`, `tire_photos`, `activity_log`, `bug_reports`, and now `ai_usage_log` — are **only described in the project brief and inferred from query usage in the code.** There is no committed `schema.sql`, no migration history, no record of how the live tables came to be the shape they are. Changes to date have been made directly in the Supabase dashboard's table editor.

This is fine for a single-developer prototype. It becomes risky the moment any of these become true:
- A second person joins the project (they have no way to recreate the database).
- A second environment exists (staging vs. prod, or a local dev Supabase).
- A migration goes wrong and we need to know what the schema looked like *before* the change.
- A column is renamed in the dashboard but the code still references the old name — type errors at runtime, not at compile time.

The CRM uses hand-rolled SQL files in `scripts/` with names like `add-ai-usage-log.sql`, `add-contact-direction.sql`, `add-indexes.sql`. That's the pattern to match here — consistency between the two apps matters because the owner moves between them.

## Decision (proposed)

**Hand-rolled SQL files in `scripts/`, named by intent, idempotent where possible.** Plus a single committed `scripts/schema.sql` that captures the current full shape.

### Why this and not Supabase CLI migrations

- The CLI approach (`supabase migration new ...`) generates timestamped files and manages a migration history table in the database. Solid for teams; overkill for a one-person, two-app setup.
- Hand-rolled SQL is what the CRM already does. Owner moves between repos; keeping the workflow identical reduces friction.
- Idempotent SQL (`create table if not exists`, `add column if not exists`, etc.) is forgiving of partial runs and reruns. Migration tools are stricter — which is good in a team setting but adds ceremony for a solo build.
- We can always graduate to Supabase CLI later by exporting current state once and treating that as migration 0001.

### What "naming by intent" means

Each file's name says *what* it changes, in present tense, kebab-case. Examples:
- `scripts/schema.sql` — the canonical full schema (regenerated on demand; see below)
- `scripts/add-ai-usage-log.sql` — adds the AI usage log table (already exists, today's work)
- `scripts/add-shop-column-to-tires.sql` — hypothetical: adds a missing column
- `scripts/backfill-tire-numbers.sql` — hypothetical: one-off data fix
- `scripts/drop-employee-name-column.sql` — hypothetical: clean up the legacy `activity_log.employee_name` field

No timestamps in filenames. The git log carries the date if anyone needs it. The filename should read like an English description of what the script does, not a numbered ticket.

## Step-by-step

### Phase 5a — Capture the current live schema

1. **One-time export.** In the Supabase dashboard, go to **Database → Schema visualizer** (or use the SQL editor and run a query against `information_schema`). Get the `CREATE TABLE` statements for `tires`, `tire_photos`, `activity_log`, `bug_reports`, `ai_usage_log`.
2. **Write to `scripts/schema.sql`.** One file with all five `create table if not exists` blocks, plus any indexes and RLS policies (especially the `ai_usage_log` anon policies that were just added).
3. **Commit it.** Commit message like: `db: capture live schema as the canonical reference`. From this commit forward, the canonical answer to "what's in the database?" is `scripts/schema.sql`.

The export can be done manually (paste from the dashboard) or via `pg_dump` if direct database access is set up. Manual is simpler for a one-shot.

### Phase 5b — Going forward

Every schema change follows this pattern:

1. **Write the SQL file first.** Save to `scripts/<verb-noun>.sql`. Use `if not exists` / `if exists` / `add column if not exists` where it makes sense so re-running is safe.
2. **Run it in the Supabase dashboard.** Owner only — Claude doesn't have dashboard access.
3. **Update `scripts/schema.sql` to reflect the new state.** This is the most likely thing to drift if forgotten. The discipline: every commit that adds a `scripts/<change>.sql` must also touch `scripts/schema.sql` in the same commit.
4. **Commit both files together.** That way `git log scripts/schema.sql` shows you every change ever made to the database, in order.

### Phase 5c — Validation (optional, later)

Once `schema.sql` exists, a CI check could parse it and diff against the live database to catch drift. Out of scope until either:
- The project has a second environment (staging) that needs to stay in sync, or
- A schema-mismatch bug actually happens.

## What I won't do

- Adopt Supabase CLI migrations. The above pattern is simpler, matches the CRM, and is enough for a single-environment, single-developer system.
- Generate a migration for every historical change. Capturing current state is sufficient; we don't need to retroactively explain how `tires` got its `is_complete` column.
- Drop the legacy `activity_log.employee_name` column as part of this work. That's its own small migration (see §14 of the brief).

## Open questions for the owner

- Is there a staging Supabase project, or is "prod" the only environment? (Influences whether step 5c becomes worth the effort.)
- Are there any other tables in Supabase that aren't yet referenced by the codebase? (Worth a one-time check of the live database to make sure `schema.sql` is actually complete.)
- Is the Storage bucket `tire-photos` worth capturing too? (Storage isn't SQL but its config — public/private, RLS — is part of "the schema of the system" in the broader sense. Out of scope for `schema.sql`, but a short note in the file could point at it.)

## Estimated effort

- Phase 5a: 30–60 minutes (most of it staring at the dashboard to copy out the schema).
- Phase 5b: ongoing, ~5 minutes per schema change going forward.
- Phase 5c: 2–4 hours if and when it becomes necessary.

## When to execute

After the current burst of feature work settles. Schema capture is the kind of housekeeping that's easy to defer but pays the highest dividend the day it's needed (a broken migration, a recovery, a second developer). Best done on a "calm" afternoon, not under the pressure of a fix.
