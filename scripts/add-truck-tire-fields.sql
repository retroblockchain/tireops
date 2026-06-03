-- ============================================================
-- Truck-tire fields — adds two nullable text columns so the
-- inventory can describe LT/passenger service type and load
-- range (B/C/D/E/F = old-style ply rating × 2). Display-only;
-- not used in any price/comp logic.
--
-- Safe to re-run (IF NOT EXISTS).
-- Run in the Supabase SQL editor.
-- ============================================================

alter table tires add column if not exists service_type text;
alter table tires add column if not exists load_range text;
