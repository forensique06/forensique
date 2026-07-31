import { NextResponse } from 'next/server'
import crypto from 'crypto'
import Razorpay from 'razorpay'
import { getSupabaseAdmin } from '@/lib/supabase/admin'

// Extract Supabase user from Bearer token
async function getUserFromRequest(request) {
  const auth = request.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return null
  const admin = getSupabaseAdmin()
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return null
  return data.user
}

async function requireAdmin(request) {
  const user = await getUserFromRequest(request)
  if (!user) return { error: 'Not authenticated', status: 401 }
  const admin = getSupabaseAdmin()
  const { data: prof } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (prof?.role !== 'admin') return { error: 'Admin only', status: 403 }
  return { user }
}

function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID
  const key_secret = process.env.RAZORPAY_KEY_SECRET
  if (!key_id || !key_secret) throw new Error('Razorpay keys not configured on server')
  return new Razorpay({ key_id, key_secret })
}

// ----------------------------------------------------------------------------
// POST /api/admin/import
// Body = the raw UGC_NET_FS JSON (see attached shape).
// Idempotent per question_code / test_id.
// ----------------------------------------------------------------------------
async function handleImport(request) {
  const check = await requireAdmin(request)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })
  const admin = getSupabaseAdmin()
  const payload = await request.json()

  // ---- Basic validation ----
  const requiredTop = ['test_id', 'test_type', 'total_questions', 'duration_minutes', 'questions']
  for (const k of requiredTop) if (!(k in payload)) return NextResponse.json({ error: `Missing field: ${k}` }, { status: 400 })
  if (!Array.isArray(payload.questions)) return NextResponse.json({ error: 'questions must be an array' }, { status: 400 })

  const warnings = []

  // Validate every question has exactly 4 options and correct label semantics
  for (const q of payload.questions) {
    if (!q.question_code) return NextResponse.json({ error: 'A question is missing question_code' }, { status: 400 })
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      return NextResponse.json({ error: `${q.question_code}: must have exactly 4 options` }, { status: 400 })
    }
    if (q.answer_status === 'valid' && !q.correct_option_label) {
      return NextResponse.json({ error: `${q.question_code}: valid question missing correct_option_label` }, { status: 400 })
    }
    if (q.answer_status === 'dropped' && q.correct_option_label) {
      warnings.push(`${q.question_code}: answer_status=dropped but has correct_option_label; ignoring.`)
    }
    if (q.passage_id) {
      const p = (payload.passages || []).find((x) => x.passage_id === q.passage_id)
      if (!p) return NextResponse.json({ error: `${q.question_code}: references passage ${q.passage_id} not in payload.passages` }, { status: 400 })
    }
  }

  // ---- 1. Upsert Exam ----
  const examName = payload.exam_name ? `${payload.exam_name} ${payload.session || ''} ${payload.year || ''}`.trim() : `Test ${payload.test_id}`
  const { data: existingExam } = await admin.from('exams').select('*')
    .eq('exam_name', payload.exam_name || examName).eq('session', payload.session || null).eq('year', payload.year || null).maybeSingle()
  let exam = existingExam
  if (!exam) {
    const { data: newExam, error: examErr } = await admin.from('exams').insert({
      exam_name: payload.exam_name || examName,
      subject: payload.subject || 'Forensic Science',
      paper: payload.paper || 'Paper-II',
      session: payload.session || null,
      year: payload.year || null,
      exam_date: payload.exam_date || null,
      agency: payload.agency || 'NTA',
    }).select().single()
    if (examErr) return NextResponse.json({ error: `Insert exam failed: ${examErr.message}` }, { status: 500 })
    exam = newExam
  }

  // ---- 2. Upsert Passages ----
  const passageMap = {} // passage_id (JSON) -> uuid
  for (const p of payload.passages || []) {
    const { data: existing } = await admin.from('passages').select('*')
      .eq('exam_id', exam.id).eq('passage_code', p.passage_id).maybeSingle()
    if (existing) { passageMap[p.passage_id] = existing.id; continue }
    const { data: newP, error } = await admin.from('passages').insert({
      exam_id: exam.id,
      passage_code: p.passage_id,
      passage_label: p.passage_label,
      passage_text: p.passage_text,
    }).select().single()
    if (error) return NextResponse.json({ error: `Insert passage failed: ${error.message}` }, { status: 500 })
    passageMap[p.passage_id] = newP.id
  }

  // ---- 3. Load/create taxonomy (units already seeded; topics/subtopics created on the fly) ----
  const { data: unitsAll } = await admin.from('units').select('*')
  const unitsByName = Object.fromEntries((unitsAll || []).map((u) => [u.name, u]))

  async function getOrCreateTopic(unitId, name) {
    if (!name) return null
    const { data: existing } = await admin.from('topics').select('*').eq('unit_id', unitId).eq('name', name).maybeSingle()
    if (existing) return existing.id
    const { data: newT, error } = await admin.from('topics').insert({ unit_id: unitId, name }).select().single()
    if (error) return null
    return newT.id
  }
  async function getOrCreateSubtopic(topicId, name) {
    if (!name || !topicId) return null
    const { data: existing } = await admin.from('subtopics').select('*').eq('topic_id', topicId).eq('name', name).maybeSingle()
    if (existing) return existing.id
    const { data: newS, error } = await admin.from('subtopics').insert({ topic_id: topicId, name }).select().single()
    if (error) return null
    return newS.id
  }

  // ---- 4. Upsert Test ----
  const isSampleFreeTrial = payload.test_id === 'UGC_NET_FS_2025_06'
  const testTitle = `${payload.exam_name || 'Test'}${payload.session ? ' ' + payload.session : ''}${payload.year ? ' ' + payload.year : ''} — ${payload.paper || 'Paper II'}`
  const { data: existingTest } = await admin.from('tests').select('*').eq('test_id', payload.test_id).maybeSingle()
  let test = existingTest
  if (!test) {
    const { data: newTest, error: testErr } = await admin.from('tests').insert({
      test_id: payload.test_id,
      title: testTitle,
      test_type: payload.test_type,
      exam_id: exam.id,
      total_questions: payload.total_questions,
      duration_minutes: payload.duration_minutes,
      marks_per_question: payload.marks_per_question ?? 2,
      negative_marking: !!payload.negative_marking,
      is_premium: !isSampleFreeTrial, // Free-trial rule: the June-2025 sample is public; everything else premium.
      status: 'published',
    }).select().single()
    if (testErr) return NextResponse.json({ error: `Insert test failed: ${testErr.message}` }, { status: 500 })
    test = newTest
  }

  // ---- 5. Insert Questions ----
  const questionsInserted = []
  let optionsCount = 0, statementsCount = 0, matchCount = 0, droppedCount = 0

  for (const q of payload.questions) {
    // Skip if already imported
    const { data: existingQ } = await admin.from('questions').select('id').eq('question_code', q.question_code).maybeSingle()
    let questionId = existingQ?.id

    // Unit / Topic / Subtopic resolution
    const unitRow = unitsByName[q.unit]
    if (!unitRow && q.unit) {
      warnings.push(`${q.question_code}: unit "${q.unit}" not in master list; created ad-hoc.`)
      const { data: newU } = await admin.from('units').insert({ name: q.unit }).select().single()
      if (newU) unitsByName[q.unit] = newU
    }
    const unitId = unitsByName[q.unit]?.id || null
    const topicId = await getOrCreateTopic(unitId, q.topic)
    const subtopicId = await getOrCreateSubtopic(topicId, q.subtopic)

    const qNum = parseInt((q.question_code.match(/(\d+)$/) || [])[1]) || null

    if (!questionId) {
      const { data: newQ, error: qErr } = await admin.from('questions').insert({
        question_code: q.question_code,
        exam_id: exam.id,
        question_number: qNum,
        unit_id: unitId,
        topic_id: topicId,
        subtopic_id: subtopicId,
        content_format: q.content_format || 'plain',
        question_text: q.question_text,
        passage_id: q.passage_id ? passageMap[q.passage_id] : null,
        is_negative_framing: !!q.is_negative_framing,
        status: 'published',
        answer_status: q.answer_status || 'valid',
        explanation: q.explanation || null,
      }).select().single()
      if (qErr) return NextResponse.json({ error: `Insert question ${q.question_code} failed: ${qErr.message}` }, { status: 500 })
      questionId = newQ.id

      // Options
      const optRows = q.options.map((o) => ({
        question_id: questionId,
        option_id: o.option_id,
        option_text: o.option_text,
        sort_order: parseInt(o.option_id) || 0,
      }))
      const { error: oErr } = await admin.from('question_options').insert(optRows)
      if (oErr) return NextResponse.json({ error: `Insert options for ${q.question_code} failed: ${oErr.message}` }, { status: 500 })
      optionsCount += optRows.length

      // Statements
      if (q.statements?.length) {
        const rows = q.statements.map((s, i) => ({ question_id: questionId, label: s.label, text: s.text, sort_order: i }))
        const { error } = await admin.from('question_statements').insert(rows)
        if (error) return NextResponse.json({ error: `Insert statements for ${q.question_code} failed: ${error.message}` }, { status: 500 })
        statementsCount += rows.length
      }

      // Match items
      if (q.match_left?.length || q.match_right?.length) {
        const rows = [
          ...(q.match_left || []).map((m, i) => ({ question_id: questionId, side: 'left', label: m.label, text: m.text, sort_order: i })),
          ...(q.match_right || []).map((m, i) => ({ question_id: questionId, side: 'right', label: m.label, text: m.text, sort_order: i })),
        ]
        const { error } = await admin.from('question_match_items').insert(rows)
        if (error) return NextResponse.json({ error: `Insert match items for ${q.question_code} failed: ${error.message}` }, { status: 500 })
        matchCount += rows.length
      }

      // Answer
      const ansRow = {
        question_id: questionId,
        correct_option_id: q.answer_status === 'dropped' ? null : q.correct_option_label,
        scoring_type: 'single_correct',
      }
      const { error: aErr } = await admin.from('answers').insert(ansRow)
      if (aErr) return NextResponse.json({ error: `Insert answer for ${q.question_code} failed: ${aErr.message}` }, { status: 500 })
    }

    if (q.answer_status === 'dropped') droppedCount++
    questionsInserted.push({ id: questionId, code: q.question_code })
  }

  // ---- 6. Link questions to test (test_questions) ----
  const tqRows = questionsInserted.map((q, idx) => ({
    test_id: test.id, question_id: q.id, sequence_number: idx + 1,
  }))
  const { error: tqErr } = await admin.from('test_questions').upsert(tqRows, { onConflict: 'test_id,question_id' })
  if (tqErr) return NextResponse.json({ error: `Link test_questions failed: ${tqErr.message}` }, { status: 500 })

  return NextResponse.json({
    ok: true,
    test: { id: test.id, test_id: test.test_id, title: test.title },
    counts: {
      questions: questionsInserted.length,
      passages: (payload.passages || []).length,
      options: optionsCount,
      statements: statementsCount,
      match_items: matchCount,
      dropped: droppedCount,
    },
    warnings,
  })
}

