-- ============================================================
-- Tire size normalization — adds structured integer columns for
-- width, aspect ratio, and diameter alongside the existing free-
-- text size column. Safe to re-run (all operations are IF NOT
-- EXISTS / idempotent).
--
-- The existing `size` TEXT column stays in place for now — all
-- current read paths reference it. A later phase will migrate
-- reads to `size_raw` + the integer columns and drop `size`.
--
-- Run in the Supabase SQL editor or via psql.
-- ============================================================

-- 1. Structured integer columns for queryable size matching
alter table tires add column if not exists width int;
alter table tires add column if not exists aspect_ratio int;
alter table tires add column if not exists diameter int;

-- 2. Raw size string — preserves exactly what the user typed,
--    for display and audit. Populated by the backfill script
--    (copies from `size`) and by all future write paths.
alter table tires add column if not exists size_raw text;

-- 3. Composite index for fast comp lookups (future price anchor
--    feature will query by exact width + aspect_ratio + diameter).
create index if not exists idx_tires_size_normalized
  on tires (width, aspect_ratio, diameter);
