-- ============================================================================
-- FORENSIQUE — PRODUCTION SCHEMA v3
-- ============================================================================
-- Supersedes ugc_net_forensic_schema_v2.sql. Key changes from v2:
--   - Aligned to the actual generated JSON shape: question_options uses
--     option_id/option_text (not label/text); answer_status ('valid'/'dropped')
--     replaces the old implicit "always has a correct answer" assumption.
--   - NEW: question_match_items table for match_following questions
--     (List-I / List-II), which v2 had no way to represent.
--   - NEW: notes module (units-linked, separately payment-gated).
--   - NEW: three-plan subscription model (Test Series / Notes / Combined)
--     with is_purchasable so Notes/Combined can exist but not be buyable yet.
--   - question_statements now explicitly serves BOTH statement_based and
--     arrangement content_format (v2 conflated this).
-- Written for Postgres / Supabase. Run `create extension if not exists
-- pgcrypto;` first. Swap `auth.users` / `auth.uid()` for your provider's
-- equivalent if not on Supabase.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- SECTION 1: ENUMS
-- ============================================================================

create type public.test_type as enum ('previous_year','topic_wise','custom','full_mock');
create type public.content_format as enum ('plain','statement_based','arrangement','match_following');
create type public.answer_status as enum ('valid','dropped');
create type public.question_status as enum ('draft','published','archived');
create type public.attempt_status as enum ('in_progress','submitted','auto_submitted','abandoned');
create type public.response_status as enum ('not_visited','not_answered','answered','marked_for_review','answered_and_marked');
create type public.subscription_status as enum ('active','past_due','cancelled','expired');
create type public.note_status as enum ('draft','published');

-- ============================================================================
-- SECTION 2: USERS, PLANS, SUBSCRIPTIONS, PAYMENTS
-- ============================================================================

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  full_name text,
  role text not null default 'student',        -- 'student' | 'admin'
  created_at timestamptz not null default now()
);

-- Three plans seeded below: Test Series (buyable now), Notes, Combined
-- (both visible on pricing page but is_purchasable=false until Notes ships).
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price_paise integer not null,                -- ₹149/mo = 14900, avoids float rounding
  duration_days integer not null default 30,
  features jsonb not null default '{}'::jsonb,  -- {"tests": true, "notes": false}
  is_purchasable boolean not null default false,
  is_active boolean not null default true,
  stripe_price_id text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.plans(id),
  status public.subscription_status not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  cancel_at_period_end boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_subscriptions_user on public.subscriptions(user_id);
create index idx_subscriptions_stripe_sub on public.subscriptions(stripe_subscription_id);

-- Idempotency log — every Stripe webhook checked against this before processing.
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  provider_event_id text not null,
  event_type text not null,
  payload jsonb,
  processed_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

-- ============================================================================
-- SECTION 3: TAXONOMY (shared by Test Series and Notes)
-- ============================================================================

create table public.units (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  unique (unit_id, name)
);

create table public.subtopics (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  unique (topic_id, name)
);

-- ============================================================================
-- SECTION 4: SOURCE EXAMS & PASSAGES
-- ============================================================================

-- One row per real-world exam sitting (e.g. "UGC NET Forensic Science June 2025").
-- Distinct from `tests`, which are the app's playable objects built from questions.
create table public.exams (
  id uuid primary key default gen_random_uuid(),
  exam_name text not null,
  subject text not null default 'Forensic Science',
  paper text not null default 'Paper-II',
  session text,
  year integer,
  exam_date date,
  agency text default 'NTA'
);

create table public.passages (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid references public.exams(id) on delete cascade,
  passage_code text not null,          -- matches JSON passage_id, e.g. "P1"
  passage_label text,
  passage_text text not null,
  unique (exam_id, passage_code)
);

