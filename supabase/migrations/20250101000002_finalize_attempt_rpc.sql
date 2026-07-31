-- 003_finalize_attempt_rpc.sql
-- Postgres RPC that replaces the Next.js /api/attempt/submit endpoint.
-- Called via supabase.rpc('finalize_attempt', { p_attempt_id, p_auto }).
-- SECURITY DEFINER so it can read answers (RLS-gated) and write is_correct
-- (column-grant restricted). Verifies auth.uid() ownership before doing
-- anything.
create or replace function public.finalize_attempt(p_attempt_id uuid, p_auto boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_attempt record;
  v_marks numeric;
  v_neg numeric;
  v_correct int := 0;
  v_incorrect int := 0;
  v_unattempted int := 0;
  v_score numeric;
  v_time_taken int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_authenticated'); end if;
  select ta.*, t.marks_per_question, t.negative_marking into v_attempt
    from test_attempts ta join tests t on t.id = ta.test_id where ta.id = p_attempt_id;
  if v_attempt.id is null then return jsonb_build_object('ok', false, 'error', 'attempt_not_found'); end if;
  if v_attempt.user_id <> v_uid then return jsonb_build_object('ok', false, 'error', 'not_your_attempt'); end if;
  if v_attempt.status <> 'in_progress' then return jsonb_build_object('ok', false, 'error', 'already_submitted'); end if;

  v_marks := coalesce(v_attempt.marks_per_question, 2);
  v_neg := case when v_attempt.negative_marking then v_marks / 2 else 0 end;

  update attempt_responses ar set is_correct = case
    when q.answer_status = 'dropped' then true
    when ar.selected_option_id is null then null
    when a.correct_option_id = ar.selected_option_id then true
    else false end
  from questions q left join answers a on a.question_id = q.id
  where ar.attempt_id = p_attempt_id and q.id = ar.question_id;

  select count(*) filter (where is_correct is true), count(*) filter (where is_correct is false), count(*) filter (where is_correct is null)
    into v_correct, v_incorrect, v_unattempted from attempt_responses where attempt_id = p_attempt_id;

  v_score := v_correct * v_marks - v_incorrect * v_neg;
  v_time_taken := greatest(0, extract(epoch from (now() - v_attempt.started_at))::int);

  update test_attempts set
    status = case when p_auto then 'auto_submitted'::attempt_status else 'submitted'::attempt_status end,
    submitted_at = now(), time_taken_seconds = v_time_taken,
    score = v_score, correct_count = v_correct, incorrect_count = v_incorrect, unattempted_count = v_unattempted
  where id = p_attempt_id;

  return jsonb_build_object('ok', true, 'score', v_score, 'correct', v_correct, 'incorrect', v_incorrect, 'unattempted', v_unattempted, 'time_taken_seconds', v_time_taken);
end; $$;

revoke all on function public.finalize_attempt(uuid, boolean) from public;
grant execute on function public.finalize_attempt(uuid, boolean) to authenticated;
