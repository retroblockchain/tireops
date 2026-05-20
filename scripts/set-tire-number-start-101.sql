-- ============================================================
-- Bump the tire_number sequence so the first real tire is tire-101.
-- Cosmetic choice: minimum-3-digit IDs read better on labels and
-- in chat ("tire-101" vs "tire-1"). Safe to run on an empty tires
-- table; harmless on a populated one as long as the current max
-- tire_number is < 101 (Postgres will just keep counting from
-- wherever the sequence is).
--
-- Run AFTER scripts/reset-test-data.sql when starting fresh.
-- ============================================================

do $$
declare
  seq_name text := pg_get_serial_sequence('tires', 'tire_number');
begin
  if seq_name is not null then
    perform setval(seq_name, 101, false);
    raise notice 'Sequence % set to 101 — next tire_number will be 101', seq_name;
  else
    raise notice 'No sequence found on tires.tire_number — nothing changed';
  end if;
end$$;