-- ============================================================================
-- SECTION 5: QUESTION BANK
-- ============================================================================

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  question_code text not null unique,   -- matches JSON question_code, globally unique
  exam_id uuid references public.exams(id) on delete set null,
  question_number integer,
  unit_id uuid references public.units(id),
  topic_id uuid references public.topics(id),
  subtopic_id uuid references public.subtopics(id),
  content_format public.content_format not null default 'plain',
  question_text text not null,
  passage_id uuid references public.passages(id),
  difficulty text default 'medium',     -- 'easy' | 'medium' | 'hard'
  marks numeric not null default 2,
  negative_marks numeric not null default 0,
  is_negative_framing boolean not null default false,
  status public.question_status not null default 'draft',
  answer_status public.answer_status not null default 'valid',
  explanation text,
  answer_key_version integer not null default 1,
  revised_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_questions_unit on public.questions(unit_id);
create index idx_questions_topic on public.questions(topic_id);
create index idx_questions_status on public.questions(status);
create index idx_questions_exam on public.questions(exam_id);

-- Lettered statements. Used for BOTH statement_based ("choose the correct
-- combination") and arrangement ("put these in order") — the content_format
-- on the parent question decides how the frontend renders them.
create table public.question_statements (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  label text not null,                  -- "A","B","C"...
  text text not null,
  sort_order integer not null default 0,
  unique (question_id, label)
);

-- List-I / List-II pairs — ONLY for content_format = 'match_following'.
create table public.question_match_items (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  side text not null check (side in ('left','right')),  -- left=List-I, right=List-II
  label text not null,                  -- "A".."D" on the left, "I".."IV" on the right
  text text not null,
  sort_order integer not null default 0,
  unique (question_id, side, label)
);

-- The 4 clickable answers, for every content_format without exception.
-- Field names match the JSON convention: option_id / option_text.
create table public.question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  option_id text not null,              -- "1".."4"
  option_text text not null,
  sort_order integer not null default 0,
  unique (question_id, option_id)
);

-- Correct answer lives in its own table so RLS can gate it independently
-- of the question/options (which stay publicly readable so a user can
-- attempt the question at all).
create table public.answers (
  question_id uuid primary key references public.questions(id) on delete cascade,
  correct_option_id text,               -- references question_options.option_id;
                                         -- NULL when questions.answer_status = 'dropped'
  correct_option_ids text[],            -- reserved for future multi-select support
  scoring_type text not null default 'single_correct'
);

-- ============================================================================
-- SECTION 6: TESTS (playable objects) & TEST-TAKING ENGINE
-- ============================================================================

create table public.tests (
  id uuid primary key default gen_random_uuid(),
  test_id text not null unique,         -- matches JSON test_id
  title text not null,
  test_type public.test_type not null,
  exam_id uuid references public.exams(id),
  total_questions integer not null,
  duration_minutes integer not null,
  marks_per_question numeric not null default 2,
  negative_marking boolean not null default false,
  is_premium boolean not null default true,
  is_user_generated boolean not null default false,
  created_by uuid references public.profiles(id),
  status text not null default 'published',  -- draft | published
  created_at timestamptz not null default now()
);

create table public.test_questions (
  test_id uuid not null references public.tests(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  sequence_number integer not null,
  marks_override numeric,
  primary key (test_id, question_id)
);
create index idx_test_questions_seq on public.test_questions(test_id, sequence_number);

-- NTA-style palette state machine — every response tracked individually.
create table public.test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  test_id uuid not null references public.tests(id),
  status public.attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  time_taken_seconds integer,
  score numeric,
  correct_count integer,
  incorrect_count integer,
  unattempted_count integer,
  created_at timestamptz not null default now()
);
create index idx_attempts_user on public.test_attempts(user_id);
create index idx_attempts_test on public.test_attempts(test_id);
create index idx_attempts_user_status on public.test_attempts(user_id, status);

create table public.attempt_responses (
  attempt_id uuid not null references public.test_attempts(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_option_id text,
  status public.response_status not null default 'not_visited',
  is_correct boolean,
  time_spent_seconds integer not null default 0,
  answered_at timestamptz,
  primary key (attempt_id, question_id)
);

-- ============================================================================
-- SECTION 7: BOOKMARKS, PRACTICE, ANALYTICS
-- ============================================================================

create table public.bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, question_id)
);

