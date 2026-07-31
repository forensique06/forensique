-- ============================================================================
-- Forensique — 001_base_schema.sql
-- The v3 base schema + handle_new_user trigger.
-- Combines what was originally in /public/forensique_schema_and_trigger.sql,
-- with the stripe_* → razorpay_* rename applied inline. Idempotent.
-- ============================================================================

create extension if not exists pgcrypto;

do $$ begin create type public.test_type as enum ('previous_year','topic_wise','custom','full_mock'); exception when duplicate_object then null; end $$;
do $$ begin create type public.content_format as enum ('plain','statement_based','arrangement','match_following'); exception when duplicate_object then null; end $$;
do $$ begin create type public.answer_status as enum ('valid','dropped'); exception when duplicate_object then null; end $$;
do $$ begin create type public.question_status as enum ('draft','published','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.attempt_status as enum ('in_progress','submitted','auto_submitted','abandoned'); exception when duplicate_object then null; end $$;
do $$ begin create type public.response_status as enum ('not_visited','not_answered','answered','marked_for_review','answered_and_marked'); exception when duplicate_object then null; end $$;
do $$ begin create type public.subscription_status as enum ('active','past_due','cancelled','expired'); exception when duplicate_object then null; end $$;
do $$ begin create type public.note_status as enum ('draft','published'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, email text unique not null, full_name text, role text not null default 'student', created_at timestamptz not null default now());
create table if not exists public.plans (id uuid primary key default gen_random_uuid(), name text not null, price_paise integer not null, duration_days integer not null default 30, features jsonb not null default '{}'::jsonb, is_purchasable boolean not null default false, is_active boolean not null default true, razorpay_plan_id text, sort_order integer not null default 0, created_at timestamptz not null default now());
create table if not exists public.subscriptions (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, plan_id uuid not null references public.plans(id), status public.subscription_status not null default 'active', started_at timestamptz not null default now(), expires_at timestamptz not null, cancel_at_period_end boolean not null default false, razorpay_customer_id text, razorpay_subscription_id text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.payment_events (id uuid primary key default gen_random_uuid(), provider text not null default 'razorpay', provider_event_id text not null, event_type text not null, payload jsonb, processed_at timestamptz not null default now(), unique (provider, provider_event_id));
create table if not exists public.units (id uuid primary key default gen_random_uuid(), name text not null unique, sort_order integer not null default 0);
create table if not exists public.topics (id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id) on delete cascade, name text not null, sort_order integer not null default 0, unique (unit_id, name));
create table if not exists public.subtopics (id uuid primary key default gen_random_uuid(), topic_id uuid not null references public.topics(id) on delete cascade, name text not null, sort_order integer not null default 0, unique (topic_id, name));
create table if not exists public.exams (id uuid primary key default gen_random_uuid(), exam_name text not null, subject text not null default 'Forensic Science', paper text not null default 'Paper-II', session text, year integer, exam_date date, agency text default 'NTA');
create table if not exists public.passages (id uuid primary key default gen_random_uuid(), exam_id uuid references public.exams(id) on delete cascade, passage_code text not null, passage_label text, passage_text text not null, unique (exam_id, passage_code));
create table if not exists public.questions (id uuid primary key default gen_random_uuid(), question_code text not null unique, exam_id uuid references public.exams(id) on delete set null, question_number integer, unit_id uuid references public.units(id), topic_id uuid references public.topics(id), subtopic_id uuid references public.subtopics(id), content_format public.content_format not null default 'plain', question_text text not null, passage_id uuid references public.passages(id), difficulty text default 'medium', marks numeric not null default 2, negative_marks numeric not null default 0, is_negative_framing boolean not null default false, status public.question_status not null default 'draft', answer_status public.answer_status not null default 'valid', explanation text, answer_key_version integer not null default 1, revised_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.question_statements (id uuid primary key default gen_random_uuid(), question_id uuid not null references public.questions(id) on delete cascade, label text not null, text text not null, sort_order integer not null default 0, unique (question_id, label));
create table if not exists public.question_match_items (id uuid primary key default gen_random_uuid(), question_id uuid not null references public.questions(id) on delete cascade, side text not null check (side in ('left','right')), label text not null, text text not null, sort_order integer not null default 0, unique (question_id, side, label));
create table if not exists public.question_options (id uuid primary key default gen_random_uuid(), question_id uuid not null references public.questions(id) on delete cascade, option_id text not null, option_text text not null, sort_order integer not null default 0, unique (question_id, option_id));
create table if not exists public.answers (question_id uuid primary key references public.questions(id) on delete cascade, correct_option_id text, correct_option_ids text[], scoring_type text not null default 'single_correct');
create table if not exists public.tests (id uuid primary key default gen_random_uuid(), test_id text not null unique, title text not null, test_type public.test_type not null, exam_id uuid references public.exams(id), total_questions integer not null, duration_minutes integer not null, marks_per_question numeric not null default 2, negative_marking boolean not null default false, is_premium boolean not null default true, is_user_generated boolean not null default false, created_by uuid references public.profiles(id), status text not null default 'published', created_at timestamptz not null default now());
create table if not exists public.test_questions (test_id uuid not null references public.tests(id) on delete cascade, question_id uuid not null references public.questions(id), sequence_number integer not null, marks_override numeric, primary key (test_id, question_id));
create table if not exists public.test_attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, test_id uuid not null references public.tests(id), status public.attempt_status not null default 'in_progress', started_at timestamptz not null default now(), submitted_at timestamptz, time_taken_seconds integer, score numeric, correct_count integer, incorrect_count integer, unattempted_count integer, created_at timestamptz not null default now());
create table if not exists public.attempt_responses (attempt_id uuid not null references public.test_attempts(id) on delete cascade, question_id uuid not null references public.questions(id), selected_option_id text, status public.response_status not null default 'not_visited', is_correct boolean, time_spent_seconds integer not null default 0, answered_at timestamptz, primary key (attempt_id, question_id));
create table if not exists public.bookmarks (user_id uuid not null references public.profiles(id) on delete cascade, question_id uuid not null references public.questions(id) on delete cascade, created_at timestamptz not null default now(), primary key (user_id, question_id));
create table if not exists public.practice_attempts (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, question_id uuid not null references public.questions(id), selected_option_id text, is_correct boolean, attempted_at timestamptz not null default now());
create table if not exists public.user_topic_stats (user_id uuid not null references public.profiles(id) on delete cascade, subtopic_id uuid not null references public.subtopics(id) on delete cascade, attempted_count integer not null default 0, correct_count integer not null default 0, avg_time_seconds numeric, updated_at timestamptz not null default now(), primary key (user_id, subtopic_id));
create table if not exists public.notes (id uuid primary key default gen_random_uuid(), unit_id uuid not null references public.units(id), slug text not null unique, title text not null, summary text not null, status public.note_status not null default 'published', sort_order integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

insert into public.plans (name, price_paise, duration_days, features, is_purchasable, sort_order)
select * from (values ('Test Series', 14900, 30, '{"tests": true, "notes": false}'::jsonb, true, 1), ('Notes', 19900, 30, '{"tests": false, "notes": true}'::jsonb, false, 2), ('Combined', 29900, 30, '{"tests": true, "notes": true}'::jsonb, false, 3)) as v(name, price_paise, duration_days, features, is_purchasable, sort_order)
where not exists (select 1 from public.plans where public.plans.name = v.name);

insert into public.units (name, sort_order)
select * from (values ('Fundamentals of Forensic Science', 1), ('Analytical Techniques', 2), ('Forensic Biology & DNA', 3), ('Forensic Toxicology', 4), ('Forensic Ballistics', 5), ('Fire, Explosives & Investigation', 6), ('Trace Evidence & Digital Forensics', 7), ('Fingerprints & Biometric Systems', 8), ('Questioned Documents', 9), ('Forensic Medicine & Anthropology', 10)) as v(name, sort_order)
where not exists (select 1 from public.units where public.units.name = v.name);