// ----------------------------------------------------------------------------
// POST /api/attempt/create  { test_id: <uuid> }
// Creates a test_attempts row + initializes not_visited attempt_responses.
// ----------------------------------------------------------------------------
async function handleCreateAttempt(request) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const admin = getSupabaseAdmin()
  const { test_id } = await request.json()
  if (!test_id) return NextResponse.json({ error: 'Missing test_id' }, { status: 400 })

  // Reuse in_progress attempt for the same test if it exists ("continue where you left off")
  const { data: existing } = await admin.from('test_attempts')
    .select('*').eq('user_id', user.id).eq('test_id', test_id).eq('status', 'in_progress').maybeSingle()
  if (existing) return NextResponse.json({ attempt_id: existing.id, resumed: true })

  const { data: attempt, error } = await admin.from('test_attempts').insert({
    user_id: user.id, test_id, status: 'in_progress',
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Initialize responses for every question in the test
  const { data: tqs } = await admin.from('test_questions').select('question_id').eq('test_id', test_id)
  if (tqs?.length) {
    const rows = tqs.map((r) => ({ attempt_id: attempt.id, question_id: r.question_id, status: 'not_visited' }))
    await admin.from('attempt_responses').upsert(rows, { onConflict: 'attempt_id,question_id' })
  }

  return NextResponse.json({ attempt_id: attempt.id, resumed: false })
}

// ----------------------------------------------------------------------------
// POST /api/attempt/submit  { attempt_id, auto_submitted? }
// Reads answers (via service key), computes score, updates rows.
// ----------------------------------------------------------------------------
async function handleSubmitAttempt(request) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const admin = getSupabaseAdmin()
  const { attempt_id, auto_submitted } = await request.json()
  if (!attempt_id) return NextResponse.json({ error: 'Missing attempt_id' }, { status: 400 })

  const { data: attempt } = await admin.from('test_attempts')
    .select('*, tests(marks_per_question, negative_marking, total_questions)')
    .eq('id', attempt_id).single()
  if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 })
  if (attempt.user_id !== user.id) return NextResponse.json({ error: 'Not your attempt' }, { status: 403 })
  if (attempt.status !== 'in_progress') return NextResponse.json({ error: 'Already submitted' }, { status: 400 })

  const { data: responses } = await admin.from('attempt_responses').select('*').eq('attempt_id', attempt_id)
  const qIds = responses.map((r) => r.question_id)
  const { data: answers } = await admin.from('answers').select('*').in('question_id', qIds)
  const { data: qs } = await admin.from('questions').select('id, answer_status').in('id', qIds)

  const ansByQ = Object.fromEntries((answers || []).map((a) => [a.question_id, a]))
  const qByQ = Object.fromEntries((qs || []).map((q) => [q.id, q]))

  let correct = 0, incorrect = 0, unattempted = 0
  const marks = Number(attempt.tests.marks_per_question ?? 2)
  const negMark = attempt.tests.negative_marking ? marks / 2 : 0

  const updates = responses.map((r) => {
    const q = qByQ[r.question_id]
    const ans = ansByQ[r.question_id]
    let isCorrect = null

    // Dropped questions -> always correct for grading, regardless of user answer.
    if (q?.answer_status === 'dropped') {
      isCorrect = true
      correct++
    } else if (!r.selected_option_id) {
      isCorrect = null
      unattempted++
    } else if (ans && ans.correct_option_id === r.selected_option_id) {
      isCorrect = true
      correct++
    } else {
      isCorrect = false
      incorrect++
    }

    return {
      attempt_id: attempt_id,
      question_id: r.question_id,
      selected_option_id: r.selected_option_id,
      status: r.status,
      is_correct: isCorrect,
      time_spent_seconds: r.time_spent_seconds || 0,
      answered_at: r.answered_at,
    }
  })

  await admin.from('attempt_responses').upsert(updates, { onConflict: 'attempt_id,question_id' })

  const score = correct * marks - incorrect * negMark
  const startedAt = new Date(attempt.started_at).getTime()
  const timeTaken = Math.floor((Date.now() - startedAt) / 1000)

  const { error: uErr } = await admin.from('test_attempts').update({
    status: auto_submitted ? 'auto_submitted' : 'submitted',
    submitted_at: new Date().toISOString(),
    time_taken_seconds: timeTaken,
    score,
    correct_count: correct,
    incorrect_count: incorrect,
    unattempted_count: unattempted,
  }).eq('id', attempt_id)
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, score, correct, incorrect, unattempted })
}

