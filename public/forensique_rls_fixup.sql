-- ============================================================================
-- FORENSIQUE — Phase 1 RLS FIXUP PATCH
--
-- Root cause: RLS is currently ENABLED on every public.* table in this project
-- (verified by probing every table with the anon key — all returned []).
-- v3 schema only intended RLS on `answers` and `notes`. Something enabled it
-- everywhere (Supabase project-level default, or a manual edit).
--
-- This patch:
--   1) Explicitly DISABLES RLS on content tables that must be publicly readable
--      (tests, taxonomy, question parts, passages, plans).
--   2) Explicitly ENABLES RLS + own-row policies on user-owned tables so a
--      user can read/write only their own rows directly from the browser
--      (test_attempts, attempt_responses, bookmarks, profiles, subscriptions).
--   3) Leaves `answers` and `notes` alone — those already have the correct
--      gating policies from v3.
--
-- Paste this ENTIRE file into Supabase SQL Editor and click Run.
-- Idempotent — safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. PUBLIC CONTENT TABLES — RLS OFF
-- ---------------------------------------------------------------------------
alter table public.tests                disable row level security;
alter table public.test_questions       disable row level security;
alter table public.questions            disable row level security;
alter table public.question_options     disable row level security;
alter table public.question_statements  disable row level security;
alter table public.question_match_items disable row level security;
alter table public.passages             disable row level security;
alter table public.exams                disable row level security;
alter table public.units                disable row level security;
alter table public.topics               disable row level security;
alter table public.subtopics            disable row level security;
alter table public.plans                disable row level security;

-- ---------------------------------------------------------------------------
-- 2. USER-OWNED TABLES — RLS ON + own-row policies
-- ---------------------------------------------------------------------------

-- profiles: a user sees / updates only their own row
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- Column-level hardening: RLS restricts the row, GRANTs restrict WHICH columns.
-- Without this, a user could self-promote to admin via a direct client update.
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- subscriptions: read your own
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- test_attempts: SELECT + INSERT only from the browser.
-- Scoring (UPDATE) goes through /api/attempt/submit with the service key, so no
-- own-row UPDATE policy is granted here — leaving one would let a client rewrite
-- score/status/counts/is_correct on their own row.
alter table public.test_attempts enable row level security;
drop policy if exists "test_attempts_select_own" on public.test_attempts;
create policy "test_attempts_select_own" on public.test_attempts
  for select using (auth.uid() = user_id);
drop policy if exists "test_attempts_insert_own" on public.test_attempts;
create policy "test_attempts_insert_own" on public.test_attempts
  for insert with check (auth.uid() = user_id);
drop policy if exists "test_attempts_update_own" on public.test_attempts;
drop policy if exists "test_attempts_delete_own" on public.test_attempts;

-- attempt_responses: ownership resolved through attempt_id -> test_attempts.user_id
alter table public.attempt_responses enable row level security;
drop policy if exists "attempt_responses_select_own" on public.attempt_responses;
create policy "attempt_responses_select_own" on public.attempt_responses
  for select using (
    exists (
      select 1 from public.test_attempts ta
      where ta.id = attempt_responses.attempt_id and ta.user_id = auth.uid()
    )
  );
drop policy if exists "attempt_responses_insert_own" on public.attempt_responses;
create policy "attempt_responses_insert_own" on public.attempt_responses
  for insert with check (
    exists (
      select 1 from public.test_attempts ta
      where ta.id = attempt_responses.attempt_id and ta.user_id = auth.uid()
    )
  );
drop policy if exists "attempt_responses_update_own" on public.attempt_responses;
create policy "attempt_responses_update_own" on public.attempt_responses
  for update using (
    exists (
      select 1 from public.test_attempts ta
      where ta.id = attempt_responses.attempt_id and ta.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.test_attempts ta
      where ta.id = attempt_responses.attempt_id and ta.user_id = auth.uid()
    )
  );
-- Column-level hardening: is_correct MUST be server-set only. Without this
-- restriction a client could forge is_correct=true on their own rows before
-- submission and inflate their score. Same principle for the whole set of
-- server-computed columns: only selected_option_id / status / timing / answered_at
-- may be written from the browser.
revoke update on public.attempt_responses from authenticated;
grant update (selected_option_id, status, time_spent_seconds, answered_at)
  on public.attempt_responses to authenticated;

-- bookmarks: full CRUD on your own
alter table public.bookmarks enable row level security;
drop policy if exists "bookmarks_select_own" on public.bookmarks;
create policy "bookmarks_select_own" on public.bookmarks
  for select using (auth.uid() = user_id);
drop policy if exists "bookmarks_write_own" on public.bookmarks;
create policy "bookmarks_write_own" on public.bookmarks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 3. answers / notes: unchanged. Their v3 gating policies are correct.
-- ---------------------------------------------------------------------------
