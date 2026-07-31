-- 002_rls_policies.sql (Phase-3 final audit — see comments below for intent)
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
alter table public.notes                disable row level security;

-- profiles
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
revoke update on public.profiles from authenticated;
grant update (full_name) on public.profiles to authenticated;

-- subscriptions
alter table public.subscriptions enable row level security;
drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions for select using (auth.uid() = user_id);

-- test_attempts — SELECT own only; mutations flow through server/RPC
alter table public.test_attempts enable row level security;
drop policy if exists "test_attempts_select_own" on public.test_attempts;
create policy "test_attempts_select_own" on public.test_attempts for select using (auth.uid() = user_id);
drop policy if exists "test_attempts_insert_own" on public.test_attempts;
drop policy if exists "test_attempts_update_own" on public.test_attempts;
drop policy if exists "test_attempts_delete_own" on public.test_attempts;

-- attempt_responses — SELECT via attempt ownership, UPDATE-only (no INSERT).
-- Rows are pre-created by /api/attempt/create (service key). Browser only updates.
alter table public.attempt_responses enable row level security;
drop policy if exists "attempt_responses_select_own" on public.attempt_responses;
create policy "attempt_responses_select_own" on public.attempt_responses for select using (
  exists (select 1 from public.test_attempts ta where ta.id = attempt_responses.attempt_id and ta.user_id = auth.uid())
);
drop policy if exists "attempt_responses_insert_own" on public.attempt_responses;
drop policy if exists "attempt_responses_update_own" on public.attempt_responses;
create policy "attempt_responses_update_own" on public.attempt_responses for update using (
  exists (select 1 from public.test_attempts ta where ta.id = attempt_responses.attempt_id and ta.user_id = auth.uid())
) with check (
  exists (select 1 from public.test_attempts ta where ta.id = attempt_responses.attempt_id and ta.user_id = auth.uid())
);
revoke update on public.attempt_responses from authenticated;
grant update (selected_option_id, status, time_spent_seconds, answered_at) on public.attempt_responses to authenticated;

-- bookmarks
alter table public.bookmarks enable row level security;
drop policy if exists "bookmarks_select_own" on public.bookmarks;
create policy "bookmarks_select_own" on public.bookmarks for select using (auth.uid() = user_id);
drop policy if exists "bookmarks_write_own" on public.bookmarks;
create policy "bookmarks_write_own" on public.bookmarks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- answers (v3 gating unchanged)
alter table public.answers enable row level security;
drop policy if exists "answers_require_attempt_or_test_subscription" on public.answers;
create policy "answers_require_attempt_or_test_subscription" on public.answers for select using (
  exists (select 1 from public.attempt_responses ar join public.test_attempts ta on ta.id = ar.attempt_id where ar.question_id = public.answers.question_id and ta.user_id = auth.uid())
  or exists (select 1 from public.subscriptions s join public.plans p on p.id = s.plan_id where s.user_id = auth.uid() and s.status = 'active' and s.expires_at > now() and (p.features->>'tests')::boolean is true)
);