// ----------------------------------------------------------------------------
// POST /api/custom-test/create
// Body: { unit_ids: [], topic_ids: [], difficulties: [], count: N }
// Creates a tests row with is_user_generated=true and populates test_questions
// with a randomized selection from the matching pool.
// ----------------------------------------------------------------------------
async function handleCustomTestCreate(request) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const admin = getSupabaseAdmin()
  const { unit_ids = [], topic_ids = [], difficulties = [], count = 20 } = await request.json()
  if (count < 1) return NextResponse.json({ error: 'count must be >= 1' }, { status: 400 })

  let q = admin.from('questions').select('id').eq('status', 'published')
  if (unit_ids.length) q = q.in('unit_id', unit_ids)
  if (topic_ids.length) q = q.in('topic_id', topic_ids)
  if (difficulties.length && difficulties.length < 3) q = q.in('difficulty', difficulties)
  const { data: pool, error } = await q.limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!pool || pool.length === 0) return NextResponse.json({ error: 'No matching questions' }, { status: 400 })

  // Shuffle + take N
  const ids = pool.map((r) => r.id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  const chosen = ids.slice(0, Math.min(count, ids.length))

  const testKey = `CUSTOM_${user.id.slice(0, 8)}_${Date.now()}`
  const { data: t, error: tErr } = await admin.from('tests').insert({
    test_id: testKey,
    title: `Custom test · ${chosen.length} Q`,
    test_type: 'custom',
    total_questions: chosen.length,
    duration_minutes: Math.max(10, chosen.length * 1), // ~1 min per Q, min 10
    marks_per_question: 2,
    negative_marking: false,
    is_premium: false, // custom tests use the questions the user is already entitled to
    is_user_generated: true,
    created_by: user.id,
    status: 'published',
  }).select().single()
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  const tqRows = chosen.map((qid, i) => ({ test_id: t.id, question_id: qid, sequence_number: i + 1 }))
  const { error: tqErr } = await admin.from('test_questions').insert(tqRows)
  if (tqErr) return NextResponse.json({ error: tqErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, test_uuid: t.id, total: chosen.length })
}

