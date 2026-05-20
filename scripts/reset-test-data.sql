-- ============================================================
-- Reset all test data before real inventory begins.
--
-- DESTRUCTIVE. Run only after confirming you want to wipe the
-- working set. A snapshot of the pre-reset state is in
-- backups/snapshot-*.json (gitignored, local-only).
--
-- What this clears:
--   - All tires (113 test rows at snapshot time, all under
--     shops "TEST" and "Test Shop" — zero real shops present)
--   - All tire_photos (6 rows, all orphaned by the tires wipe)
--   - All activity_log entries (66 rows from test CRUD)
--   - All bug_reports (4 rows; reviewed — all are test bugs
--     or historical issues already addressed in code)
--
-- What this PRESERVES:
--   - ai_usage_log (today's spend data — useful as a baseline)
--   - Schema, RLS policies, indexes, sequences (these stay;
--     only the rows go)
--   - Supabase Auth users — untouched
--   - Supabase Storage objects — see the manual step below
--
-- After this script runs, the tire_number sequence is reset
-- so the very next tire added gets tire-1.
-- ============================================================

-- 1. Clear photos first (FK target — explicit order beats
--    relying on cascade in case the FK isn't set up that way).
delete from tire_photos;

-- 2. Clear tires.
delete from tires;

-- 3. Clear activity history.
delete from activity_log;

-- 4. Clear bug reports.
delete from bug_reports;

-- 5. Reset the tire_number sequence so the next insert is 1.
--    Uses pg_get_serial_sequence so the actual sequence name
--    is resolved dynamically — robust to whatever Supabase
--    actually named it. If no sequence is found, skips.
do $$
declare
  seq_name text := pg_get_serial_sequence('tires', 'tire_number');
begin
  if seq_name is not null then
    perform setval(seq_name, 1, false);
    raise notice 'Reset sequence % — next tire_number will be 1', seq_name;
  else
    raise notice 'No sequence found on tires.tire_number — sequence unchanged';
  end if;
end$$;

-- ============================================================
-- POST-SCRIPT MANUAL STEP (do this in the Supabase dashboard):
--
-- The tire-photos Storage bucket still contains orphaned files
-- from deleted test tires. To clear them:
--   1. Open Supabase → Storage → tire-photos bucket
--   2. Select all folders (each tire's UUID is a folder) and
--      the "pending/" folder (chat upload staging)
--   3. Click Delete
-- This is optional — orphaned storage objects don't affect the
-- app, just consume a tiny amount of bucket quota.
-- ============================================================
