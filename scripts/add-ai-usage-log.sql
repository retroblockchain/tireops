-- ============================================================
-- AI usage log — records every Anthropic call so tireops can show
-- daily spend and hard-stop runaway loops. Safe to re-run.
--
-- Mirrors the sibling crm-app's scripts/add-ai-usage-log.sql so
-- both apps share one mental model. Differences:
--   - tireops only has one AI feature today ('chat'), so the
--     feature column will mostly be the same value here.
--   - tireops inserts via the anon Supabase key. The RLS policy
--     below grants insert + select to the anon role so the
--     existing client setup keeps working (mirrors how tireops's
--     other tables — activity_log, bug_reports — are reached).
-- ============================================================

create table if not exists ai_usage_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  model text not null,
  feature text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_creation_tokens int not null default 0,
  cost_usd numeric(10, 6) not null default 0
);

create index if not exists idx_ai_usage_created_at on ai_usage_log (created_at desc);
create index if not exists idx_ai_usage_feature on ai_usage_log (feature);

-- RLS: keep it on (Supabase default) but allow anon to insert + select.
-- This matches the posture of the other tireops tables that the chat
-- route writes to under the anon key.
alter table ai_usage_log enable row level security;

drop policy if exists "anon can insert usage rows" on ai_usage_log;
create policy "anon can insert usage rows"
  on ai_usage_log for insert
  to anon
  with check (true);

drop policy if exists "anon can read usage rows" on ai_usage_log;
create policy "anon can read usage rows"
  on ai_usage_log for select
  to anon
  using (true);
