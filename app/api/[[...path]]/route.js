import { NextResponse } from 'next/server'
import crypto from 'crypto'
import Razorpay from 'razorpay'
import { getSupabaseAdmin } from '@/lib/supabase/admin'
import { getTestEntitlement } from '@/lib/auth/entitlements'

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

  if (!user) {
    return { error: 'Not authenticated', status: 401 }
  }

  const admin = getSupabaseAdmin()

  const { data: prof } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle()

  if (prof?.role !== 'admin') {
    return { error: 'Admin only', status: 403 }
  }

  return { user }
}

function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID
  const key_secret = process.env.RAZORPAY_KEY_SECRET

  if (!key_id || !key_secret) {
    throw new Error('Razorpay keys not configured on server')
  }

  return new Razorpay({
    key_id,
    key_secret,
  })
}

// ----------------------------------------------------------------------------
// POST /api/admin/import
//
// Body = raw UGC_NET_FS JSON.
//
// IMPORTANT:
// - Validates the entire payload BEFORE writing anything.
// - Rejects placeholder questions/options.
// - Updates existing questions instead of skipping them.
// - Replaces old options/statements/match-items/answers.
// ----------------------------------------------------------------------------
async function handleImport(request) {
  const check = await requireAdmin(request)

  if (check.error) {
    return NextResponse.json(
      { error: check.error },
      { status: check.status }
    )
  }

  const admin = getSupabaseAdmin()

  let payload

  try {
    payload = await request.json()
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid JSON: ${error.message}` },
      { status: 400 }
    )
  }

  // --------------------------------------------------------------------------
  // 1. BASIC PAYLOAD VALIDATION
  // --------------------------------------------------------------------------

  const requiredTop = [
    'test_id',
    'test_type',
    'total_questions',
    'duration_minutes',
    'questions',
  ]

  for (const key of requiredTop) {
    if (!(key in payload)) {
      return NextResponse.json(
        { error: `Missing field: ${key}` },
        { status: 400 }
      )
    }
  }

  if (!Array.isArray(payload.questions)) {
    return NextResponse.json(
      { error: 'questions must be an array' },
      { status: 400 }
    )
  }

  if (
    payload.questions.length !==
    Number(payload.total_questions)
  ) {
    return NextResponse.json(
      {
        error:
          `Question count mismatch: test declares ` +
          `${payload.total_questions}, but payload contains ` +
          `${payload.questions.length}.`,
      },
      { status: 400 }
    )
  }

  // --------------------------------------------------------------------------
  // 2. VALIDATE COMPLETE PAYLOAD BEFORE ANY DATABASE WRITE
  // --------------------------------------------------------------------------

  const warnings = []
  const seenCodes = new Set()

  // These patterns identify the corrupted data that appeared in January.
  const placeholderQuestion =
    /^Question\s+\d+(?:\s+as extracted from|\s+based on Passage)/i

  const placeholderOption =
    /^Option\s+[1-4]$/i

  for (const q of payload.questions) {
    // question_code
    if (!q?.question_code) {
      return NextResponse.json(
        {
          error:
            'A question is missing question_code',
        },
        { status: 400 }
      )
    }

    // Duplicate question_code
    if (seenCodes.has(q.question_code)) {
      return NextResponse.json(
        {
          error:
            `Duplicate question_code in payload: ` +
            `${q.question_code}`,
        },
        { status: 400 }
      )
    }

    seenCodes.add(q.question_code)

    // question_text
    if (
      typeof q.question_text !== 'string' ||
      !q.question_text.trim()
    ) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: question_text is missing or empty`,
        },
        { status: 400 }
      )
    }

    // Reject corrupted placeholder questions.
    if (placeholderQuestion.test(q.question_text.trim())) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: question_text looks like ` +
            `importer placeholder data ` +
            `("${q.question_text}"). ` +
            `Import cancelled so bad content cannot enter ` +
            `the database.`,
        },
        { status: 400 }
      )
    }

    // Every question in this application must have four options.
    if (
      !Array.isArray(q.options) ||
      q.options.length !== 4
    ) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: must have exactly 4 options`,
        },
        { status: 400 }
      )
    }

    // Validate option IDs.
    const optionIds = q.options.map(
      (o) => String(o?.option_id ?? '')
    )

    const uniqueOptionIds = new Set(optionIds)

    if (
      uniqueOptionIds.size !== 4 ||
      !['1', '2', '3', '4'].every(
        (id) => uniqueOptionIds.has(id)
      )
    ) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: options must have exactly ` +
            `the labels 1, 2, 3, 4`,
        },
        { status: 400 }
      )
    }

    // Validate option text.
    for (const o of q.options) {
      if (
        typeof o?.option_text !== 'string' ||
        !o.option_text.trim()
      ) {
        return NextResponse.json(
          {
            error:
              `${q.question_code}: option ` +
              `${o?.option_id ?? '?'} is empty`,
          },
          { status: 400 }
        )
      }

      // Reject corrupted "Option 1", "Option 2", etc.
      if (placeholderOption.test(o.option_text.trim())) {
        return NextResponse.json(
          {
            error:
              `${q.question_code}: option ` +
              `${o.option_id} contains placeholder data ` +
              `("${o.option_text}"). Import cancelled.`,
          },
          { status: 400 }
        )
      }
    }

    // Answer validation.
    if (
      q.answer_status === 'valid' &&
      !q.correct_option_label
    ) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: valid question missing ` +
            `correct_option_label`,
        },
        { status: 400 }
      )
    }

    if (
      q.answer_status === 'valid' &&
      !['1', '2', '3', '4'].includes(
        String(q.correct_option_label)
      )
    ) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: correct_option_label must ` +
            `be 1, 2, 3, or 4`,
        },
        { status: 400 }
      )
    }

    if (
      q.answer_status === 'dropped' &&
      q.correct_option_label
    ) {
      warnings.push(
        `${q.question_code}: answer_status=dropped but ` +
        `has correct_option_label; storing NULL.`
      )
    }

    // Passage validation.
    if (q.passage_id) {
      const passages = Array.isArray(payload.passages)
        ? payload.passages
        : []

      const passage = passages.find(
        (p) => p.passage_id === q.passage_id
      )

      if (!passage) {
        return NextResponse.json(
          {
            error:
              `${q.question_code}: references passage ` +
              `${q.passage_id} not in payload.passages`,
          },
          { status: 400 }
        )
      }
    }
  }

  // --------------------------------------------------------------------------
  // 3. UPSERT EXAM
  // --------------------------------------------------------------------------

  const examName = payload.exam_name
    ? `${payload.exam_name} ${payload.session || ''} ${payload.year || ''}`.trim()
    : `Test ${payload.test_id}`

  const { data: existingExam, error: examLookupError } =
    await admin
      .from('exams')
      .select('*')
      .eq('exam_name', payload.exam_name || examName)
      .eq('session', payload.session || null)
      .eq('year', payload.year || null)
      .maybeSingle()

  if (examLookupError) {
    return NextResponse.json(
      {
        error:
          `Exam lookup failed: ${examLookupError.message}`,
      },
      { status: 500 }
    )
  }

  let exam = existingExam

  if (!exam) {
    const { data: newExam, error: examErr } =
      await admin
        .from('exams')
        .insert({
          exam_name:
            payload.exam_name || examName,
          subject:
            payload.subject || 'Forensic Science',
          paper:
            payload.paper || 'Paper-II',
          session:
            payload.session || null,
          year:
            payload.year || null,
          exam_date:
            payload.exam_date || null,
          agency:
            payload.agency || 'NTA',
        })
        .select()
        .single()

    if (examErr) {
      return NextResponse.json(
        {
          error:
            `Insert exam failed: ${examErr.message}`,
        },
        { status: 500 }
      )
    }

    exam = newExam
  }

  // --------------------------------------------------------------------------
  // 4. UPSERT PASSAGES
  // --------------------------------------------------------------------------

  const passageMap = {}

  for (const p of payload.passages || []) {
    if (!p?.passage_id) {
      return NextResponse.json(
        {
          error: 'A passage is missing passage_id',
        },
        { status: 400 }
      )
    }

    const { data: existing, error: passageLookupError } =
      await admin
        .from('passages')
        .select('*')
        .eq('exam_id', exam.id)
        .eq('passage_code', p.passage_id)
        .maybeSingle()

    if (passageLookupError) {
      return NextResponse.json(
        {
          error:
            `Passage lookup failed for ${p.passage_id}: ` +
            `${passageLookupError.message}`,
        },
        { status: 500 }
      )
    }

    if (existing) {
      const {
        data: updated,
        error: updateErr,
      } = await admin
        .from('passages')
        .update({
          passage_label:
            p.passage_label || null,
          passage_text:
            p.passage_text || '',
        })
        .eq('id', existing.id)
        .select()
        .single()

      if (updateErr) {
        return NextResponse.json(
          {
            error:
              `Update passage failed: ${updateErr.message}`,
          },
          { status: 500 }
        )
      }

      passageMap[p.passage_id] = updated.id
      continue
    }

    const { data: newP, error } =
      await admin
        .from('passages')
        .insert({
          exam_id: exam.id,
          passage_code: p.passage_id,
          passage_label:
            p.passage_label || null,
          passage_text:
            p.passage_text || '',
        })
        .select()
        .single()

    if (error) {
      return NextResponse.json(
        {
          error:
            `Insert passage failed: ${error.message}`,
        },
        { status: 500 }
      )
    }

    passageMap[p.passage_id] = newP.id
  }

  // --------------------------------------------------------------------------
  // 5. LOAD / CREATE TAXONOMY
  // --------------------------------------------------------------------------

  const { data: unitsAll, error: unitsError } =
    await admin
      .from('units')
      .select('*')

  if (unitsError) {
    return NextResponse.json(
      {
        error:
          `Loading units failed: ${unitsError.message}`,
      },
      { status: 500 }
    )
  }

  const unitsByName = Object.fromEntries(
    (unitsAll || []).map((u) => [
      u.name,
      u,
    ])
  )

  async function getOrCreateTopic(unitId, name) {
    if (!name) return null

    // If there is no unit, do not create a broken topic.
    if (!unitId) return null

    const {
      data: existing,
      error: lookupError,
    } = await admin
      .from('topics')
      .select('*')
      .eq('unit_id', unitId)
      .eq('name', name)
      .maybeSingle()

    if (lookupError) return null
    if (existing) return existing.id

    const {
      data: newT,
      error,
    } = await admin
      .from('topics')
      .insert({
        unit_id: unitId,
        name,
      })
      .select()
      .single()

    if (error) return null

    return newT.id
  }

  async function getOrCreateSubtopic(
    topicId,
    name
  ) {
    if (!name || !topicId) return null

    const {
      data: existing,
      error: lookupError,
    } = await admin
      .from('subtopics')
      .select('*')
      .eq('topic_id', topicId)
      .eq('name', name)
      .maybeSingle()

    if (lookupError) return null
    if (existing) return existing.id

    const {
      data: newS,
      error,
    } = await admin
      .from('subtopics')
      .insert({
        topic_id: topicId,
        name,
      })
      .select()
      .single()

    if (error) return null

    return newS.id
  }

  // --------------------------------------------------------------------------
  // 6. UPSERT TEST
  // --------------------------------------------------------------------------

  const isSampleFreeTrial =
    payload.test_id === 'UGC_NET_FS_2025_06'

  const testTitle =
    `${payload.exam_name || 'Test'}` +
    `${payload.session ? ' ' + payload.session : ''}` +
    `${payload.year ? ' ' + payload.year : ''}` +
    ` — ${payload.paper || 'Paper II'}`

  const {
    data: existingTest,
    error: testLookupError,
  } = await admin
    .from('tests')
    .select('*')
    .eq('test_id', payload.test_id)
    .maybeSingle()

  if (testLookupError) {
    return NextResponse.json(
      {
        error:
          `Test lookup failed: ${testLookupError.message}`,
      },
      { status: 500 }
    )
  }

  let test = existingTest

  if (!test) {
    const {
      data: newTest,
      error: testErr,
    } = await admin
      .from('tests')
      .insert({
        test_id:
          payload.test_id,
        title:
          testTitle,
        test_type:
          payload.test_type,
        exam_id:
          exam.id,
        total_questions:
          payload.total_questions,
        duration_minutes:
          payload.duration_minutes,
        marks_per_question:
          payload.marks_per_question ?? 2,
        negative_marking:
          !!payload.negative_marking,
        is_premium:
          !isSampleFreeTrial,
        status:
          'published',
      })
      .select()
      .single()

    if (testErr) {
      return NextResponse.json(
        {
          error:
            `Insert test failed: ${testErr.message}`,
        },
        { status: 500 }
      )
    }

    test = newTest
  } else {
    const {
      data: updatedTest,
      error: testUpdateErr,
    } = await admin
      .from('tests')
      .update({
        title:
          testTitle,
        test_type:
          payload.test_type,
        exam_id:
          exam.id,
        total_questions:
          payload.total_questions,
        duration_minutes:
          payload.duration_minutes,
        marks_per_question:
          payload.marks_per_question ?? 2,
        negative_marking:
          !!payload.negative_marking,
        is_premium:
          isSampleFreeTrial
            ? false
            : test.is_premium,
        status:
          'published',
      })
      .eq('id', test.id)
      .select()
      .single()

    if (testUpdateErr) {
      return NextResponse.json(
        {
          error:
            `Update test failed: ${testUpdateErr.message}`,
        },
        { status: 500 }
      )
    }

    test = updatedTest
  }

  // --------------------------------------------------------------------------
  // 7. UPSERT QUESTIONS
  // --------------------------------------------------------------------------

  const questionsInserted = []

  let optionsCount = 0
  let statementsCount = 0
  let matchCount = 0
  let droppedCount = 0
  let updatedCount = 0

  for (const q of payload.questions) {
    const {
      data: existingQ,
      error: existingQError,
    } = await admin
      .from('questions')
      .select('id')
      .eq(
        'question_code',
        q.question_code
      )
      .maybeSingle()

    if (existingQError) {
      return NextResponse.json(
        {
          error:
            `Question lookup failed for ` +
            `${q.question_code}: ` +
            `${existingQError.message}`,
        },
        { status: 500 }
      )
    }

    let questionId = existingQ?.id

    // --------------------------------------------------------
    // Taxonomy
    // --------------------------------------------------------

    let unitRow =
      unitsByName[q.unit]

    if (!unitRow && q.unit) {
      warnings.push(
        `${q.question_code}: unit "${q.unit}" ` +
        `not in master list; created ad-hoc.`
      )

      const {
        data: newU,
        error: unitError,
      } = await admin
        .from('units')
        .insert({
          name: q.unit,
        })
        .select()
        .single()

      if (unitError) {
        return NextResponse.json(
          {
            error:
              `Create unit "${q.unit}" failed: ` +
              `${unitError.message}`,
          },
          { status: 500 }
        )
      }

      if (newU) {
        unitsByName[q.unit] = newU
        unitRow = newU
      }
    }

    const unitId =
      unitsByName[q.unit]?.id || null

    const topicId =
      await getOrCreateTopic(
        unitId,
        q.topic
      )

    const subtopicId =
      await getOrCreateSubtopic(
        topicId,
        q.subtopic
      )

    // Extract question number from:
    // UGC_NET_FS_2025_JAN_Q026
    // UGC_NET_FS_2025_06_Q001
    const qNum =
      parseInt(
        (
          q.question_code.match(
            /(\d+)$/
          ) || []
        )[1]
      ) || null

    // --------------------------------------------------------
    // Question row
    // --------------------------------------------------------

    const questionPatch = {
      question_code:
        q.question_code,

      exam_id:
        exam.id,

      question_number:
        qNum,

      unit_id:
        unitId,

      topic_id:
        topicId,

      subtopic_id:
        subtopicId,

      content_format:
        q.content_format || 'plain',

      question_text:
        q.question_text.trim(),

      passage_id:
        q.passage_id
          ? passageMap[q.passage_id]
          : null,

      is_negative_framing:
        !!q.is_negative_framing,

      status:
        'published',

      answer_status:
        q.answer_status || 'valid',

      explanation:
        q.explanation || null,

      updated_at:
        new Date().toISOString(),
    }

    if (questionId) {
      const {
        error: qErr,
      } = await admin
        .from('questions')
        .update(questionPatch)
        .eq('id', questionId)

      if (qErr) {
        return NextResponse.json(
          {
            error:
              `Update question ` +
              `${q.question_code} failed: ` +
              `${qErr.message}`,
          },
          { status: 500 }
        )
      }

      updatedCount++

      // ------------------------------------------------------
      // IMPORTANT:
      // Delete old child rows before inserting the correct
      // source data. This repairs the existing January rows.
      // ------------------------------------------------------

      for (const table of [
        'question_options',
        'question_statements',
        'question_match_items',
      ]) {
        const {
          error: deleteErr,
        } = await admin
          .from(table)
          .delete()
          .eq(
            'question_id',
            questionId
          )

        if (deleteErr) {
          return NextResponse.json(
            {
              error:
                `Clear ${table} for ` +
                `${q.question_code} failed: ` +
                `${deleteErr.message}`,
            },
            { status: 500 }
          )
        }
      }

      const {
        error: deleteAnswerErr,
      } = await admin
        .from('answers')
        .delete()
        .eq(
          'question_id',
          questionId
        )

      if (deleteAnswerErr) {
        return NextResponse.json(
          {
            error:
              `Clear answer for ` +
              `${q.question_code} failed: ` +
              `${deleteAnswerErr.message}`,
          },
          { status: 500 }
        )
      }
    } else {
      const {
        data: newQ,
        error: qErr,
      } = await admin
        .from('questions')
        .insert(questionPatch)
        .select()
        .single()

      if (qErr) {
        return NextResponse.json(
          {
            error:
              `Insert question ` +
              `${q.question_code} failed: ` +
              `${qErr.message}`,
          },
          { status: 500 }
        )
      }

      questionId = newQ.id
    }

    // --------------------------------------------------------
    // OPTIONS
    // --------------------------------------------------------

    const optRows = q.options.map(
      (o) => ({
        question_id:
          questionId,

        option_id:
          String(o.option_id),

        option_text:
          o.option_text.trim(),

        sort_order:
          parseInt(o.option_id) || 0,
      })
    )

    const {
      error: oErr,
    } = await admin
      .from('question_options')
      .insert(optRows)

    if (oErr) {
      return NextResponse.json(
        {
          error:
            `Insert options for ` +
            `${q.question_code} failed: ` +
            `${oErr.message}`,
        },
        { status: 500 }
      )
    }

    optionsCount +=
      optRows.length

    // --------------------------------------------------------
    // STATEMENTS
    // --------------------------------------------------------

    if (
      Array.isArray(q.statements) &&
      q.statements.length
    ) {
      const rows =
        q.statements.map(
          (s, i) => ({
            question_id:
              questionId,

            label:
              s.label,

            text:
              s.text,

            sort_order:
              i,
          })
        )

      const {
        error,
      } = await admin
        .from('question_statements')
        .insert(rows)

      if (error) {
        return NextResponse.json(
          {
            error:
              `Insert statements for ` +
              `${q.question_code} failed: ` +
              `${error.message}`,
          },
          { status: 500 }
        )
      }

      statementsCount +=
        rows.length
    }

    // --------------------------------------------------------
    // MATCHING ITEMS
    // --------------------------------------------------------

    if (
      q.match_left?.length ||
      q.match_right?.length
    ) {
      const rows = [
        ...(q.match_left || []).map(
          (m, i) => ({
            question_id:
              questionId,

            side:
              'left',

            label:
              m.label,

            text:
              m.text,

            sort_order:
              i,
          })
        ),

        ...(q.match_right || []).map(
          (m, i) => ({
            question_id:
              questionId,

            side:
              'right',

            label:
              m.label,

            text:
              m.text,

            sort_order:
              i,
          })
        ),
      ]

      const {
        error,
      } = await admin
        .from('question_match_items')
        .insert(rows)

      if (error) {
        return NextResponse.json(
          {
            error:
              `Insert match items for ` +
              `${q.question_code} failed: ` +
              `${error.message}`,
          },
          { status: 500 }
        )
      }

      matchCount +=
        rows.length
    }

    // --------------------------------------------------------
    // ANSWER
    // --------------------------------------------------------

    const ansRow = {
      question_id:
        questionId,

      correct_option_id:
        q.answer_status === 'dropped'
          ? null
          : String(
              q.correct_option_label
            ),

      scoring_type:
        'single_correct',
    }

    const {
      error: aErr,
    } = await admin
      .from('answers')
      .insert(ansRow)

    if (aErr) {
      return NextResponse.json(
        {
          error:
            `Insert answer for ` +
            `${q.question_code} failed: ` +
            `${aErr.message}`,
        },
        { status: 500 }
      )
    }

    if (
      q.answer_status ===
      'dropped'
    ) {
      droppedCount++
    }

    questionsInserted.push({
      id:
        questionId,

      code:
        q.question_code,
    })
  }

  // --------------------------------------------------------------------------
  // 8. LINK QUESTIONS TO TEST
  // --------------------------------------------------------------------------

  const tqRows =
    questionsInserted.map(
      (q, idx) => ({
        test_id:
          test.id,

        question_id:
          q.id,

        sequence_number:
          idx + 1,
      })
    )

  const {
    error: tqErr,
  } = await admin
    .from('test_questions')
    .upsert(
      tqRows,
      {
        onConflict:
          'test_id,question_id',
      }
    )

  if (tqErr) {
    return NextResponse.json(
      {
        error:
          `Link test_questions failed: ` +
          `${tqErr.message}`,
      },
      { status: 500 }
    )
  }

  // --------------------------------------------------------------------------
  // 9. SUCCESS RESPONSE
  // --------------------------------------------------------------------------

  return NextResponse.json({
    ok: true,

    test: {
      id:
        test.id,

      test_id:
        test.test_id,

      title:
        test.title,
    },

    counts: {
      questions:
        questionsInserted.length,

      updated:
        updatedCount,

      passages:
        (payload.passages || []).length,

      options:
        optionsCount,

      statements:
        statementsCount,

      match_items:
        matchCount,

      dropped:
        droppedCount,
    },

    warnings,
  })
}

// ----------------------------------------------------------------------------
// POST /api/attempt/create
// ----------------------------------------------------------------------------

async function handleCreateAttempt(request) {
  const user =
    await getUserFromRequest(request)

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  const admin =
    getSupabaseAdmin()

  const {
    test_id,
  } = await request.json()

  if (!test_id) {
    return NextResponse.json(
      { error: 'Missing test_id' },
      { status: 400 }
    )
  }

  // The client can submit any test UUID to this endpoint, so authorization
  // must happen here before an attempt is created.
  const entitlement = await getTestEntitlement(user.id)
  const { data: requestedTest, error: testLookupError } = await admin
    .from('tests')
    .select('id, is_premium, status')
    .eq('id', test_id)
    .maybeSingle()

  if (testLookupError) {
    return NextResponse.json(
      { error: testLookupError.message },
      { status: 500 }
    )
  }

  if (!requestedTest || requestedTest.status !== 'published') {
    return NextResponse.json(
      { error: 'Test not found' },
      { status: 404 }
    )
  }

  if (requestedTest.is_premium && !entitlement.entitled) {
    return NextResponse.json(
      { error: 'An active Test Series subscription is required for this test.' },
      { status: 403 }
    )
  }

  // Reuse in-progress attempt.
  const {
    data: existing,
  } = await admin
    .from('test_attempts')
    .select('*')
    .eq(
      'user_id',
      user.id
    )
    .eq(
      'test_id',
      test_id
    )
    .eq(
      'status',
      'in_progress'
    )
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      attempt_id:
        existing.id,

      resumed:
        true,
    })
  }

  const {
    data: attempt,
    error,
  } = await admin
    .from('test_attempts')
    .insert({
      user_id:
        user.id,

      test_id:
        test_id,

      status:
        'in_progress',
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }

  // Initialize responses.
  const {
    data: tqs,
  } = await admin
    .from('test_questions')
    .select('question_id')
    .eq(
      'test_id',
      test_id
    )

  if (tqs?.length) {
    const rows =
      tqs.map(
        (r) => ({
          attempt_id:
            attempt.id,

          question_id:
            r.question_id,

          status:
            'not_visited',
        })
      )

    await admin
      .from('attempt_responses')
      .upsert(
        rows,
        {
          onConflict:
            'attempt_id,question_id',
        }
      )
  }

  return NextResponse.json({
    attempt_id:
      attempt.id,

    resumed:
      false,
  })
}

// ----------------------------------------------------------------------------
// POST /api/attempt/submit
// ----------------------------------------------------------------------------

async function handleSubmitAttempt(request) {
  const user =
    await getUserFromRequest(request)

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  const admin =
    getSupabaseAdmin()

  const {
    attempt_id,
    auto_submitted,
  } = await request.json()

  if (!attempt_id) {
    return NextResponse.json(
      { error: 'Missing attempt_id' },
      { status: 400 }
    )
  }

  const {
    data: attempt,
  } = await admin
    .from('test_attempts')
    .select(
      '*, tests(marks_per_question, negative_marking, total_questions)'
    )
    .eq(
      'id',
      attempt_id
    )
    .single()

  if (!attempt) {
    return NextResponse.json(
      { error: 'Attempt not found' },
      { status: 404 }
    )
  }

  if (
    attempt.user_id !==
    user.id
  ) {
    return NextResponse.json(
      { error: 'Not your attempt' },
      { status: 403 }
    )
  }

  if (
    attempt.status !==
    'in_progress'
  ) {
    return NextResponse.json(
      { error: 'Already submitted' },
      { status: 400 }
    )
  }

  const {
    data: responses,
  } = await admin
    .from('attempt_responses')
    .select('*')
    .eq(
      'attempt_id',
      attempt_id
    )

  const qIds =
    (responses || []).map(
      (r) => r.question_id
    )

  const {
    data: answers,
  } = qIds.length
    ? await admin
        .from('answers')
        .select('*')
        .in(
          'question_id',
          qIds
        )
    : { data: [] }

  const {
    data: qs,
  } = qIds.length
    ? await admin
        .from('questions')
        .select(
          'id, answer_status'
        )
        .in(
          'id',
          qIds
        )
    : { data: [] }

  const ansByQ =
    Object.fromEntries(
      (answers || []).map(
        (a) => [
          a.question_id,
          a,
        ]
      )
    )

  const qByQ =
    Object.fromEntries(
      (qs || []).map(
        (q) => [
          q.id,
          q,
        ]
      )
    )

  let correct = 0
  let incorrect = 0
  let unattempted = 0

  const marks =
    Number(
      attempt.tests
        ?.marks_per_question ?? 2
    )

  const negMark =
    attempt.tests
      ?.negative_marking
      ? marks / 2
      : 0

  const updates =
    (responses || []).map(
      (r) => {
        const q =
          qByQ[r.question_id]

        const ans =
          ansByQ[r.question_id]

        let isCorrect = null

        // Dropped questions are treated as correct.
        if (
          q?.answer_status ===
          'dropped'
        ) {
          isCorrect = true
          correct++
        } else if (
          !r.selected_option_id
        ) {
          isCorrect = null
          unattempted++
        } else if (
          ans &&
          ans.correct_option_id ===
            r.selected_option_id
        ) {
          isCorrect = true
          correct++
        } else {
          isCorrect = false
          incorrect++
        }

        return {
          attempt_id:
            attempt_id,

          question_id:
            r.question_id,

          selected_option_id:
            r.selected_option_id,

          status:
            r.status,

          is_correct:
            isCorrect,

          time_spent_seconds:
            r.time_spent_seconds ||
            0,

          answered_at:
            r.answered_at,
        }
      }
    )

  if (updates.length) {
    await admin
      .from('attempt_responses')
      .upsert(
        updates,
        {
          onConflict:
            'attempt_id,question_id',
        }
      )
  }

  const score =
    correct * marks -
    incorrect * negMark

  const startedAt =
    new Date(
      attempt.started_at
    ).getTime()

  const timeTaken =
    Math.floor(
      (Date.now() -
        startedAt) /
        1000
    )

  const {
    error: uErr,
  } = await admin
    .from('test_attempts')
    .update({
      status:
        auto_submitted
          ? 'auto_submitted'
          : 'submitted',

      submitted_at:
        new Date().toISOString(),

      time_taken_seconds:
        timeTaken,

      score,

      correct_count:
        correct,

      incorrect_count:
        incorrect,

      unattempted_count:
        unattempted,
    })
    .eq(
      'id',
      attempt_id
    )

  if (uErr) {
    return NextResponse.json(
      { error: uErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    score,
    correct,
    incorrect,
    unattempted,
  })
}

// ----------------------------------------------------------------------------
// POST /api/custom-test/create
// ----------------------------------------------------------------------------

async function handleCustomTestCreate(request) {
  const user =
    await getUserFromRequest(request)

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  // Custom tests are a premium Test Series feature. This check is server-side
  // and cannot be bypassed by changing the client request body.
  const entitlement = await getTestEntitlement(user.id)
  if (!entitlement.entitled) {
    return NextResponse.json(
      { error: 'Custom tests require an active Test Series subscription.' },
      { status: 403 }
    )
  }

  const admin =
    getSupabaseAdmin()

  const {
    unit_ids = [],
    topic_ids = [],
    difficulties = [],
    count = 20,
  } = await request.json()

  if (count < 1) {
    return NextResponse.json(
      { error: 'count must be >= 1' },
      { status: 400 }
    )
  }

  let q =
    admin
      .from('questions')
      .select('id')
      .eq(
        'status',
        'published'
      )

  if (unit_ids.length) {
    q = q.in(
      'unit_id',
      unit_ids
    )
  }

  if (topic_ids.length) {
    q = q.in(
      'topic_id',
      topic_ids
    )
  }

  if (
    difficulties.length &&
    difficulties.length < 3
  ) {
    q = q.in(
      'difficulty',
      difficulties
    )
  }

  const {
    data: pool,
    error,
  } = await q.limit(2000)

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    )
  }

  if (
    !pool ||
    pool.length === 0
  ) {
    return NextResponse.json(
      {
        error:
          'No matching questions',
      },
      { status: 400 }
    )
  }

  const ids =
    pool.map(
      (r) => r.id
    )

  // Fisher-Yates shuffle.
  for (
    let i = ids.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1)
      )

    ;[
      ids[i],
      ids[j],
    ] = [
      ids[j],
      ids[i],
    ]
  }

  const chosen =
    ids.slice(
      0,
      Math.min(
        count,
        ids.length
      )
    )

  const testKey =
    `CUSTOM_${user.id.slice(0, 8)}_${Date.now()}`

  const {
    data: t,
    error: tErr,
  } = await admin
    .from('tests')
    .insert({
      test_id:
        testKey,

      title:
        `Custom test · ${chosen.length} Q`,

      test_type:
        'custom',

      total_questions:
        chosen.length,

      duration_minutes:
        Math.max(
          10,
          chosen.length * 1
        ),

      marks_per_question:
        2,

      negative_marking:
        false,

      is_premium:
        true,

      is_user_generated:
        true,

      created_by:
        user.id,

      status:
        'published',
    })
    .select()
    .single()

  if (tErr) {
    return NextResponse.json(
      { error: tErr.message },
      { status: 500 }
    )
  }

  const tqRows =
    chosen.map(
      (qid, i) => ({
        test_id:
          t.id,

        question_id:
          qid,

        sequence_number:
          i + 1,
      })
    )

  const {
    error: tqErr,
  } = await admin
    .from('test_questions')
    .insert(tqRows)

  if (tqErr) {
    return NextResponse.json(
      { error: tqErr.message },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    test_uuid:
      t.id,
    total:
      chosen.length,
  })
}

// ----------------------------------------------------------------------------
// POST /api/billing/create-subscription
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// POST /api/billing/create-subscription
// ----------------------------------------------------------------------------

async function handleCreateSubscription(request) {
  const user = await getUserFromRequest(request)

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  const admin = getSupabaseAdmin()

  let body

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const { plan_id } = body || {}

  if (!plan_id) {
    return NextResponse.json(
      { error: 'Missing plan_id' },
      { status: 400 }
    )
  }

  // --------------------------------------------------------------------------
  // Load the plan from our database.
  // --------------------------------------------------------------------------

  const {
    data: plan,
    error: planError,
  } = await admin
    .from('plans')
    .select('*')
    .eq('id', plan_id)
    .maybeSingle()

  if (planError) {
    return NextResponse.json(
      {
        error:
          `Failed to load plan: ${planError.message}`,
      },
      { status: 500 }
    )
  }

  if (!plan) {
    return NextResponse.json(
      { error: 'Plan not found' },
      { status: 404 }
    )
  }

  if (!plan.is_active) {
    return NextResponse.json(
      { error: 'This plan is not active.' },
      { status: 400 }
    )
  }

  if (!plan.is_purchasable) {
    return NextResponse.json(
      {
        error:
          'This plan is not purchasable yet.',
      },
      { status: 400 }
    )
  }

  if (!plan.razorpay_plan_id) {
    return NextResponse.json(
      {
        error:
          'This plan is not linked to a Razorpay plan yet.',
      },
      { status: 500 }
    )
  }

  // --------------------------------------------------------------------------
  // Initialise Razorpay.
  // --------------------------------------------------------------------------

  let rzp

  try {
    rzp = getRazorpay()
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e?.message ||
          'Razorpay is not configured on the server.',
      },
      { status: 500 }
    )
  }

  // --------------------------------------------------------------------------
  // Do not create a second active subscription for the same user/plan.
  //
  // --------------------------------------------------------------------------
// Check the user's existing subscriptions before creating another one.
// --------------------------------------------------------------------------

const {
  data: existingSubscriptions,
  error: existingSubscriptionError,
} = await admin
  .from('subscriptions')
  .select(
    'id, plan_id, razorpay_subscription_id, status, expires_at, cancel_at_period_end'
  )
  .eq('user_id', user.id)
  .order('created_at', {
    ascending: false,
  })

if (existingSubscriptionError) {
  return NextResponse.json(
    {
      error:
        `Unable to check existing subscriptions: ${existingSubscriptionError.message}`,
    },
    { status: 500 }
  )
}

const currentTime = new Date()

const activeSubscription =
  (existingSubscriptions || []).find((sub) => {
    return (
      sub.status === 'active' &&
      sub.expires_at &&
      new Date(sub.expires_at) > currentTime
    )
  }) || null

const unfinishedSubscription =
  (existingSubscriptions || []).find((sub) => {
    return ['created', 'past_due'].includes(sub.status)
  }) || null

// --------------------------------------------------------------------------
// An active Combined subscription means the user already has the highest
// available plan.
// --------------------------------------------------------------------------

if (
  activeSubscription &&
  activeSubscription.plan_id === plan.id
) {
  return NextResponse.json(
    {
      error:
        'You already have an active subscription for this plan.',
      subscription_id:
        activeSubscription.razorpay_subscription_id,
    },
    { status: 409 }
  )
}

// --------------------------------------------------------------------------
// If the user is already on Combined, do not allow another subscription.
// --------------------------------------------------------------------------

if (
  activeSubscription &&
  activeSubscription.plan_id !== plan.id
) {
  const {
    data: activePlan,
  } = await admin
    .from('plans')
    .select('id, name')
    .eq('id', activeSubscription.plan_id)
    .maybeSingle()

  if (activePlan?.name === 'Combined') {
    return NextResponse.json(
      {
        error:
          'You already have an active Combined subscription.',
        subscription_id:
          activeSubscription.razorpay_subscription_id,
      },
      { status: 409 }
    )
  }

  // Allow an upgrade from another active plan to Combined.
  if (plan.name !== 'Combined') {
    return NextResponse.json(
      {
        error:
          'You already have an active subscription.',
        subscription_id:
          activeSubscription.razorpay_subscription_id,
      },
      { status: 409 }
    )
  }
}

// --------------------------------------------------------------------------
// Do not create another subscription while an earlier one is still
// being created or has an unresolved payment state.
// --------------------------------------------------------------------------

if (unfinishedSubscription) {
  return NextResponse.json(
    {
      error:
        'You already have a subscription that is still being processed. Please wait before starting another subscription.',
      subscription_id:
        unfinishedSubscription.razorpay_subscription_id,
    },
    { status: 409 }
  )
}
  // --------------------------------------------------------------------------
  // Create the Razorpay subscription.
  //
  // IMPORTANT:
  // Do NOT create a Razorpay customer here.
  //
  // Razorpay creates/associates the customer during the subscription
  // authorization Checkout flow.
  // --------------------------------------------------------------------------

  let subscription

  try {
    subscription =
      await rzp.subscriptions.create({
        plan_id:
          plan.razorpay_plan_id,

        total_count:
          12,

        quantity:
          1,

        customer_notify:
          1,

        notes: {
          forensique_user_id:
            user.id,

          forensique_plan_id:
            plan.id,
        },
      })
  } catch (e) {
    const description =
      e?.error?.description ||
      e?.description ||
      e?.message ||
      'Unknown Razorpay error.'

    return NextResponse.json(
      {
        error:
          `Razorpay subscription error: ${description}`,
      },
      { status: 500 }
    )
  }

  // --------------------------------------------------------------------------
  // Save the newly-created subscription in Supabase.
  //
  // The Razorpay subscription is initially "created".
  // Webhooks will later update it to active/pending/etc.
  // --------------------------------------------------------------------------

  const now = new Date()

  const placeholderExpiry = new Date(
    now.getTime() +
      30 *
        86400 *
        1000
  )

  const {
    error: subscriptionRowError,
  } = await admin
    .from('subscriptions')
    .insert({
      user_id:
        user.id,

      plan_id:
        plan.id,

      // Razorpay associates the customer after
      // the authorization transaction.
      razorpay_customer_id:
        subscription.customer_id ||
        null,

      razorpay_subscription_id:
        subscription.id,

      status:
  'created',

      started_at:
        now.toISOString(),

      expires_at:
        placeholderExpiry.toISOString(),
    })

  if (subscriptionRowError) {
    // We created the Razorpay subscription but failed
    // to persist our local record. Try to cancel the
    // orphaned Razorpay subscription immediately.
    try {
      await rzp.subscriptions.cancel(
        subscription.id,
        {
          cancel_at_cycle_end:
            false,
        }
      )
    } catch (cleanupError) {
      console.error(
        'Failed to clean up orphaned Razorpay subscription:',
        cleanupError
      )
    }

    return NextResponse.json(
      {
        error:
          `Subscription record could not be saved: ${subscriptionRowError.message}`,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    subscription_id:
      subscription.id,

    razorpay_key_id:
      process.env.RAZORPAY_KEY_ID,
  })
}


// ----------------------------------------------------------------------------
// POST /api/billing/verify
//
// Body:
// {
//   razorpay_payment_id,
//   razorpay_subscription_id,
//   razorpay_signature
// }
// ----------------------------------------------------------------------------

async function handleVerify(request) {
  const user =
    await getUserFromRequest(request)

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  const admin =
    getSupabaseAdmin()

  let body

  try {
    body =
      await request.json()
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 }
    )
  }

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
  } = body || {}

  if (
    !razorpay_payment_id ||
    !razorpay_subscription_id ||
    !razorpay_signature
  ) {
    return NextResponse.json(
      {
        error:
          'Missing Razorpay verification parameters.',
      },
      { status: 400 }
    )
  }

  // --------------------------------------------------------------------------
  // First make sure this subscription belongs to the logged-in user.
  // --------------------------------------------------------------------------

  const {
    data: localSubscription,
    error: subscriptionLookupError,
  } = await admin
    .from('subscriptions')
    .select(
      `
        id,
        user_id,
        plan_id,
        razorpay_subscription_id,
        status,
        expires_at
      `
    )
    .eq(
      'razorpay_subscription_id',
      razorpay_subscription_id
    )
    .maybeSingle()

  if (subscriptionLookupError) {
    return NextResponse.json(
      {
        error:
          `Unable to find subscription: ${subscriptionLookupError.message}`,
      },
      { status: 500 }
    )
  }

  if (!localSubscription) {
    return NextResponse.json(
      {
        error:
          'Subscription was not found in our database.',
      },
      { status: 404 }
    )
  }

  if (
    localSubscription.user_id !==
    user.id
  ) {
    return NextResponse.json(
      {
        error:
          'This subscription does not belong to the current user.',
      },
      { status: 403 }
    )
  }

  // --------------------------------------------------------------------------
  // Verify Razorpay signature.
  //
  // Razorpay subscription verification uses:
  //
  // payment_id + "|" + subscription_id
  //
  // signed using RAZORPAY_KEY_SECRET.
  // --------------------------------------------------------------------------

  const secret =
    process.env.RAZORPAY_KEY_SECRET

  if (!secret) {
    return NextResponse.json(
      {
        error:
          'Razorpay is not configured on the server.',
      },
      { status: 500 }
    )
  }

  const expected =
    crypto
      .createHmac(
        'sha256',
        secret
      )
      .update(
        `${razorpay_payment_id}|${razorpay_subscription_id}`
      )
      .digest('hex')

  const expectedBuffer =
    Buffer.from(expected)

  const receivedBuffer =
    Buffer.from(
      razorpay_signature
    )

  if (
    expectedBuffer.length !==
      receivedBuffer.length ||
    !crypto.timingSafeEqual(
      expectedBuffer,
      receivedBuffer
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Razorpay signature verification failed.',
      },
      { status: 400 }
    )
  }

  // --------------------------------------------------------------------------
  // Fetch the subscription directly from Razorpay.
  //
  // This prevents us from blindly trusting the status supplied by the
  // browser callback.
  // --------------------------------------------------------------------------

  let providerSubscription

  try {
    const rzp =
      getRazorpay()

    providerSubscription =
      await rzp.subscriptions.fetch(
        razorpay_subscription_id
      )
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Unable to verify Razorpay subscription: ${
            e?.error?.description ||
            e?.message ||
            'Unknown Razorpay error.'
          }`,
      },
      { status: 500 }
    )
  }

  // --------------------------------------------------------------------------
  // Make sure the provider subscription is actually for the plan we sold.
  // --------------------------------------------------------------------------

  const {
    data: localPlan,
    error: planLookupError,
  } = await admin
    .from('plans')
    .select(
      'id, name, razorpay_plan_id'
    )
    .eq(
      'id',
      localSubscription.plan_id
    )
    .maybeSingle()

  if (planLookupError) {
    return NextResponse.json(
      {
        error:
          `Unable to verify plan: ${planLookupError.message}`,
      },
      { status: 500 }
    )
  }

  if (
    !localPlan ||
    localPlan.razorpay_plan_id !==
      providerSubscription.plan_id
  ) {
    return NextResponse.json(
      {
        error:
          'Razorpay subscription does not match the selected plan.',
      },
      { status: 400 }
    )
  }

  // --------------------------------------------------------------------------
  // Map the actual Razorpay state to our application state.
  //
  // For the current immediate-start Test Series subscription, a successful
  // authorization should result in "active".
  //
  // If Razorpay reports "authenticated" instead, keep the local subscription
  // non-active and let the webhook move it to active when appropriate.
  // --------------------------------------------------------------------------

  let nextStatus = 'created'

  if (
    providerSubscription.status ===
    'active'
  ) {
    nextStatus = 'active'
  } else if (
    providerSubscription.status ===
    'pending'
  ) {
    nextStatus = 'past_due'
  } else if (
    providerSubscription.status ===
    'halted'
  ) {
    nextStatus = 'past_due'
  } else if (
    providerSubscription.status ===
    'cancelled'
  ) {
    nextStatus = 'cancelled'
  } else if (
    providerSubscription.status ===
    'completed'
  ) {
    nextStatus = 'expired'
  } else if (
    providerSubscription.status ===
    'expired'
  ) {
    nextStatus = 'expired'
  }

  const patch = {
    status:
      nextStatus,

    updated_at:
      new Date().toISOString(),
  }

  if (
    providerSubscription.customer_id
  ) {
    patch.razorpay_customer_id =
      providerSubscription.customer_id
  }

  if (
    providerSubscription.current_start
  ) {
    patch.started_at =
      new Date(
        providerSubscription.current_start *
          1000
      ).toISOString()
  }

  if (
    providerSubscription.current_end
  ) {
    patch.expires_at =
      new Date(
        providerSubscription.current_end *
          1000
      ).toISOString()
  }

  const {
    error: updateError,
  } = await admin
    .from('subscriptions')
    .update(patch)
    .eq(
      'id',
      localSubscription.id
    )
    .eq(
      'user_id',
      user.id
    )

  if (updateError) {
    return NextResponse.json(
      {
        error:
          `Payment was verified but the subscription could not be updated: ${updateError.message}`,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({
    ok: true,
    status: nextStatus,
  })
}

// ----------------------------------------------------------------------------
// POST /api/billing/cancel
// ----------------------------------------------------------------------------

async function handleCancel(request) {
  const user =
    await getUserFromRequest(request)

  if (!user) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    )
  }

  const admin =
    getSupabaseAdmin()

  const {
    razorpay_subscription_id,
  } = await request.json()

  if (
    !razorpay_subscription_id
  ) {
    return NextResponse.json(
      { error: 'Missing id' },
      { status: 400 }
    )
  }

  const {
    data: sub,
  } = await admin
    .from('subscriptions')
    .select('*')
    .eq(
      'razorpay_subscription_id',
      razorpay_subscription_id
    )
    .maybeSingle()

  if (
    !sub ||
    sub.user_id !== user.id
  ) {
    return NextResponse.json(
      {
        error:
          'Not your subscription',
      },
      { status: 403 }
    )
  }

  try {
    const rzp =
      getRazorpay()

    await rzp.subscriptions.cancel(
      razorpay_subscription_id,
      {
        cancel_at_cycle_end:
          1,
      }
    )
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Razorpay cancel failed: ` +
          `${e?.error?.description || e.message}`,
      },
      { status: 500 }
    )
  }

  await admin
    .from('subscriptions')
    .update({
      cancel_at_period_end:
        true,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      'razorpay_subscription_id',
      razorpay_subscription_id
    )

  return NextResponse.json({
    ok: true,
  })
}

// ----------------------------------------------------------------------------
// POST /api/webhooks/razorpay
// ----------------------------------------------------------------------------

async function handleRazorpayWebhook(request) {
  const rawBody =
    await request.text()

  const sig =
    request.headers.get(
      'x-razorpay-signature'
    ) || ''

  const secret =
    process.env.RAZORPAY_WEBHOOK_SECRET

  if (!secret) {
    return NextResponse.json(
      {
        error:
          'Webhook secret not configured',
      },
      { status: 500 }
    )
  }

  const expected =
    crypto
      .createHmac(
        'sha256',
        secret
      )
      .update(rawBody)
      .digest('hex')

  const a =
    Buffer.from(expected)

  const b =
    Buffer.from(sig)

  if (
    a.length !== b.length ||
    !crypto.timingSafeEqual(
      a,
      b
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Signature mismatch',
      },
      { status: 401 }
    )
  }

  let evt

  try {
    evt =
      JSON.parse(rawBody)
  } catch {
    return NextResponse.json(
      { error: 'Bad JSON' },
      { status: 400 }
    )
  }

  const admin =
    getSupabaseAdmin()

  const sub =
    evt?.payload
      ?.subscription
      ?.entity

  const pay =
    evt?.payload
      ?.payment
      ?.entity

  const subjectId =
    sub?.id ||
    pay?.id ||
    'unknown'

  const providerEventId =
    `${evt.event}:${subjectId}:${evt.created_at}`

  const {
    error: dupErr,
  } = await admin
    .from('payment_events')
    .insert({
      provider:
        'razorpay',

      provider_event_id:
        providerEventId,

      event_type:
        evt.event,

      payload:
        evt,
    })

  if (dupErr) {
    // Already processed.
    if (
      dupErr.code ===
      '23505'
    ) {
      return NextResponse.json({
        ok: true,
        duplicate:
          true,
      })
    }

    return NextResponse.json(
      {
        error:
          dupErr.message,
      },
      { status: 500 }
    )
  }

  // Update subscription state.
  if (
    sub?.id &&
    evt.event.startsWith(
      'subscription.'
    )
  ) {
    const statusMap = {
      'subscription.activated':
        'active',

      'subscription.charged':
        'active',

      'subscription.pending':
        'past_due',

      'subscription.halted':
        'past_due',

      'subscription.cancelled':
        'cancelled',

      'subscription.completed':
        'expired',
    }

    const nextStatus =
      statusMap[evt.event] ||
      sub.status ||
      'active'

    const patch = {
      status:
        nextStatus,

      razorpay_customer_id:
        sub.customer_id ||
        undefined,

      updated_at:
        new Date().toISOString(),
    }

    if (
      sub.current_start
    ) {
      patch.started_at =
        new Date(
          sub.current_start *
            1000
        ).toISOString()
    }

    if (
      sub.current_end
    ) {
      patch.expires_at =
        new Date(
          sub.current_end *
            1000
        ).toISOString()
    }

    if (
      evt.event ===
      'subscription.cancelled'
    ) {
      patch.cancel_at_period_end =
        true
    }

    await admin
      .from('subscriptions')
      .update(patch)
      .eq(
        'razorpay_subscription_id',
        sub.id
      )
  }

  return NextResponse.json({
    ok: true,
  })
}

// ----------------------------------------------------------------------------
// DISPATCHER
// ----------------------------------------------------------------------------

async function dispatch(
  request,
  method
) {
  const url =
    new URL(request.url)

  const path =
    url.pathname.replace(
      /^\/api/,
      ''
    )

  if (
    method === 'POST' &&
    path === '/admin/import'
  ) {
    return handleImport(
      request
    )
  }

  if (
    method === 'POST' &&
    path === '/attempt/create'
  ) {
    return handleCreateAttempt(
      request
    )
  }

  if (
    method === 'POST' &&
    path === '/attempt/submit'
  ) {
    return handleSubmitAttempt(
      request
    )
  }

  if (
    method === 'POST' &&
    path === '/custom-test/create'
  ) {
    return handleCustomTestCreate(
      request
    )
  }

  if (
    method === 'POST' &&
    path === '/billing/create-subscription'
  ) {
    return handleCreateSubscription(
      request
    )
  }

  if (
    method === 'POST' &&
    path === '/billing/verify'
  ) {
    return handleVerify(
      request
    )
  }

  if (
    method === 'POST' &&
    path === '/billing/cancel'
  ) {
    return handleCancel(
      request
    )
  }

  if (
    method === 'POST' &&
    path === '/webhooks/razorpay'
  ) {
    return handleRazorpayWebhook(
      request
    )
  }

  if (
    method === 'GET' &&
    path === '/health'
  ) {
    return NextResponse.json({
      ok: true,
      ts: Date.now(),
    })
  }

  return NextResponse.json(
    {
      error:
        `No route for ${method} ${path}`,
    },
    { status: 404 }
  )
}

export async function GET(
  request
) {
  return dispatch(
    request,
    'GET'
  )
}

export async function POST(
  request
) {
  return dispatch(
    request,
    'POST'
  )
}

export async function PUT(
  request
) {
  return dispatch(
    request,
    'PUT'
  )
}

export async function DELETE(
  request
) {
  return dispatch(
    request,
    'DELETE'
  )
}