-- Standalone re-attempts outside a formal test (e.g. retrying a bookmarked
-- question from the solution review screen).
create table public.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id),
  selected_option_id text,
  is_correct boolean,
  attempted_at timestamptz not null default now()
);

-- Aggregated per-user, per-subtopic stats — powers the analytics dashboard
-- (accuracy by topic, weak-area callouts). Recompute on attempt submission,
-- don't compute live from attempt_responses on every dashboard load.
create table public.user_topic_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  subtopic_id uuid not null references public.subtopics(id) on delete cascade,
  attempted_count integer not null default 0,
  correct_count integer not null default 0,
  avg_time_seconds numeric,
  updated_at timestamptz not null default now(),
  primary key (user_id, subtopic_id)
);

-- ============================================================================
-- SECTION 8: NOTES MODULE
-- ============================================================================

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id),
  title text not null,
  summary text not null,                -- always public, used as free preview
  content text not null,                -- gated, full body
  status public.note_status not null default 'draft',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_notes_unit on public.notes(unit_id);

-- ============================================================================
-- SECTION 9: ROW-LEVEL SECURITY
-- ============================================================================

alter table public.answers enable row level security;
alter table public.notes enable row level security;

-- answers: visible only if the user has an attempt_response referencing that
-- question (i.e. they've actually taken a test containing it), OR they hold
-- an active subscription whose plan grants test access. This is the one
-- policy that IS the paywall — without it, the anon key can read every
-- correct answer directly regardless of what the frontend shows.
create policy "answers_require_attempt_or_test_subscription" on public.answers
for select using (
  exists (
    select 1 from public.attempt_responses ar
    join public.test_attempts ta on ta.id = ar.attempt_id
    where ar.question_id = public.answers.question_id
      and ta.user_id = auth.uid()
  )
  or exists (
    select 1 from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.user_id = auth.uid()
      and s.status = 'active'
      and s.expires_at > now()
      and (p.features->>'tests')::boolean is true
  )
);

-- notes: full content gated on the SEPARATE notes entitlement (not the same
-- check as answers above) — Test Series and Notes are sold independently,
-- see plans.features. summary stays out of RLS scope; serve it unconditionally
-- from the app layer so free visitors can preview.
create policy "notes_content_requires_notes_entitlement" on public.notes
for select using (
  status = 'published' and exists (
    select 1 from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where s.user_id = auth.uid()
      and s.status = 'active'
      and s.expires_at > now()
      and (p.features->>'notes')::boolean is true
  )
);

-- questions / question_options / question_statements / question_match_items /
-- passages / units / topics / subtopics are intentionally left WITHOUT RLS —
-- a user needs to see the question and its options to attempt it at all.
-- Gate access to whole PREMIUM TESTS in the application layer: check
-- tests.is_premium against the user's subscription before returning
-- test_questions for a given test_id.

-- ============================================================================
-- SECTION 10: SEED DATA
-- ============================================================================

insert into public.plans (name, price_paise, duration_days, features, is_purchasable, sort_order) values
  ('Test Series', 14900, 30, '{"tests": true, "notes": false}', true, 1),
  ('Notes',       19900, 30, '{"tests": false, "notes": true}', false, 2),
  ('Combined',    29900, 30, '{"tests": true, "notes": true}', false, 3);

insert into public.units (name, sort_order) values
  ('Fundamentals of Forensic Science', 1),
  ('Analytical Techniques', 2),
  ('Forensic Biology & DNA', 3),
  ('Forensic Toxicology', 4),
  ('Forensic Ballistics', 5),
  ('Fire, Explosives & Investigation', 6),
  ('Trace Evidence & Digital Forensics', 7),
  ('Fingerprints & Biometric Systems', 8),
  ('Questioned Documents', 9),
  ('Forensic Medicine & Anthropology', 10);
