import { NextResponse } from "next/server";
import crypto from "crypto";
import Razorpay from "razorpay";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getTestEntitlement } from "@/lib/auth/entitlements";

// Extract Supabase user from Bearer token
async function getUserFromRequest(request) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin.auth.getUser(token);

  if (error || !data?.user) return null;
  return data.user;
}

async function requireAdmin(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return { error: "Not authenticated", status: 401 };
  }

  const admin = getSupabaseAdmin();

  const { data: prof } = await admin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (prof?.role !== "admin") {
    return { error: "Admin only", status: 403 };
  }

  return { user };
}

function getRazorpay() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    throw new Error("Razorpay keys not configured on server");
  }

  return new Razorpay({
    key_id,
    key_secret,
  });
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
  const check = await requireAdmin(request);

  if (check.error) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const admin = getSupabaseAdmin();

  let payload;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json(
      { error: `Invalid JSON: ${error.message}` },
      { status: 400 },
    );
  }

  const requiredTop = [
    "test_id",
    "test_type",
    "total_questions",
    "duration_minutes",
    "questions",
  ];

  for (const key of requiredTop) {
    if (!(key in payload)) {
      return NextResponse.json(
        { error: `Missing field: ${key}` },
        { status: 400 },
      );
    }
  }

  if (!Array.isArray(payload.questions)) {
    return NextResponse.json(
      { error: "questions must be an array" },
      { status: 400 },
    );
  }

  if (payload.questions.length !== Number(payload.total_questions)) {
    return NextResponse.json(
      {
        error:
          `Question count mismatch: test declares ` +
          `${payload.total_questions}, but payload contains ` +
          `${payload.questions.length}.`,
      },
      { status: 400 },
    );
  }

  const warnings = [];
  const seenCodes = new Set();
  const placeholderQuestion =
    /^Question\s+\d+(?:\s+as extracted from|\s+based on Passage)/i;
  const placeholderOption = /^Option\s+[1-4]$/i;
  const passageList = Array.isArray(payload.passages) ? payload.passages : [];

  for (const q of payload.questions) {
    if (!q?.question_code) {
      return NextResponse.json(
        { error: "A question is missing question_code" },
        { status: 400 },
      );
    }

    if (seenCodes.has(q.question_code)) {
      return NextResponse.json(
        {
          error: `Duplicate question_code in payload: ${q.question_code}`,
        },
        { status: 400 },
      );
    }

    seenCodes.add(q.question_code);

    if (typeof q.question_text !== "string" || !q.question_text.trim()) {
      return NextResponse.json(
        { error: `${q.question_code}: question_text is missing or empty` },
        { status: 400 },
      );
    }

    if (placeholderQuestion.test(q.question_text.trim())) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: question_text looks like importer placeholder data (` +
            `"${q.question_text}"). Import cancelled so bad content cannot enter the database.`,
        },
        { status: 400 },
      );
    }

    if (!Array.isArray(q.options) || q.options.length !== 4) {
      return NextResponse.json(
        { error: `${q.question_code}: must have exactly 4 options` },
        { status: 400 },
      );
    }

    const optionIds = q.options.map((o) => String(o?.option_id ?? ""));
    const uniqueOptionIds = new Set(optionIds);

    if (
      uniqueOptionIds.size !== 4 ||
      !["1", "2", "3", "4"].every((id) => uniqueOptionIds.has(id))
    ) {
      return NextResponse.json(
        {
          error: `${q.question_code}: options must have exactly the labels 1, 2, 3, 4`,
        },
        { status: 400 },
      );
    }

    for (const o of q.options) {
      if (typeof o?.option_text !== "string" || !o.option_text.trim()) {
        return NextResponse.json(
          {
            error: `${q.question_code}: option ${o?.option_id ?? "?"} is empty`,
          },
          { status: 400 },
        );
      }

      if (placeholderOption.test(o.option_text.trim())) {
        return NextResponse.json(
          {
            error: `${q.question_code}: option ${o.option_id} contains placeholder data ("${o.option_text}"). Import cancelled.`,
          },
          { status: 400 },
        );
      }
    }

    if (q.answer_status === "valid" && !q.correct_option_label) {
      return NextResponse.json(
        {
          error: `${q.question_code}: valid question missing correct_option_label`,
        },
        { status: 400 },
      );
    }

    if (
      q.answer_status === "valid" &&
      !["1", "2", "3", "4"].includes(String(q.correct_option_label))
    ) {
      return NextResponse.json(
        {
          error: `${q.question_code}: correct_option_label must be 1, 2, 3, or 4`,
        },
        { status: 400 },
      );
    }

    if (q.answer_status === "dropped" && q.correct_option_label) {
      warnings.push(
        `${q.question_code}: answer_status=dropped but has correct_option_label; storing NULL.`,
      );
    }

    if (q.passage_id) {
      const passage = passageList.find((p) => p.passage_id === q.passage_id);
      if (!passage) {
        return NextResponse.json(
          {
            error: `${q.question_code}: references passage ${q.passage_id} not in payload.passages`,
          },
          { status: 400 },
        );
      }
    }
  }

  const examName = payload.exam_name
    ? `${payload.exam_name} ${payload.session || ""} ${payload.year || ""}`.trim()
    : `Test ${payload.test_id}`;

  const { data: existingExam, error: examLookupError } = await admin
    .from("exams")
    .select("*")
    .eq("exam_name", payload.exam_name || examName)
    .eq("session", payload.session || null)
    .eq("year", payload.year || null)
    .maybeSingle();

  if (examLookupError) {
    return NextResponse.json(
      { error: `Exam lookup failed: ${examLookupError.message}` },
      { status: 500 },
    );
  }

  let exam = existingExam;

  if (!exam) {
    const { data: newExam, error: examErr } = await admin
      .from("exams")
      .insert({
        exam_name: payload.exam_name || examName,
        subject: payload.subject || "Forensic Science",
        paper: payload.paper || "Paper-II",
        session: payload.session || null,
        year: payload.year || null,
        exam_date: payload.exam_date || null,
        agency: payload.agency || "NTA",
      })
      .select()
      .single();

    if (examErr) {
      return NextResponse.json(
        { error: `Insert exam failed: ${examErr.message}` },
        { status: 500 },
      );
    }

    exam = newExam;
  }

  const passageRows = (payload.passages || []).map((p) => ({
    exam_id: exam.id,
    passage_code: p.passage_id,
    passage_label: p.passage_label || null,
    passage_text: p.passage_text || "",
  }));

  const passageMap = {};

  if (passageRows.length) {
    const invalidPassage = passageRows.find((p) => !p.passage_code);
    if (invalidPassage) {
      return NextResponse.json(
        { error: "A passage is missing passage_id" },
        { status: 400 },
      );
    }

    const { data: existingPassages, error: passageLookupError } = await admin
      .from("passages")
      .select("id, passage_code")
      .eq("exam_id", exam.id)
      .in(
        "passage_code",
        passageRows.map((p) => p.passage_code),
      );

    if (passageLookupError) {
      return NextResponse.json(
        {
          error: `Passage lookup failed: ${passageLookupError.message}`,
        },
        { status: 500 },
      );
    }

    const existingMap = new Map(
      (existingPassages || []).map((p) => [p.passage_code, p]),
    );

    const upsertPassageRows = passageRows.map((p) => ({
      exam_id: p.exam_id,
      passage_code: p.passage_code,
      passage_label: p.passage_label,
      passage_text: p.passage_text,
    }));

    const { data: upsertedPassages, error: passageUpsertError } = await admin
      .from("passages")
      .upsert(upsertPassageRows, { onConflict: "exam_id,passage_code" })
      .select("id, passage_code");

    if (passageUpsertError) {
      return NextResponse.json(
        {
          error: `Upsert passages failed: ${passageUpsertError.message}`,
        },
        { status: 500 },
      );
    }

    for (const row of upsertedPassages || []) {
      passageMap[row.passage_code] = row.id;
    }
  }

  const unitNames = [
    ...new Set(
      payload.questions
        .map((q) => q.unit)
        .filter((value) => typeof value === "string" && value.trim()),
    ),
  ];

  const unitsByName = {};
  const { data: existingUnits, error: unitsError } = unitNames.length
    ? await admin.from("units").select("id, name").in("name", unitNames)
    : { data: [], error: null };

  if (unitsError) {
    return NextResponse.json(
      { error: `Unit lookup failed: ${unitsError.message}` },
      { status: 500 },
    );
  }

  for (const unit of existingUnits || []) {
    unitsByName[unit.name] = unit.id;
  }

  const missingUnitNames = unitNames.filter((name) => !unitsByName[name]);

  if (missingUnitNames.length) {
    const { data: createdUnits, error: unitInsertError } = await admin
      .from("units")
      .insert(
        missingUnitNames.map((name, index) => ({
          name,
          sort_order: index + 1,
        })),
      )
      .select("id, name");

    if (unitInsertError) {
      return NextResponse.json(
        { error: `Insert units failed: ${unitInsertError.message}` },
        { status: 500 },
      );
    }

    for (const unit of createdUnits || []) {
      unitsByName[unit.name] = unit.id;
    }
  }

  // Topics are scoped to a unit (unique on unit_id+name); subtopics are
  // scoped to a topic (unique on topic_id+name). Resolve/create both,
  // mirroring the unit resolution above.
  const topicPairs = [
    ...new Map(
      payload.questions
        .filter((q) => q.unit && q.topic && unitsByName[q.unit])
        .map((q) => [
          `${unitsByName[q.unit]}::${q.topic}`,
          { unit_id: unitsByName[q.unit], name: q.topic },
        ]),
    ).values(),
  ];

  const topicsByKey = {};

  if (topicPairs.length) {
    const { data: existingTopics, error: topicsError } = await admin
      .from("topics")
      .select("id, unit_id, name")
      .in(
        "unit_id",
        topicPairs.map((t) => t.unit_id),
      );

    if (topicsError) {
      return NextResponse.json(
        { error: `Topic lookup failed: ${topicsError.message}` },
        { status: 500 },
      );
    }

    for (const t of existingTopics || []) {
      topicsByKey[`${t.unit_id}::${t.name}`] = t.id;
    }

    const missingTopics = topicPairs.filter(
      (t) => !topicsByKey[`${t.unit_id}::${t.name}`],
    );

    if (missingTopics.length) {
      const { data: createdTopics, error: topicInsertError } = await admin
        .from("topics")
        .insert(
          missingTopics.map((t, index) => ({
            unit_id: t.unit_id,
            name: t.name,
            sort_order: index + 1,
          })),
        )
        .select("id, unit_id, name");

      if (topicInsertError) {
        return NextResponse.json(
          { error: `Insert topics failed: ${topicInsertError.message}` },
          { status: 500 },
        );
      }

      for (const t of createdTopics || []) {
        topicsByKey[`${t.unit_id}::${t.name}`] = t.id;
      }
    }
  }

  const subtopicPairs = [
    ...new Map(
      payload.questions
        .filter(
          (q) =>
            q.unit &&
            q.topic &&
            q.subtopic &&
            topicsByKey[`${unitsByName[q.unit]}::${q.topic}`],
        )
        .map((q) => {
          const topicId = topicsByKey[`${unitsByName[q.unit]}::${q.topic}`];
          return [
            `${topicId}::${q.subtopic}`,
            { topic_id: topicId, name: q.subtopic },
          ];
        }),
    ).values(),
  ];

  const subtopicsByKey = {};

  if (subtopicPairs.length) {
    const { data: existingSubtopics, error: subtopicsError } = await admin
      .from("subtopics")
      .select("id, topic_id, name")
      .in(
        "topic_id",
        subtopicPairs.map((s) => s.topic_id),
      );

    if (subtopicsError) {
      return NextResponse.json(
        { error: `Subtopic lookup failed: ${subtopicsError.message}` },
        { status: 500 },
      );
    }

    for (const s of existingSubtopics || []) {
      subtopicsByKey[`${s.topic_id}::${s.name}`] = s.id;
    }

    const missingSubtopics = subtopicPairs.filter(
      (s) => !subtopicsByKey[`${s.topic_id}::${s.name}`],
    );

    if (missingSubtopics.length) {
      const { data: createdSubtopics, error: subtopicInsertError } =
        await admin
          .from("subtopics")
          .insert(
            missingSubtopics.map((s, index) => ({
              topic_id: s.topic_id,
              name: s.name,
              sort_order: index + 1,
            })),
          )
          .select("id, topic_id, name");

      if (subtopicInsertError) {
        return NextResponse.json(
          {
            error: `Insert subtopics failed: ${subtopicInsertError.message}`,
          },
          { status: 500 },
        );
      }

      for (const s of createdSubtopics || []) {
        subtopicsByKey[`${s.topic_id}::${s.name}`] = s.id;
      }
    }
  }

  const countsAccumulator = {
    questions: 0,
    options: 0,
    statements: 0,
    match_items: 0,
    dropped: 0,
  };
  const testQuestionRows = [];

  for (const [index, q] of payload.questions.entries()) {
    const { data: existingQuestion, error: questionLookupError } = await admin
      .from("questions")
      .select("*")
      .eq("question_code", q.question_code)
      .maybeSingle();

    if (questionLookupError) {
      return NextResponse.json(
        {
          error:
            `Question lookup failed for ${q.question_code}: ` +
            `${questionLookupError.message}`,
        },
        { status: 500 },
      );
    }

    const unitId = q.unit ? unitsByName[q.unit] || null : null;
    const topicId =
      q.unit && q.topic ? topicsByKey[`${unitId}::${q.topic}`] || null : null;
    const subtopicId =
      topicId && q.subtopic
        ? subtopicsByKey[`${topicId}::${q.subtopic}`] || null
        : null;

    const questionPayload = {
      exam_id: exam.id,
      question_number: index + 1,
      unit_id: unitId,
      topic_id: topicId,
      subtopic_id: subtopicId,
      content_format: q.content_format || "plain",
      question_code: q.question_code,
      question_text: q.question_text,
      difficulty: q.difficulty || "medium",
      passage_id: q.passage_id ? passageMap[q.passage_id] || null : null,
      status: q.status || "published",
      answer_status: q.answer_status || "valid",
      explanation: q.explanation || null,
      updated_at: new Date().toISOString(),
    };

    let question = existingQuestion;

    if (question) {
      const { data: updatedQuestion, error: questionUpdateError } = await admin
        .from("questions")
        .update(questionPayload)
        .eq("id", question.id)
        .select()
        .single();

      if (questionUpdateError) {
        return NextResponse.json(
          {
            error:
              `Update question failed for ${q.question_code}: ` +
              `${questionUpdateError.message}`,
          },
          { status: 500 },
        );
      }

      question = updatedQuestion;
    } else {
      const { data: insertedQuestion, error: questionInsertError } = await admin
        .from("questions")
        .insert({
          ...questionPayload,
          created_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (questionInsertError) {
        return NextResponse.json(
          {
            error:
              `Insert question failed for ${q.question_code}: ` +
              `${questionInsertError.message}`,
          },
          { status: 500 },
        );
      }

      question = insertedQuestion;
    }

    // The correct answer lives in its own table (`answers`), separate from
    // `questions`, so it can be gated by RLS independently of question text.
    const { error: answerUpsertError } = await admin.from("answers").upsert(
      {
        question_id: question.id,
        correct_option_id:
          q.answer_status === "dropped"
            ? null
            : String(q.correct_option_label ?? "") || null,
        scoring_type: "single_correct",
      },
      { onConflict: "question_id" },
    );

    if (answerUpsertError) {
      return NextResponse.json(
        {
          error:
            `Upsert answer failed for ${q.question_code}: ` +
            `${answerUpsertError.message}`,
        },
        { status: 500 },
      );
    }

    await admin
      .from("question_options")
      .delete()
      .eq("question_id", question.id);

    const optionRows = q.options.map((o, optionIndex) => ({
      question_id: question.id,
      option_id: String(o.option_id),
      option_text: o.option_text,
      sort_order: optionIndex + 1,
    }));

    const { error: optionInsertError } = await admin
      .from("question_options")
      .insert(optionRows);

    if (optionInsertError) {
      return NextResponse.json(
        {
          error:
            `Insert options failed for ${q.question_code}: ` +
            `${optionInsertError.message}`,
        },
        { status: 500 },
      );
    }

    countsAccumulator.options += optionRows.length;

    await admin
      .from("question_statements")
      .delete()
      .eq("question_id", question.id);

    if (Array.isArray(q.statements) && q.statements.length) {
      const statementRows = q.statements.map((statement, stIndex) => ({
        question_id: question.id,
        label:
          typeof statement === "string"
            ? String(stIndex + 1)
            : statement?.label || String(stIndex + 1),
        text:
          typeof statement === "string" ? statement : statement?.text || "",
        sort_order: stIndex + 1,
      }));

      const { error: statementError } = await admin
        .from("question_statements")
        .insert(statementRows);

      if (statementError) {
        return NextResponse.json(
          {
            error:
              `Insert statements failed for ${q.question_code}: ` +
              `${statementError.message}`,
          },
          { status: 500 },
        );
      }

      countsAccumulator.statements += statementRows.length;
    }

    await admin
      .from("question_match_items")
      .delete()
      .eq("question_id", question.id);

    const matchLeft = Array.isArray(q.match_left) ? q.match_left : [];
    const matchRight = Array.isArray(q.match_right) ? q.match_right : [];

    if (matchLeft.length || matchRight.length) {
      const matchRows = [
        ...matchLeft.map((item, mIndex) => ({
          question_id: question.id,
          side: "left",
          label: item.label,
          text: item.text,
          sort_order: mIndex + 1,
        })),
        ...matchRight.map((item, mIndex) => ({
          question_id: question.id,
          side: "right",
          label: item.label,
          text: item.text,
          sort_order: mIndex + 1,
        })),
      ];

      const { error: matchError } = await admin
        .from("question_match_items")
        .insert(matchRows);

      if (matchError) {
        return NextResponse.json(
          {
            error:
              `Insert match items failed for ${q.question_code}: ` +
              `${matchError.message}`,
          },
          { status: 500 },
        );
      }

      countsAccumulator.match_items += matchRows.length;
    }

    countsAccumulator.questions += 1;
    if (q.answer_status === "dropped") countsAccumulator.dropped += 1;
    testQuestionRows.push({
      question_id: question.id,
      sequence_number: index + 1,
      marks_override: null,
    });
  }

  // --------------------------------------------------------------------------
  // Create/update the `tests` row itself and its `test_questions` links.
  // Without this, importing only populates the question bank — nothing
  // becomes an actual takeable test.
  // --------------------------------------------------------------------------

  const SAMPLE_TEST_ID = "UGC_NET_FS_2025_01";

  const { data: existingTest, error: testLookupError } = await admin
    .from("tests")
    .select("*")
    .eq("test_id", payload.test_id)
    .maybeSingle();

  if (testLookupError) {
    return NextResponse.json(
      { error: `Test lookup failed: ${testLookupError.message}` },
      { status: 500 },
    );
  }

  const testTitle =
    payload.title ||
    `${payload.exam_name || "Test"} ${payload.session || ""} ${payload.year || ""}`.replace(
      /\s+/g,
      " ",
    ).trim();

  let test = existingTest;

  if (test) {
    // Never silently flip an already-published test's premium/status flags
    // just because it's being re-imported to fix question content.
    const { data: updatedTest, error: testUpdateError } = await admin
      .from("tests")
      .update({
        title: testTitle,
        test_type: payload.test_type,
        exam_id: exam.id,
        total_questions: payload.questions.length,
        duration_minutes: payload.duration_minutes,
        marks_per_question: payload.marks_per_question ?? 2,
        negative_marking: Boolean(payload.negative_marking),
      })
      .eq("id", test.id)
      .select()
      .single();

    if (testUpdateError) {
      return NextResponse.json(
        { error: `Update test failed: ${testUpdateError.message}` },
        { status: 500 },
      );
    }

    test = updatedTest;
  } else {
    const { data: insertedTest, error: testInsertError } = await admin
      .from("tests")
      .insert({
        test_id: payload.test_id,
        title: testTitle,
        test_type: payload.test_type,
        exam_id: exam.id,
        total_questions: payload.questions.length,
        duration_minutes: payload.duration_minutes,
        marks_per_question: payload.marks_per_question ?? 2,
        negative_marking: Boolean(payload.negative_marking),
        is_premium: payload.test_id === SAMPLE_TEST_ID ? false : true,
      })
      .select()
      .single();

    if (testInsertError) {
      return NextResponse.json(
        { error: `Insert test failed: ${testInsertError.message}` },
        { status: 500 },
      );
    }

    test = insertedTest;
  }

  const { error: testQuestionsUpsertError } = await admin
    .from("test_questions")
    .upsert(
      testQuestionRows.map((row) => ({ ...row, test_id: test.id })),
      { onConflict: "test_id,question_id" },
    );

  if (testQuestionsUpsertError) {
    return NextResponse.json(
      {
        error: `Linking questions to test failed: ${testQuestionsUpsertError.message}`,
      },
      { status: 500 },
    );
  }

  // Drop any leftover links from a previous version of this test whose
  // questions are no longer part of the corrected payload.
  const currentQuestionIds = testQuestionRows.map((r) => r.question_id);
  if (currentQuestionIds.length) {
    await admin
      .from("test_questions")
      .delete()
      .eq("test_id", test.id)
      .not("question_id", "in", `(${currentQuestionIds.join(",")})`);
  }

  return NextResponse.json({
    ok: true,
    test: { test_id: test.test_id, title: test.title },
    exam_id: exam.id,
    counts: {
      questions: countsAccumulator.questions,
      passages: Object.keys(passageMap).length,
      options: countsAccumulator.options,
      statements: countsAccumulator.statements,
      match_items: countsAccumulator.match_items,
      dropped: countsAccumulator.dropped,
    },
    warnings,
  });
}

// ----------------------------------------------------------------------------
// POST /api/attempt/create
// ----------------------------------------------------------------------------

async function handleCreateAttempt(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { test_id } = body || {};

  if (!test_id) {
    return NextResponse.json({ error: "Missing test_id" }, { status: 400 });
  }

  // --------------------------------------------------------------------------
  // 1. Look up the actual test from the `tests` table.
  // --------------------------------------------------------------------------

  const { data: test, error: testError } = await admin
    .from("tests")
    .select("*")
    .eq("id", test_id)
    .maybeSingle();

  if (testError) {
    return NextResponse.json(
      { error: `Test lookup failed: ${testError.message}` },
      { status: 500 },
    );
  }

  if (!test) {
    return NextResponse.json({ error: "Test not found." }, { status: 404 });
  }
  if (test.is_user_generated && test.created_by !== user.id) {
    return NextResponse.json(
      { error: "You do not have access to this custom test." },
      { status: 403 },
    );
  }

  // --------------------------------------------------------------------------
  // 2. Check whether this user is allowed to access this particular test.
  //    Free tests are handled by getTestEntitlement().
  // --------------------------------------------------------------------------

  const entitlement = await getTestEntitlement(user.id, test_id);

  if (!entitlement?.allowed) {
    return NextResponse.json(
      {
        error: entitlement?.reason || "You do not have access to this test.",
      },
      { status: 403 },
    );
  }

  // --------------------------------------------------------------------------
  // 3. Check whether the user already has an in-progress attempt.
  //    If so, resume it instead of creating another one.
  // --------------------------------------------------------------------------

  const { data: existingAttempt, error: attemptLookupError } = await admin
    .from("test_attempts")
    .select("*")
    .eq("user_id", user.id)
    .eq("test_id", test_id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (attemptLookupError) {
    return NextResponse.json(
      {
        error: `Attempt lookup failed: ${attemptLookupError.message}`,
      },
      { status: 500 },
    );
  }

  if (existingAttempt) {
    // Make sure all response rows exist. This is required because the
    // browser only UPDATEs attempt_responses; it does not INSERT them.
    const { data: testQuestions, error: testQuestionsError } = await admin
      .from("test_questions")
      .select("question_id")
      .eq("test_id", test_id);

    if (testQuestionsError) {
      return NextResponse.json(
        {
          error: `Unable to load test questions: ${testQuestionsError.message}`,
        },
        { status: 500 },
      );
    }

    if (testQuestions?.length) {
      const responseRows = testQuestions.map((row) => ({
        attempt_id: existingAttempt.id,
        question_id: row.question_id,
      }));

      const { error: responseInsertError } = await admin
        .from("attempt_responses")
        .upsert(responseRows, {
          onConflict: "attempt_id,question_id",
          ignoreDuplicates: true,
        });

      if (responseInsertError) {
        return NextResponse.json(
          {
            error: `Unable to initialize responses: ${responseInsertError.message}`,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      attempt_id: existingAttempt.id,
      attempt: existingAttempt,
      resumed: true,
    });
  }

  // --------------------------------------------------------------------------
  // 4. Create a new attempt in the current `test_attempts` table.
  // --------------------------------------------------------------------------

  const { data: attempt, error: attemptInsertError } = await admin
    .from("test_attempts")
    .insert({
      user_id: user.id,
      test_id,
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (attemptInsertError) {
    return NextResponse.json(
      {
        error: `Unable to create attempt: ${attemptInsertError.message}`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // 5. Pre-create one attempt_responses row for every question.
  //
  //    The attempt page intentionally only UPDATEs these rows because of
  //    the current RLS policy.
  // --------------------------------------------------------------------------

  const { data: testQuestions, error: testQuestionsError } = await admin
    .from("test_questions")
    .select("question_id")
    .eq("test_id", test_id);

  if (testQuestionsError) {
    // Remove the newly-created attempt if its response initialization failed.
    await admin
      .from("test_attempts")
      .delete()
      .eq("id", attempt.id)
      .eq("user_id", user.id);

    return NextResponse.json(
      {
        error: `Unable to load test questions: ${testQuestionsError.message}`,
      },
      { status: 500 },
    );
  }

  if (!testQuestions?.length) {
    await admin
      .from("test_attempts")
      .delete()
      .eq("id", attempt.id)
      .eq("user_id", user.id);

    return NextResponse.json(
      { error: "This test has no questions." },
      { status: 400 },
    );
  }

  const responseRows = testQuestions.map((row) => ({
    attempt_id: attempt.id,
    question_id: row.question_id,
  }));

  const { error: responseInsertError } = await admin
    .from("attempt_responses")
    .insert(responseRows);

  if (responseInsertError) {
    // Do not leave an unusable attempt behind.
    await admin
      .from("test_attempts")
      .delete()
      .eq("id", attempt.id)
      .eq("user_id", user.id);

    return NextResponse.json(
      {
        error: `Unable to initialize responses: ${responseInsertError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    attempt_id: attempt.id,
    attempt,
    resumed: false,
  });
}
// ----------------------------------------------------------------------------
// POST /api/attempt/submit
// ----------------------------------------------------------------------------