// ----------------------------------------------------------------------------
// POST /api/billing/create-subscription  { plan_id: <uuid of plans row> }
// Creates Razorpay Customer + Subscription, seeds subscriptions row (status='created').
// ----------------------------------------------------------------------------
async function handleCreateSubscription(request) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const admin = getSupabaseAdmin()
  const { plan_id } = await request.json()
  if (!plan_id) return NextResponse.json({ error: 'Missing plan_id' }, { status: 400 })

  const { data: plan } = await admin.from('plans').select('*').eq('id', plan_id).maybeSingle()
  if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  // Enforce spec: non-purchasable plans reject at the endpoint, not just in the UI
  if (!plan.is_purchasable) return NextResponse.json({ error: 'This plan is not purchasable yet.' }, { status: 400 })
  if (!plan.razorpay_plan_id) return NextResponse.json({ error: 'This plan is not linked to a Razorpay plan yet. Ask an admin to set razorpay_plan_id.' }, { status: 500 })

  const { data: profile } = await admin.from('profiles').select('*').eq('id', user.id).maybeSingle()

  let rzp
  try { rzp = getRazorpay() } catch (e) { return NextResponse.json({ error: e.message }, { status: 500 }) }

  // Create / fail_existing=0 Razorpay customer
  let customer
  try {
    customer = await rzp.customers.create({
      name: profile?.full_name || user.email?.split('@')[0] || 'Forensique User',
      email: user.email,
      contact: profile?.phone || undefined,
      fail_existing: 0,
    })
  } catch (e) {
    return NextResponse.json({ error: `Razorpay customer error: ${e?.error?.description || e.message}` }, { status: 500 })
  }

  // Create subscription
  let subscription
  try {
    subscription = await rzp.subscriptions.create({
      plan_id: plan.razorpay_plan_id,
      total_count: 12,           // 12 monthly cycles then auto-expires; user can renew
      quantity: 1,
      customer_notify: 1,
      notes: { forensique_user_id: user.id, forensique_plan_id: plan.id },
    })
  } catch (e) {
    return NextResponse.json({ error: `Razorpay subscription error: ${e?.error?.description || e.message}` }, { status: 500 })
  }

  // Seed subscriptions row (webhook will update to 'active' later). We set
  // expires_at to a placeholder 30 days out — webhook overwrites with real
  // current_end when subscription.activated fires.
  const now = new Date()
  const placeholderExpiry = new Date(now.getTime() + 30 * 86400 * 1000)
  await admin.from('subscriptions').upsert({
    user_id: user.id,
    plan_id: plan.id,
    razorpay_customer_id: customer.id,
    razorpay_subscription_id: subscription.id,
    status: 'past_due', // stays past_due until webhook confirms activation
    started_at: now.toISOString(),
    expires_at: placeholderExpiry.toISOString(),
  }, { onConflict: 'razorpay_subscription_id' })

  return NextResponse.json({
    subscription_id: subscription.id,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID,
  })
}

