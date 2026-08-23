-- Secure premium test content and the Custom Test feature.
--
-- Enforces the product boundary at both API and database levels:
--   * Free tests are readable by authenticated users.
--   * Premium tests require an active plan with features.tests = true.
--   * Admins can access all test content.
--   * Existing attempts remain readable so historical results continue to work.
--   * Custom tests are premium tests; creation is also checked server-side.

create or replace function public.has_test_entitlement()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      exists (
        select 1 from public.profiles pr
        where pr.id = auth.uid() and pr.role = 'admin'
      )
      or exists (
        select 1
        from public.subscriptions s
        join public.plans p on p.id = s.plan_id
        where s.user_id = auth.uid()
          and s.status = 'active'
          and s.expires_at > now()
          and coalesce((p.features->>'tests')::boolean, false) is true
      )
    );
$$;

create or replace function public.can_access_test(p_test_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      public.has_test_entitlement()
      or exists (
        select 1 from public.tests t
        where t.id = p_test_id and t.is_premium = false
      )
      or exists (
        select 1 from public.test_attempts ta
        where ta.test_id = p_test_id and ta.user_id = auth.uid()
      )
    );
$$;

create or replace function public.can_access_question(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.test_questions tq
    where tq.question_id = p_question_id
      and public.can_access_test(tq.test_id)
  );
$$;

revoke all on function public.has_test_entitlement() from public;
grant execute on function public.has_test_entitlement() to anon, authenticated;
revoke all on function public.can_access_test(uuid) from public;
grant execute on function public.can_access_test(uuid) to anon, authenticated;
revoke all on function public.can_access_question(uuid) from public;
grant execute on function public.can_access_question(uuid) to anon, authenticated;

-- Tests
alter table public.tests enable row level security;
drop policy if exists "tests_select_accessible" on public.tests;
create policy "tests_select_accessible" on public.tests
for select using (public.can_access_test(id));

drop policy if exists "tests_delete_own_custom" on public.tests;
create policy "tests_delete_own_custom" on public.tests
for delete using (
  auth.uid() = created_by
  and is_user_generated = true
  and test_type = 'custom'
);

-- Test/question relationship
alter table public.test_questions enable row level security;
drop policy if exists "test_questions_select_accessible" on public.test_questions;
create policy "test_questions_select_accessible" on public.test_questions
for select using (public.can_access_test(test_id));

-- Core question content
alter table public.questions enable row level security;
drop policy if exists "questions_select_accessible" on public.questions;
create policy "questions_select_accessible" on public.questions
for select using (public.can_access_question(id));

alter table public.question_options enable row level security;
drop policy if exists "question_options_select_accessible" on public.question_options;
create policy "question_options_select_accessible" on public.question_options
for select using (public.can_access_question(question_id));

alter table public.question_statements enable row level security;
drop policy if exists "question_statements_select_accessible" on public.question_statements;
create policy "question_statements_select_accessible" on public.question_statements
for select using (public.can_access_question(question_id));

alter table public.question_match_items enable row level security;
drop policy if exists "question_match_items_select_accessible" on public.question_match_items;
create policy "question_match_items_select_accessible" on public.question_match_items
for select using (public.can_access_question(question_id));

alter table public.passages enable row level security;
drop policy if exists "passages_select_accessible" on public.passages;
create policy "passages_select_accessible" on public.passages
for select using (
  exists (
    select 1 from public.questions q
    where q.passage_id = passages.id
      and public.can_access_question(q.id)
  )
);

-- Answer keys follow the same test-access rule.
alter table public.answers enable row level security;
drop policy if exists "answers_require_attempt_or_test_subscription" on public.answers;
drop policy if exists "answers_select_accessible" on public.answers;
create policy "answers_select_accessible" on public.answers
for select using (public.can_access_question(question_id));

-- Taxonomy is not question content. Authenticated users may read it.
alter table public.units enable row level security;
drop policy if exists "units_select_authenticated" on public.units;
create policy "units_select_authenticated" on public.units
for select using (auth.uid() is not null);

alter table public.topics enable row level security;
drop policy if exists "topics_select_authenticated" on public.topics;
create policy "topics_select_authenticated" on public.topics
for select using (auth.uid() is not null);

alter table public.subtopics enable row level security;
drop policy if exists "subtopics_select_authenticated" on public.subtopics;
create policy "subtopics_select_authenticated" on public.subtopics
for select using (auth.uid() is not null);

alter table public.exams enable row level security;
drop policy if exists "exams_select_authenticated" on public.exams;
create policy "exams_select_authenticated" on public.exams
for select using (auth.uid() is not null);

-- Pricing/marketing data is intentionally public, but only active/published rows.
alter table public.plans enable row level security;
drop policy if exists "plans_select_active" on public.plans;
create policy "plans_select_active" on public.plans
for select using (is_active = true);

alter table public.notes enable row level security;
drop policy if exists "notes_select_published" on public.notes;
create policy "notes_select_published" on public.notes
for select using (status = 'published');