async function handleSubmitAttempt(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { attempt_id, answers } = body || {};

  if (!attempt_id || !Array.isArray(answers)) {
    return NextResponse.json(
      { error: "attempt_id and answers are required." },
      { status: 400 },
    );
  }

  const { data: attempt, error: attemptError } = await admin
    .from("attempts")
    .select("*")
    .eq("id", attempt_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (attemptError) {
    return NextResponse.json(
      { error: `Attempt lookup failed: ${attemptError.message}` },
      { status: 500 },
    );
  }

  if (!attempt) {
    return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
  }

  if (attempt.status !== "in_progress") {
    return NextResponse.json(
      { error: "This attempt has already been submitted." },
      { status: 409 },
    );
  }

  const { data: questions, error: questionsError } = await admin
    .from("questions")
    .select(
      `
      id,
      correct_option_label,
      answer_status,
      question_options (
        option_id,
        option_text
      )
    `,
    )
    .eq("exam_id", attempt.test_id)
    .order("sequence_number");

  if (questionsError) {
    return NextResponse.json(
      {
        error: `Unable to load questions: ${questionsError.message}`,
      },
      { status: 500 },
    );
  }

  const answerMap = new Map();

  for (const answer of answers) {
    if (!answer?.question_id) continue;

    answerMap.set(String(answer.question_id), {
      selected_option: answer.selected_option
        ? String(answer.selected_option)
        : null,
    });
  }

  let score = 0;
  let attempted = 0;

  const answerRows = [];

  for (const question of questions || []) {
    const answer = answerMap.get(String(question.id));
    const selectedOption = answer?.selected_option || null;

    if (selectedOption) {
      attempted += 1;
    }

    let isCorrect = null;

    if (question.answer_status === "valid") {
      isCorrect =
        selectedOption &&
        String(selectedOption) === String(question.correct_option_label);

      if (isCorrect) {
        score += 1;
      }
    }

    answerRows.push({
      attempt_id: attempt.id,
      question_id: question.id,
      selected_option: selectedOption,
      is_correct: isCorrect,
    });
  }

  await admin.from("attempt_answers").delete().eq("attempt_id", attempt.id);

  if (answerRows.length) {
    const { error: answerInsertError } = await admin
      .from("attempt_answers")
      .insert(answerRows);

    if (answerInsertError) {
      return NextResponse.json(
        {
          error: `Unable to save answers: ${answerInsertError.message}`,
        },
        { status: 500 },
      );
    }
  }

  const completedAt = new Date().toISOString();

  const { data: updatedAttempt, error: updateAttemptError } = await admin
    .from("attempts")
    .update({
      status: "completed",
      score,
      attempted,
      total_questions: questions?.length || 0,
      completed_at: completedAt,
    })
    .eq("id", attempt.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateAttemptError) {
    return NextResponse.json(
      {
        error: `Unable to complete attempt: ${updateAttemptError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    attempt: updatedAttempt,
    score,
    attempted,
    total_questions: questions?.length || 0,
  });
}

// ----------------------------------------------------------------------------
// POST /api/custom-test/create
// ----------------------------------------------------------------------------

async function handleCustomTestCreate(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const {
    unit_ids = [],
    topic_ids = [],
    difficulties = [],
    count = 20,
  } = body || {};

  if (!Array.isArray(unit_ids)) {
    return NextResponse.json(
      { error: "unit_ids must be an array." },
      { status: 400 },
    );
  }

  if (!Array.isArray(topic_ids)) {
    return NextResponse.json(
      { error: "topic_ids must be an array." },
      { status: 400 },
    );
  }

  if (!Array.isArray(difficulties)) {
    return NextResponse.json(
      { error: "difficulties must be an array." },
      { status: 400 },
    );
  }

  const requestedCount = Number(count);

  if (!Number.isFinite(requestedCount) || requestedCount < 1) {
    return NextResponse.json(
      { error: "count must be at least 1." },
      { status: 400 },
    );
  }

  const requestedQuestionCount = Math.min(Math.floor(requestedCount), 100);

  // --------------------------------------------------------------------------
  // Custom tests require Test Series entitlement.
  // "custom" is intentionally handled as a special entitlement check.
  // --------------------------------------------------------------------------

  const entitlement = await getTestEntitlement(user.id, "custom");

  if (!entitlement?.allowed) {
    return NextResponse.json(
      {
        error:
          entitlement?.reason ||
          "An active Test Series subscription is required for custom tests.",
      },
      { status: 403 },
    );
  }

  // --------------------------------------------------------------------------
  // Build the matching question pool.
  // --------------------------------------------------------------------------

  let query = admin.from("questions").select("id").eq("status", "published");

  if (unit_ids.length) {
    query = query.in("unit_id", unit_ids);
  }

  if (topic_ids.length) {
    query = query.in("topic_id", topic_ids);
  }

  if (difficulties.length && difficulties.length < 3) {
    query = query.in("difficulty", difficulties);
  }

  const { data: pool, error: poolError } = await query.limit(2000);

  if (poolError) {
    return NextResponse.json(
      {
        error: `Unable to load matching questions: ${poolError.message}`,
      },
      { status: 500 },
    );
  }

  if (!pool || pool.length === 0) {
    return NextResponse.json(
      {
        error: "No questions match the selected criteria.",
      },
      { status: 400 },
    );
  }

  // --------------------------------------------------------------------------
  // Randomize the question pool using Fisher-Yates.
  // --------------------------------------------------------------------------

  const ids = pool.map((row) => row.id);

  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));

    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  const chosen = ids.slice(0, Math.min(requestedQuestionCount, ids.length));

  // --------------------------------------------------------------------------
  // Create the actual test.
  //
  // Custom tests are premium objects because only Test Series users/admins
  // are allowed to create them.
  // --------------------------------------------------------------------------

  const testKey = `CUSTOM_${user.id.slice(0, 8)}_${Date.now()}`;

  const { data: test, error: testError } = await admin
    .from("tests")
    .insert({
      test_id: testKey,
      title: `Custom test · ${chosen.length} Q`,
      test_type: "custom",
      total_questions: chosen.length,
      duration_minutes: Math.max(10, chosen.length),
      marks_per_question: 2,
      negative_marking: false,
      is_premium: true,
      is_user_generated: true,
      created_by: user.id,
      status: "published",
    })
    .select()
    .single();

  if (testError) {
    return NextResponse.json(
      {
        error: `Unable to create custom test: ${testError.message}`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // Attach the selected questions to the newly-created test.
  // --------------------------------------------------------------------------

  const testQuestionRows = chosen.map((questionId, index) => ({
    test_id: test.id,
    question_id: questionId,
    sequence_number: index + 1,
  }));

  const { error: testQuestionsError } = await admin
    .from("test_questions")
    .insert(testQuestionRows);

  if (testQuestionsError) {
    // Do not leave an orphaned custom test if question assignment fails.
    await admin.from("tests").delete().eq("id", test.id);

    return NextResponse.json(
      {
        error: `Unable to attach questions to custom test: ${testQuestionsError.message}`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // The custom-test page expects test_uuid and immediately sends it to
  // /api/attempt/create.
  // --------------------------------------------------------------------------

  return NextResponse.json({
    ok: true,
    test_uuid: test.id,
    total: chosen.length,
  });
}

// ----------------------------------------------------------------------------
// POST /api/billing/create-subscription
// ----------------------------------------------------------------------------

async function handleCreateSubscription(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { plan_id } = body || {};

  if (!plan_id) {
    return NextResponse.json({ error: "Missing plan_id." }, { status: 400 });
  }

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .eq("is_active", true)
    .maybeSingle();

  if (planError) {
    return NextResponse.json(
      { error: `Plan lookup failed: ${planError.message}` },
      { status: 500 },
    );
  }

  if (!plan) {
    return NextResponse.json(
      { error: "Selected plan is not available." },
      { status: 404 },
    );
  }

  if (!plan.is_purchasable) {
    return NextResponse.json(
      { error: "This plan is not currently available for purchase." },
      { status: 400 },
    );
  }

  const { data: existingSubscriptions, error: existingError } = await admin
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (existingError) {
    return NextResponse.json(
      {
        error: `Unable to check existing subscriptions: ${existingError.message}`,
      },
      { status: 500 },
    );
  }

  const activeSubscription =
    (existingSubscriptions || []).find(
      (sub) =>
        sub.status === "active" &&
        (!sub.expires_at || new Date(sub.expires_at) > new Date()),
    ) || null;

  if (activeSubscription) {
    return NextResponse.json(
      {
        error: "You already have an active subscription.",
        subscription_id: activeSubscription.razorpay_subscription_id,
      },
      { status: 409 },
    );
  }

  const pastDueSubscription =
    (existingSubscriptions || []).find((sub) => sub.status === "past_due") ||
    null;

  if (pastDueSubscription) {
    return NextResponse.json(
      {
        error:
          "You already have a subscription with an unresolved payment status.",
        subscription_id: pastDueSubscription.razorpay_subscription_id,
      },
      { status: 409 },
    );
  }

  const createdSubscription =
    (existingSubscriptions || []).find((sub) => sub.status === "created") ||
    null;

  if (createdSubscription) {
    let providerSubscription;

    try {
      const rzp = getRazorpay();

      providerSubscription = await rzp.subscriptions.fetch(
        createdSubscription.razorpay_subscription_id,
      );
    } catch (e) {
      return NextResponse.json(
        {
          error:
            `Unable to check existing Razorpay subscription: ` +
            `${e?.error?.description || e?.message || "Unknown Razorpay error."}`,
        },
        { status: 500 },
      );
    }

    if (
      providerSubscription.status === "cancelled" ||
      providerSubscription.status === "expired"
    ) {
      await admin
        .from("subscriptions")
        .update({
          status:
            providerSubscription.status === "cancelled"
              ? "cancelled"
              : "expired",
          updated_at: new Date().toISOString(),
        })
        .eq("id", createdSubscription.id)
        .eq("user_id", user.id);
    } else if (providerSubscription.status === "active") {
      return NextResponse.json(
        {
          error: "You already have an active subscription.",
          subscription_id: providerSubscription.id,
        },
        { status: 409 },
      );
    } else if (providerSubscription.customer_id) {
      return NextResponse.json(
        {
          error:
            "Your payment authorization is already in progress. Please finish the current payment before starting another subscription.",
          subscription_id: providerSubscription.razorpay_subscription_id,
        },
        { status: 409 },
      );
    } else {
      return NextResponse.json(
        {
          error:
            "You already have a subscription that is still being processed. Please finish or close the current payment window before starting another subscription.",
          subscription_id: createdSubscription.razorpay_subscription_id,
        },
        { status: 409 },
      );
    }
  }

  const rzp = getRazorpay();

  const expireBy = Math.floor(Date.now() / 1000) + 30 * 60;

  let razorpaySubscription;

  try {
    razorpaySubscription = await rzp.subscriptions.create({
      plan_id: plan.razorpay_plan_id,
      total_count: 12,
      customer_notify: 1,
      expire_by: expireBy,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Unable to create Razorpay subscription: ` +
          `${e?.error?.description || e?.message || "Unknown Razorpay error."}`,
      },
      { status: 500 },
    );
  }

  const authorizationExpiry = new Date(
    (razorpaySubscription.expire_by || expireBy) * 1000,
  );

  const { data: insertedSubscription, error: insertError } = await admin
    .from("subscriptions")
    .insert({
      user_id: user.id,
      plan_id: plan.id,
      razorpay_subscription_id: razorpaySubscription.id,
      razorpay_customer_id: razorpaySubscription.customer_id || null,
      status: razorpaySubscription.status || "created",
      cancel_at_period_end: false,
      expires_at: authorizationExpiry.toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    try {
      await rzp.subscriptions.cancel(razorpaySubscription.id, {
        cancel_at_cycle_end: false,
      });
    } catch (cancelError) {
      console.error(
        "Failed to clean up orphaned Razorpay subscription:",
        cancelError,
      );
    }

    return NextResponse.json(
      {
        error: `Unable to save subscription: ${insertError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    subscription_id: insertedSubscription.razorpay_subscription_id,
    razorpay_key_id: process.env.RAZORPAY_KEY_ID,
  });
}

// ----------------------------------------------------------------------------
// POST /api/billing/verify
// ----------------------------------------------------------------------------

async function handleVerify(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } =
    body || {};

  if (
    !razorpay_payment_id ||
    !razorpay_subscription_id ||
    !razorpay_signature
  ) {
    return NextResponse.json(
      {
        error: "Incomplete Razorpay verification data.",
      },
      { status: 400 },
    );
  }

  const { data: sub, error: subError } = await admin
    .from("subscriptions")
    .select("*")
    .eq("razorpay_subscription_id", razorpay_subscription_id)
    .maybeSingle();

  if (subError) {
    return NextResponse.json(
      { error: `Subscription lookup failed: ${subError.message}` },
      { status: 500 },
    );
  }

  if (!sub || sub.user_id !== user.id) {
    return NextResponse.json(
      { error: "Not your subscription" },
      { status: 403 },
    );
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    return NextResponse.json(
      { error: "Razorpay secret is not configured." },
      { status: 500 },
    );
  }

  const generatedSignature = crypto
    .createHmac("sha256", secret)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest("hex");

  if (generatedSignature !== razorpay_signature) {
    return NextResponse.json(
      { error: "Invalid Razorpay signature." },
      { status: 400 },
    );
  }

  const rzp = getRazorpay();

  let providerSubscription;

  try {
    providerSubscription = await rzp.subscriptions.fetch(
      razorpay_subscription_id,
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Unable to verify Razorpay subscription: ` +
          `${e?.error?.description || e?.message || "Unknown Razorpay error."}`,
      },
      { status: 500 },
    );
  }

  const patch = {
    status:
      providerSubscription.status === "active"
        ? "active"
        : providerSubscription.status || "active",
    razorpay_customer_id:
      providerSubscription.customer_id || sub.razorpay_customer_id || null,
    updated_at: new Date().toISOString(),
  };

  if (providerSubscription.current_start) {
    patch.started_at = new Date(
      providerSubscription.current_start * 1000,
    ).toISOString();
  }

  if (providerSubscription.current_end) {
    patch.expires_at = new Date(
      providerSubscription.current_end * 1000,
    ).toISOString();
  }

  const { error: updateError } = await admin
    .from("subscriptions")
    .update(patch)
    .eq("id", sub.id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json(
      {
        error: `Unable to update subscription: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    status: patch.status,
  });
}

// ----------------------------------------------------------------------------
// POST /api/billing/cancel
//
// Normal user cancellation for an active subscription.
// This remains a cycle-end cancellation.
// ----------------------------------------------------------------------------
async function handleCancel(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { razorpay_subscription_id } = body || {};

  if (!razorpay_subscription_id) {
    return NextResponse.json(
      { error: "Missing Razorpay subscription ID." },
      { status: 400 },
    );
  }

  const { data: sub, error: subError } = await admin
    .from("subscriptions")
    .select("*")
    .eq("razorpay_subscription_id", razorpay_subscription_id)
    .maybeSingle();

  if (subError) {
    return NextResponse.json(
      { error: `Subscription lookup failed: ${subError.message}` },
      { status: 500 },
    );
  }

  if (!sub || sub.user_id !== user.id) {
    return NextResponse.json(
      {
        error: "Not your subscription",
      },
      { status: 403 },
    );
  }

  try {
    const rzp = getRazorpay();

    await rzp.subscriptions.cancel(razorpay_subscription_id, {
      cancel_at_cycle_end: 1,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Razorpay cancel failed: ` + `${e?.error?.description || e.message}`,
      },
      { status: 500 },
    );
  }

  await admin
    .from("subscriptions")
    .update({
      cancel_at_period_end: true,

      updated_at: new Date().toISOString(),
    })
    .eq("razorpay_subscription_id", razorpay_subscription_id);

  return NextResponse.json({
    ok: true,
  });
}

// ----------------------------------------------------------------------------
// POST /api/billing/cancel-pending
//
// Razorpay does not reliably allow an immediate Cancel API call while an
// authorization-only subscription is still in the initial `created` state.
// In that state there is no billing cycle to cancel. We therefore treat a
// dismissed Checkout as locally abandoned, while Razorpay's `expire_by`
// remains the provider-side safety net.
// ----------------------------------------------------------------------------

async function handleCancelPending(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  let body;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const { razorpay_subscription_id } = body || {};

  if (!razorpay_subscription_id) {
    return NextResponse.json(
      { error: "Missing Razorpay subscription ID." },
      { status: 400 },
    );
  }

  const { data: sub, error: subLookupError } = await admin
    .from("subscriptions")
    .select(
      "id, user_id, razorpay_subscription_id, status, cancel_at_period_end",
    )
    .eq("razorpay_subscription_id", razorpay_subscription_id)
    .maybeSingle();

  if (subLookupError) {
    return NextResponse.json(
      { error: `Unable to find subscription: ${subLookupError.message}` },
      { status: 500 },
    );
  }

  if (!sub) {
    return NextResponse.json(
      { error: "Subscription was not found." },
      { status: 404 },
    );
  }

  if (sub.user_id !== user.id) {
    return NextResponse.json(
      { error: "This subscription does not belong to the current user." },
      { status: 403 },
    );
  }

  // Never use this endpoint to alter an active or unresolved payment state.
  if (sub.status !== "created") {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status: sub.status,
    });
  }

  let providerSubscription;

  try {
    const rzp = getRazorpay();
    providerSubscription = await rzp.subscriptions.fetch(
      razorpay_subscription_id,
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          "Unable to check Razorpay subscription: " +
          `${e?.error?.description || e?.message || "Unknown Razorpay error."}`,
      },
      { status: 500 },
    );
  }

  if (providerSubscription.status === "active") {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status: "active",
    });
  }

  if (
    providerSubscription.status === "cancelled" ||
    providerSubscription.status === "expired"
  ) {
    await admin
      .from("subscriptions")
      .update({
        status: providerSubscription.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id)
      .eq("user_id", user.id);

    return NextResponse.json({
      ok: true,
      cancelled: providerSubscription.status === "cancelled",
      status: providerSubscription.status,
    });
  }

  // If Razorpay has already associated a customer, authorization may have
  // completed even though an immediate-start subscription can still report
  // `created` until its first charge. Do not mark that subscription abandoned.
  if (providerSubscription.customer_id) {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status: providerSubscription.status,
    });
  }

  // The user closed Checkout before authorization. We cannot reliably cancel
  // the provider subscription in this state, so release the local checkout
  // lock. Razorpay will expire the authorization window automatically.
  const { error: updateError } = await admin
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancel_at_period_end: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id)
    .eq("user_id", user.id)
    .eq("status", "created");

  if (updateError) {
    return NextResponse.json(
      {
        error: `Unable to release pending subscription: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    cancelled: true,
    status: "cancelled",
    provider_status: providerSubscription.status,
    provider_action: "expire_by",
  });
}

// ----------------------------------------------------------------------------
// POST /api/webhooks/razorpay
// ----------------------------------------------------------------------------

async function handleRazorpayWebhook(request) {
  const rawBody = await request.text();

  const sig = request.headers.get("x-razorpay-signature") || "";

  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error: "Webhook secret not configured",
      },
      { status: 500 },
    );
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const a = Buffer.from(expected);

  const b = Buffer.from(sig);

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Signature mismatch",
      },
      { status: 401 },
    );
  }

  let evt;

  try {
    evt = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const admin = getSupabaseAdmin();

  const sub = evt?.payload?.subscription?.entity;

  const pay = evt?.payload?.payment?.entity;

  const subjectId = sub?.id || pay?.id || "unknown";

  const providerEventId = `${evt.event}:${subjectId}:${evt.created_at}`;

  const { error: dupErr } = await admin.from("payment_events").insert({
    provider: "razorpay",

    provider_event_id: providerEventId,

    event_type: evt.event,

    payload: evt,
  });

  if (dupErr) {
    // Already processed.
    if (dupErr.code === "23505") {
      return NextResponse.json({
        ok: true,
        duplicate: true,
      });
    }

    return NextResponse.json(
      {
        error: dupErr.message,
      },
      { status: 500 },
    );
  }

  // Update subscription state.
  if (sub?.id && evt.event.startsWith("subscription.")) {
    const statusMap = {
      "subscription.activated": "active",

      "subscription.charged": "active",

      "subscription.pending": "past_due",

      "subscription.halted": "past_due",

      "subscription.cancelled": "cancelled",

      "subscription.completed": "expired",

      "subscription.expired": "expired",
    };

    const nextStatus = statusMap[evt.event] || sub.status || "active";

    const patch = {
      status: nextStatus,

      razorpay_customer_id: sub.customer_id || undefined,

      updated_at: new Date().toISOString(),
    };

    if (sub.current_start) {
      patch.started_at = new Date(sub.current_start * 1000).toISOString();
    }

    if (sub.current_end) {
      patch.expires_at = new Date(sub.current_end * 1000).toISOString();
    }

    if (evt.event === "subscription.cancelled") {
      patch.cancel_at_period_end = true;
    }

    await admin
      .from("subscriptions")
      .update(patch)
      .eq("razorpay_subscription_id", sub.id);
  }

  return NextResponse.json({
    ok: true,
  });
}

// ----------------------------------------------------------------------------
// DISPATCHER
// ----------------------------------------------------------------------------

async function dispatch(request, method) {
  const url = new URL(request.url);

  const path = url.pathname.replace(/^\/api/, "");

  if (method === "POST" && path === "/admin/import") {
    return handleImport(request);
  }

  if (method === "POST" && path === "/attempt/create") {
    return handleCreateAttempt(request);
  }

  if (method === "POST" && path === "/attempt/submit") {
    return handleSubmitAttempt(request);
  }

  if (method === "POST" && path === "/custom-test/create") {
    return handleCustomTestCreate(request);
  }

  if (method === "POST" && path === "/billing/create-subscription") {
    return handleCreateSubscription(request);
  }

  if (method === "POST" && path === "/billing/verify") {
    return handleVerify(request);
  }

  if (method === "POST" && path === "/billing/cancel") {
    return handleCancel(request);
  }

  if (method === "POST" && path === "/billing/cancel-pending") {
    return handleCancelPending(request);
  }

  if (method === "POST" && path === "/webhooks/razorpay") {
    return handleRazorpayWebhook(request);
  }

  if (method === "GET" && path === "/health") {
    return NextResponse.json({
      ok: true,
      ts: Date.now(),
    });
  }

  return NextResponse.json(
    {
      error: `No route for ${method} ${path}`,
    },
    { status: 404 },
  );
}

export async function GET(request) {
  return dispatch(request, "GET");
}

export async function POST(request) {
  return dispatch(request, "POST");
}

export async function PUT(request) {
  return dispatch(request, "PUT");
}

export async function DELETE(request) {
  return dispatch(request, "DELETE");
}