// ----------------------------------------------------------------------------
// POST /api/billing/verify  { razorpay_payment_id, razorpay_subscription_id, razorpay_signature }
// Verify HMAC of (payment_id|subscription_id) with API secret. Not the source
// of truth for status — the webhook is — but flips status to 'active' fast so
// the user sees premium unlocked immediately after Checkout.
// ----------------------------------------------------------------------------
async function handleVerify(request) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const admin = getSupabaseAdmin()
  const body = await request.json()
  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = body
  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return NextResponse.json({ error: 'Missing signature params' }, { status: 400 })
  }
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) return NextResponse.json({ error: 'Razorpay not configured' }, { status: 500 })
  const expected = crypto.createHmac('sha256', secret)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(razorpay_signature)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: 'Signature mismatch' }, { status: 400 })
  }
  await admin.from('subscriptions').update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('razorpay_subscription_id', razorpay_subscription_id).eq('user_id', user.id)
  return NextResponse.json({ ok: true })
}

// ----------------------------------------------------------------------------
// POST /api/billing/cancel  { razorpay_subscription_id }
// Cancels at end of current cycle so user keeps access until expires_at.
// ----------------------------------------------------------------------------
async function handleCancel(request) {
  const user = await getUserFromRequest(request)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const admin = getSupabaseAdmin()
  const { razorpay_subscription_id } = await request.json()
  if (!razorpay_subscription_id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Ownership check
  const { data: sub } = await admin.from('subscriptions').select('*')
    .eq('razorpay_subscription_id', razorpay_subscription_id).maybeSingle()
  if (!sub || sub.user_id !== user.id) return NextResponse.json({ error: 'Not your subscription' }, { status: 403 })

  try {
    const rzp = getRazorpay()
    await rzp.subscriptions.cancel(razorpay_subscription_id, { cancel_at_cycle_end: 1 })
  } catch (e) {
    return NextResponse.json({ error: `Razorpay cancel failed: ${e?.error?.description || e.message}` }, { status: 500 })
  }
  await admin.from('subscriptions').update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
    .eq('razorpay_subscription_id', razorpay_subscription_id)
  return NextResponse.json({ ok: true })
}

// ----------------------------------------------------------------------------
// POST /api/webhooks/razorpay
// Raw-body HMAC validation against RAZORPAY_WEBHOOK_SECRET.
// Idempotency: (provider, provider_event_id) unique. First insert wins;
// duplicates return 200 with a no-op.
// ----------------------------------------------------------------------------
async function handleRazorpayWebhook(request) {
  const rawBody = await request.text()
  const sig = request.headers.get('x-razorpay-signature') || ''
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(sig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json({ ok: false, error: 'Signature mismatch' }, { status: 401 })
  }

  let evt
  try { evt = JSON.parse(rawBody) } catch { return NextResponse.json({ error: 'Bad JSON' }, { status: 400 }) }

  const admin = getSupabaseAdmin()
  // Idempotency key: event + subject id + created_at (Razorpay doesn't send a stable event id)
  const sub = evt?.payload?.subscription?.entity
  const pay = evt?.payload?.payment?.entity
  const subjectId = sub?.id || pay?.id || 'unknown'
  const providerEventId = `${evt.event}:${subjectId}:${evt.created_at}`

  const { error: dupErr } = await admin.from('payment_events').insert({
    provider: 'razorpay',
    provider_event_id: providerEventId,
    event_type: evt.event,
    payload: evt,
  })
  if (dupErr) {
    // Unique-key violation ⇒ we've already processed this event. Return 200.
    if (dupErr.code === '23505') return NextResponse.json({ ok: true, duplicate: true })
    return NextResponse.json({ error: dupErr.message }, { status: 500 })
  }

  // Update subscription state
  if (sub?.id && evt.event.startsWith('subscription.')) {
    const statusMap = {
      'subscription.activated': 'active',
      'subscription.charged': 'active',
      'subscription.pending': 'past_due',
      'subscription.halted': 'past_due',
      'subscription.cancelled': 'cancelled',
      'subscription.completed': 'expired',
    }
    const nextStatus = statusMap[evt.event] || sub.status || 'active'
    const patch = {
      status: nextStatus,
      razorpay_customer_id: sub.customer_id || undefined,
      updated_at: new Date().toISOString(),
    }
    if (sub.current_start) patch.started_at = new Date(sub.current_start * 1000).toISOString()
    if (sub.current_end) patch.expires_at = new Date(sub.current_end * 1000).toISOString()
    if (evt.event === 'subscription.cancelled') patch.cancel_at_period_end = true

    await admin.from('subscriptions').update(patch).eq('razorpay_subscription_id', sub.id)
  }

  return NextResponse.json({ ok: true })
}
async function dispatch(request, method) {
  const url = new URL(request.url)
  const path = url.pathname.replace(/^\/api/, '')

  if (method === 'POST' && path === '/admin/import') return handleImport(request)
  if (method === 'POST' && path === '/attempt/create') return handleCreateAttempt(request)
  if (method === 'POST' && path === '/attempt/submit') return handleSubmitAttempt(request)
  if (method === 'POST' && path === '/custom-test/create') return handleCustomTestCreate(request)
  if (method === 'POST' && path === '/billing/create-subscription') return handleCreateSubscription(request)
  if (method === 'POST' && path === '/billing/verify') return handleVerify(request)
  if (method === 'POST' && path === '/billing/cancel') return handleCancel(request)
  if (method === 'POST' && path === '/webhooks/razorpay') return handleRazorpayWebhook(request)
  if (method === 'GET' && path === '/health') return NextResponse.json({ ok: true, ts: Date.now() })

  return NextResponse.json({ error: `No route for ${method} ${path}` }, { status: 404 })
}

export async function GET(request) { return dispatch(request, 'GET') }
export async function POST(request) { return dispatch(request, 'POST') }
export async function PUT(request) { return dispatch(request, 'PUT') }
export async function DELETE(request) { return dispatch(request, 'DELETE') }
