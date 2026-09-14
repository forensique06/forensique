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

  // --------------------------------------------------------------------------
  // 1. BASIC PAYLOAD VALIDATION
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // 2. VALIDATE THE COMPLETE PAYLOAD BEFORE ANY DATABASE WRITE
  // --------------------------------------------------------------------------

  const warnings = [];
  const seenCodes = new Set();
  const placeholderQuestion =
    /^Question\s+\d+(?:\s+as extracted from|\s+based on Passage)/i;
  const placeholderOption = /^Option\s+[1-4]$/i;
  const passageList = Array.isArray(payload.passages) ? payload.passages : [];
  const passageCodes = new Set();

  for (const p of passageList) {
    if (!p?.passage_id) {
      return NextResponse.json(
        { error: "A passage is missing passage_id" },
        { status: 400 },
      );
    }

    if (passageCodes.has(p.passage_id)) {
      return NextResponse.json(
        { error: `Duplicate passage_id in payload: ${p.passage_id}` },
        { status: 400 },
      );
    }

    passageCodes.add(p.passage_id);
  }

  for (const q of payload.questions) {
    if (!q?.question_code) {
      return NextResponse.json(
        { error: "A question is missing question_code" },
        { status: 400 },
      );
    }

    if (seenCodes.has(q.question_code)) {
      return NextResponse.json(
        { error: `Duplicate question_code in payload: ${q.question_code}` },
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

    const answerStatus = q.answer_status || "valid";

    if (answerStatus === "valid" && !q.correct_option_label) {
      return NextResponse.json(
        {
          error: `${q.question_code}: valid question missing correct_option_label`,
        },
        { status: 400 },
      );
    }

    if (
      answerStatus === "valid" &&
      !["1", "2", "3", "4"].includes(String(q.correct_option_label))
    ) {
      return NextResponse.json(
        {
          error: `${q.question_code}: correct_option_label must be 1, 2, 3, or 4`,
        },
        { status: 400 },
      );
    }

    if (answerStatus === "dropped" && q.correct_option_label) {
      warnings.push(
        `${q.question_code}: answer_status=dropped but has correct_option_label; storing NULL.`,
      );
    }

    if (q.passage_id && !passageCodes.has(q.passage_id)) {
      return NextResponse.json(
        {
          error: `${q.question_code}: references passage ${q.passage_id} not in payload.passages`,
        },
        { status: 400 },
      );
    }

    if (q.topic && !q.unit) {
      return NextResponse.json(
        {
          error: `${q.question_code}: topic is provided but unit is missing`,
        },
        { status: 400 },
      );
    }

    if (q.subtopic && !q.topic) {
      return NextResponse.json(
        {
          error: `${q.question_code}: subtopic is provided but topic is missing`,
        },
        { status: 400 },
      );
    }
  }

  // --------------------------------------------------------------------------
  // 3. UPSERT EXAM
  // --------------------------------------------------------------------------

  const examName = payload.exam_name
    ? `${payload.exam_name} ${payload.session || ""} ${payload.year || ""}`.trim()
    : `Test ${payload.test_id}`;

  let examQuery = admin
    .from("exams")
    .select("*")
    .eq("exam_name", payload.exam_name || examName);

  if (payload.session == null || payload.session === "") {
    examQuery = examQuery.is("session", null);
  } else {
    examQuery = examQuery.eq("session", payload.session);
  }

  if (payload.year == null || payload.year === "") {
    examQuery = examQuery.is("year", null);
  } else {
    examQuery = examQuery.eq("year", payload.year);
  }

  const { data: existingExam, error: examLookupError } =
    await examQuery.maybeSingle();

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

  // --------------------------------------------------------------------------
  // 4. UPSERT PASSAGES IN ONE BATCH
  // --------------------------------------------------------------------------

  const passageMap = {};

  if (passageList.length) {
    const passageRows = passageList.map((p) => ({
      exam_id: exam.id,
      passage_code: p.passage_id,
      passage_label: p.passage_label || null,
      passage_text: p.passage_text || "",
    }));

    const { data: upsertedPassages, error: passageUpsertError } = await admin
      .from("passages")
      .upsert(passageRows, { onConflict: "exam_id,passage_code" })
      .select("id, passage_code");

    if (passageUpsertError) {
      return NextResponse.json(
        { error: `Upsert passages failed: ${passageUpsertError.message}` },
        { status: 500 },
      );
    }

    for (const row of upsertedPassages || []) {
      passageMap[row.passage_code] = row.id;
    }

    // In case the API does not return every upserted row, reload them once.
    const missingPassageCodes = passageList
      .map((p) => p.passage_id)
      .filter((code) => !passageMap[code]);

    if (missingPassageCodes.length) {
      const { data: reloadedPassages, error: reloadPassageError } = await admin
        .from("passages")
        .select("id, passage_code")
        .eq("exam_id", exam.id)
        .in("passage_code", missingPassageCodes);

      if (reloadPassageError) {
        return NextResponse.json(
          { error: `Reload passages failed: ${reloadPassageError.message}` },
          { status: 500 },
        );
      }

      for (const row of reloadedPassages || []) {
        passageMap[row.passage_code] = row.id;
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. LOAD / CREATE TAXONOMY IN BATCHES
  // --------------------------------------------------------------------------

  const unitNames = [
    ...new Set(
      payload.questions
        .map((q) => (typeof q.unit === "string" ? q.unit.trim() : ""))
        .filter(Boolean),
    ),
  ];

  const unitsByName = new Map();

  if (unitNames.length) {
    const { data: existingUnits, error: unitsError } = await admin
      .from("units")
      .select("id, name")
      .in("name", unitNames);

    if (unitsError) {
      return NextResponse.json(
        { error: `Unit lookup failed: ${unitsError.message}` },
        { status: 500 },
      );
    }

    for (const unit of existingUnits || []) {
      unitsByName.set(unit.name, unit.id);
    }

    const missingUnitNames = unitNames.filter(
      (name) => !unitsByName.has(name),
    );

    if (missingUnitNames.length) {
      const { data: createdUnits, error: unitInsertError } = await admin
        .from("units")
        .upsert(
          missingUnitNames.map((name, index) => ({
            name,
            sort_order: index + 1,
          })),
          { onConflict: "name" },
        )
        .select("id, name");

      if (unitInsertError) {
        return NextResponse.json(
          { error: `Create units failed: ${unitInsertError.message}` },
          { status: 500 },
        );
      }

      for (const unit of createdUnits || []) {
        unitsByName.set(unit.name, unit.id);
      }
    }

    const stillMissingUnits = unitNames.filter(
      (name) => !unitsByName.has(name),
    );

    if (stillMissingUnits.length) {
      const { data: reloadedUnits, error: reloadUnitsError } = await admin
        .from("units")
        .select("id, name")
        .in("name", stillMissingUnits);

      if (reloadUnitsError) {
        return NextResponse.json(
          { error: `Reload units failed: ${reloadUnitsError.message}` },
          { status: 500 },
        );
      }

      for (const unit of reloadedUnits || []) {
        unitsByName.set(unit.name, unit.id);
      }
    }
  }

  const topicKeys = [
    ...new Set(
      payload.questions
        .map((q) => {
          const unitName = typeof q.unit === "string" ? q.unit.trim() : "";
          const topicName = typeof q.topic === "string" ? q.topic.trim() : "";

          if (!unitName || !topicName) return "";

          const unitId = unitsByName.get(unitName);

          return unitId ? `${unitId}\u0000${topicName}` : "";
        })
        .filter(Boolean),
    ),
  ];

  const topicsByKey = new Map();

  if (topicKeys.length) {
    const unitIds = [
      ...new Set(topicKeys.map((key) => key.split("\u0000")[0])),
    ];

    const { data: existingTopics, error: topicsError } = await admin
      .from("topics")
      .select("id, unit_id, name")
      .in("unit_id", unitIds);

    if (topicsError) {
      return NextResponse.json(
        { error: `Topic lookup failed: ${topicsError.message}` },
        { status: 500 },
      );
    }

    for (const topic of existingTopics || []) {
      topicsByKey.set(
        `${topic.unit_id}\u0000${topic.name}`,
        topic.id,
      );
    }

    const missingTopicRows = topicKeys
      .filter((key) => !topicsByKey.has(key))
      .map((key) => {
        const [unitId, name] = key.split("\u0000");

        return {
          unit_id: unitId,
          name,
        };
      });

    if (missingTopicRows.length) {
      const { data: createdTopics, error: topicInsertError } = await admin
        .from("topics")
        .upsert(missingTopicRows, { onConflict: "unit_id,name" })
        .select("id, unit_id, name");

      if (topicInsertError) {
        return NextResponse.json(
          { error: `Create topics failed: ${topicInsertError.message}` },
          { status: 500 },
        );
      }

      for (const topic of createdTopics || []) {
        topicsByKey.set(
          `${topic.unit_id}\u0000${topic.name}`,
          topic.id,
        );
      }
    }

    const missingTopicKeys = topicKeys.filter(
      (key) => !topicsByKey.has(key),
    );

    if (missingTopicKeys.length) {
      const reloadUnitIds = [
        ...new Set(
          missingTopicKeys.map(
            (key) => key.split("\u0000")[0],
          ),
        ),
      ];

      const { data: reloadedTopics, error: reloadTopicsError } = await admin
        .from("topics")
        .select("id, unit_id, name")
        .in("unit_id", reloadUnitIds);

      if (reloadTopicsError) {
        return NextResponse.json(
          { error: `Reload topics failed: ${reloadTopicsError.message}` },
          { status: 500 },
        );
      }

      for (const topic of reloadedTopics || []) {
        topicsByKey.set(
          `${topic.unit_id}\u0000${topic.name}`,
          topic.id,
        );
      }
    }
  }

  const subtopicKeys = [
    ...new Set(
      payload.questions
        .map((q) => {
          const unitName = typeof q.unit === "string" ? q.unit.trim() : "";
          const topicName = typeof q.topic === "string" ? q.topic.trim() : "";
          const subtopicName =
            typeof q.subtopic === "string" ? q.subtopic.trim() : "";

          if (!unitName || !topicName || !subtopicName) return "";

          const unitId = unitsByName.get(unitName);

          const topicId = unitId
            ? topicsByKey.get(`${unitId}\u0000${topicName}`)
            : null;

          return topicId
            ? `${topicId}\u0000${subtopicName}`
            : "";
        })
        .filter(Boolean),
    ),
  ];

  const subtopicsByKey = new Map();

  if (subtopicKeys.length) {
    const topicIds = [
      ...new Set(
        subtopicKeys.map(
          (key) => key.split("\u0000")[0],
        ),
      ),
    ];

    const { data: existingSubtopics, error: subtopicsError } = await admin
      .from("subtopics")
      .select("id, topic_id, name")
      .in("topic_id", topicIds);

    if (subtopicsError) {
      return NextResponse.json(
        { error: `Subtopic lookup failed: ${subtopicsError.message}` },
        { status: 500 },
      );
    }

    for (const subtopic of existingSubtopics || []) {
      subtopicsByKey.set(
        `${subtopic.topic_id}\u0000${subtopic.name}`,
        subtopic.id,
      );
    }

    const missingSubtopicRows = subtopicKeys
      .filter((key) => !subtopicsByKey.has(key))
      .map((key) => {
        const [topicId, name] = key.split("\u0000");

        return {
          topic_id: topicId,
          name,
        };
      });

    if (missingSubtopicRows.length) {
      const { data: createdSubtopics, error: subtopicInsertError } =
        await admin
          .from("subtopics")
          .upsert(missingSubtopicRows, {
            onConflict: "topic_id,name",
          })
          .select("id, topic_id, name");

      if (subtopicInsertError) {
        return NextResponse.json(
          {
            error:
              `Create subtopics failed: ${subtopicInsertError.message}`,
          },
          { status: 500 },
        );
      }

      for (const subtopic of createdSubtopics || []) {
        subtopicsByKey.set(
          `${subtopic.topic_id}\u0000${subtopic.name}`,
          subtopic.id,
        );
      }
    }

    const missingSubtopicKeys = subtopicKeys.filter(
      (key) => !subtopicsByKey.has(key),
    );

    if (missingSubtopicKeys.length) {
      const reloadTopicIds = [
        ...new Set(
          missingSubtopicKeys.map(
            (key) => key.split("\u0000")[0],
          ),
        ),
      ];

      const { data: reloadedSubtopics, error: reloadSubtopicsError } =
        await admin
          .from("subtopics")
          .select("id, topic_id, name")
          .in("topic_id", reloadTopicIds);

      if (reloadSubtopicsError) {
        return NextResponse.json(
          {
            error:
              `Reload subtopics failed: ${reloadSubtopicsError.message}`,
          },
          { status: 500 },
        );
      }

      for (const subtopic of reloadedSubtopics || []) {
        subtopicsByKey.set(
          `${subtopic.topic_id}\u0000${subtopic.name}`,
          subtopic.id,
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // 6. UPSERT TEST
  // --------------------------------------------------------------------------

  const isSampleFreeTrial =
    payload.test_id === "UGC_NET_FS_2025_06";

  const testTitle =
    `${payload.exam_name || "Test"}` +
    `${payload.session ? " " + payload.session : ""}` +
    `${payload.year ? " " + payload.year : ""}` +
    ` — ${payload.paper || "Paper II"}`;

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

  let test = existingTest;

  if (!test) {
    const { data: newTest, error: testErr } = await admin
      .from("tests")
      .insert({
        test_id: payload.test_id,
        title: testTitle,
        test_type: payload.test_type,
        exam_id: exam.id,
        total_questions: payload.total_questions,
        duration_minutes: payload.duration_minutes,
        marks_per_question: payload.marks_per_question ?? 2,
        negative_marking: !!payload.negative_marking,
        is_premium: !isSampleFreeTrial,
        status: "published",
      })
      .select()
      .single();

    if (testErr) {
      return NextResponse.json(
        { error: `Insert test failed: ${testErr.message}` },
        { status: 500 },
      );
    }

    test = newTest;
  } else {
    const { data: updatedTest, error: testUpdateErr } = await admin
      .from("tests")
      .update({
        title: testTitle,
        test_type: payload.test_type,
        exam_id: exam.id,
        total_questions: payload.total_questions,
        duration_minutes: payload.duration_minutes,
        marks_per_question: payload.marks_per_question ?? 2,
        negative_marking: !!payload.negative_marking,
        is_premium: isSampleFreeTrial
          ? false
          : test.is_premium,
        status: "published",
      })
      .eq("id", test.id)
      .select()
      .single();

    if (testUpdateErr) {
      return NextResponse.json(
        { error: `Update test failed: ${testUpdateErr.message}` },
        { status: 500 },
      );
    }

    test = updatedTest;
  }

  // --------------------------------------------------------------------------
  // 7. UPSERT ALL QUESTIONS IN ONE BATCH
  // --------------------------------------------------------------------------

  const questionCodes = payload.questions.map(
    (q) => q.question_code,
  );

  const existingQuestionMap = new Map();

  const {
    data: existingQuestions,
    error: existingQuestionsError,
  } = await admin
    .from("questions")
    .select("id, question_code")
    .in("question_code", questionCodes);

  if (existingQuestionsError) {
    return NextResponse.json(
      {
        error:
          `Question lookup failed: ${existingQuestionsError.message}`,
      },
      { status: 500 },
    );
  }

  for (const q of existingQuestions || []) {
    existingQuestionMap.set(
      q.question_code,
      q.id,
    );
  }

  const now = new Date().toISOString();

  const questionRows = payload.questions.map((q) => {
    const unitName =
      typeof q.unit === "string"
        ? q.unit.trim()
        : "";

    const topicName =
      typeof q.topic === "string"
        ? q.topic.trim()
        : "";

    const subtopicName =
      typeof q.subtopic === "string"
        ? q.subtopic.trim()
        : "";

    const unitId =
      unitName
        ? unitsByName.get(unitName) || null
        : null;

    const topicId =
      unitId && topicName
        ? topicsByKey.get(
            `${unitId}\u0000${topicName}`,
          ) || null
        : null;

    const subtopicId =
      topicId && subtopicName
        ? subtopicsByKey.get(
            `${topicId}\u0000${subtopicName}`,
          ) || null
        : null;

    const qNumMatch =
      String(q.question_code).match(/(\d+)$/);

    const questionNumber =
      q.question_number != null
        ? Number(q.question_number)
        : qNumMatch
          ? Number(qNumMatch[1])
          : null;

    return {
      question_code:
        q.question_code,

      exam_id:
        exam.id,

      question_number:
        Number.isInteger(questionNumber)
          ? questionNumber
          : null,

      unit_id:
        unitId,

      topic_id:
        topicId,

      subtopic_id:
        subtopicId,

      content_format:
        q.content_format || "plain",

      question_text:
        q.question_text.trim(),

      passage_id:
        q.passage_id
          ? passageMap[q.passage_id] || null
          : null,

      is_negative_framing:
        !!q.is_negative_framing,

      status:
        "published",

      answer_status:
        q.answer_status || "valid",

      explanation:
        q.explanation || null,

      updated_at:
        now,
    };
  });

  const {
    data: upsertedQuestions,
    error: questionUpsertError,
  } = await admin
    .from("questions")
    .upsert(
      questionRows,
      {
        onConflict: "question_code",
      },
    )
    .select("id, question_code");

  if (questionUpsertError) {
    return NextResponse.json(
      {
        error:
          `Upsert questions failed: ${questionUpsertError.message}`,
      },
      { status: 500 },
    );
  }

  const questionMap = new Map();

  for (const q of upsertedQuestions || []) {
    questionMap.set(
      q.question_code,
      q.id,
    );
  }

  // Fallback reload for any row not returned by the upsert response.
  const missingQuestionCodes =
    questionCodes.filter(
      (code) => !questionMap.has(code),
    );

  if (missingQuestionCodes.length) {
    const {
      data: reloadedQuestions,
      error: reloadQuestionsError,
    } = await admin
      .from("questions")
      .select("id, question_code")
      .in(
        "question_code",
        missingQuestionCodes,
      );

    if (reloadQuestionsError) {
      return NextResponse.json(
        {
          error:
            `Reload questions failed: ${reloadQuestionsError.message}`,
        },
        { status: 500 },
      );
    }

    for (const q of reloadedQuestions || []) {
      questionMap.set(
        q.question_code,
        q.id,
      );
    }
  }

  const unresolvedQuestionCodes =
    questionCodes.filter(
      (code) => !questionMap.has(code),
    );

  if (unresolvedQuestionCodes.length) {
    return NextResponse.json(
      {
        error:
          `Could not resolve database IDs for questions: ${unresolvedQuestionCodes.join(", ")}`,
      },
      { status: 500 },
    );
  }

  const questionIds =
    questionCodes.map(
      (code) => questionMap.get(code),
    );

  // --------------------------------------------------------------------------
  // 8. REPLACE CHILD ROWS IN BATCHES
  // --------------------------------------------------------------------------

  for (const table of [
    "question_options",
    "question_statements",
    "question_match_items",
    "answers",
  ]) {
    const { error: deleteError } = await admin
      .from(table)
      .delete()
      .in(
        "question_id",
        questionIds,
      );

    if (deleteError) {
      return NextResponse.json(
        {
          error:
            `Clear ${table} failed: ${deleteError.message}`,
        },
        { status: 500 },
      );
    }
  }

  const optionRows = [];
  const statementRows = [];
  const matchRows = [];
  const answerRows = [];

  let optionsCount = 0;
  let statementsCount = 0;
  let matchCount = 0;
  let droppedCount = 0;

  for (const q of payload.questions) {
    const questionId =
      questionMap.get(
        q.question_code,
      );

    // ------------------------------------------------------------------------
    // OPTIONS
    // ------------------------------------------------------------------------

    for (const o of q.options) {
      optionRows.push({
        question_id:
          questionId,

        option_id:
          String(o.option_id),

        option_text:
          o.option_text.trim(),

        sort_order:
          parseInt(
            o.option_id,
            10,
          ) || 0,
      });
    }

    // ------------------------------------------------------------------------
    // STATEMENTS
    // ------------------------------------------------------------------------

    if (
      Array.isArray(q.statements) &&
      q.statements.length
    ) {
      for (
        const [
          index,
          statement,
        ] of q.statements.entries()
      ) {
        const label =
          typeof statement === "string"
            ? String.fromCharCode(
                65 + index,
              )
            : statement?.label ||
              String.fromCharCode(
                65 + index,
              );

        const text =
          typeof statement === "string"
            ? statement
            : statement?.text || "";

        statementRows.push({
          question_id:
            questionId,

          label,

          text,

          sort_order:
            index,
        });
      }
    }

    // ------------------------------------------------------------------------
    // MATCHING ITEMS
    // ------------------------------------------------------------------------

    if (
      (Array.isArray(q.match_left) &&
        q.match_left.length) ||
      (Array.isArray(q.match_right) &&
        q.match_right.length)
    ) {
      for (
        const [
          index,
          item,
        ] of (q.match_left || []).entries()
      ) {
        matchRows.push({
          question_id:
            questionId,

          side:
            "left",

          label:
            item?.label ||
            String.fromCharCode(
              65 + index,
            ),

          text:
            item?.text || "",

          sort_order:
            index,
        });
      }

      for (
        const [
          index,
          item,
        ] of (q.match_right || []).entries()
      ) {
        matchRows.push({
          question_id:
            questionId,

          side:
            "right",

          label:
            item?.label ||
            String.fromCharCode(
              65 + index,
            ),

          text:
            item?.text || "",

          sort_order:
            index,
        });
      }
    }

    // ------------------------------------------------------------------------
    // ANSWER
    // ------------------------------------------------------------------------

    answerRows.push({
      question_id:
        questionId,

      correct_option_id:
        q.answer_status === "dropped"
          ? null
          : String(
              q.correct_option_label,
            ),

      scoring_type:
        "single_correct",
    });

    if (
      q.answer_status ===
      "dropped"
    ) {
      droppedCount++;
    }
  }

  optionsCount =
    optionRows.length;

  statementsCount =
    statementRows.length;

  matchCount =
    matchRows.length;

  // --------------------------------------------------------------------------
  // INSERT OPTIONS
  // --------------------------------------------------------------------------

  if (optionRows.length) {
    const { error } = await admin
      .from("question_options")
      .insert(optionRows);

    if (error) {
      return NextResponse.json(
        {
          error:
            `Insert options failed: ${error.message}`,
        },
        { status: 500 },
      );
    }
  }

  // --------------------------------------------------------------------------
  // INSERT STATEMENTS
  // --------------------------------------------------------------------------

  if (statementRows.length) {
    const { error } = await admin
      .from("question_statements")
      .insert(statementRows);

    if (error) {
      return NextResponse.json(
        {
          error:
            `Insert statements failed: ${error.message}`,
        },
        { status: 500 },
      );
    }
  }

  // --------------------------------------------------------------------------
  // INSERT MATCH ITEMS
  // --------------------------------------------------------------------------

  if (matchRows.length) {
    const { error } = await admin
      .from("question_match_items")
      .insert(matchRows);

    if (error) {
      return NextResponse.json(
        {
          error:
            `Insert match items failed: ${error.message}`,
        },
        { status: 500 },
      );
    }
  }

  // --------------------------------------------------------------------------
  // INSERT ANSWERS
  // --------------------------------------------------------------------------

  if (answerRows.length) {
    const { error } = await admin
      .from("answers")
      .insert(answerRows);

    if (error) {
      return NextResponse.json(
        {
          error:
            `Insert answers failed: ${error.message}`,
        },
        { status: 500 },
      );
    }
  }

  // --------------------------------------------------------------------------
  // 9. LINK QUESTIONS TO TEST
  // --------------------------------------------------------------------------

  const tqRows =
    payload.questions.map(
      (q, index) => ({
        test_id:
          test.id,

        question_id:
          questionMap.get(
            q.question_code,
          ),

        sequence_number:
          index + 1,
      }),
    );

  if (tqRows.length) {
    const { error: tqErr } =
      await admin
        .from("test_questions")
        .upsert(
          tqRows,
          {
            onConflict:
              "test_id,question_id",
          },
        );

    if (tqErr) {
      return NextResponse.json(
        {
          error:
            `Link test_questions failed: ${tqErr.message}`,
        },
        { status: 500 },
      );
    }
  }

  // --------------------------------------------------------------------------
  // 10. SUCCESS RESPONSE
  // --------------------------------------------------------------------------

  const updatedCount =
    questionCodes.filter(
      (code) =>
        existingQuestionMap.has(code),
    ).length;

  const insertedCount =
    questionCodes.length -
    updatedCount;

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
        questionCodes.length,

      inserted:
        insertedCount,

      updated:
        updatedCount,

      passages:
        passageList.length,

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
  // 2. Check whether the user is allowed to access this particular test.
  // --------------------------------------------------------------------------

  const entitlement = await getTestEntitlement(
    user.id,
    test_id,
  );

  if (!entitlement?.allowed) {
    return NextResponse.json(
      {
        error:
          entitlement?.reason ||
          "You do not have access to this test.",
      },
      { status: 403 },
    );
  }

  // --------------------------------------------------------------------------
  // 3. Check whether the user already has an in-progress attempt.
  // --------------------------------------------------------------------------

  const {
    data: existingAttempt,
    error: attemptLookupError,
  } = await admin
    .from("test_attempts")
    .select("*")
    .eq("user_id", user.id)
    .eq("test_id", test_id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (attemptLookupError) {
    return NextResponse.json(
      {
        error:
          `Attempt lookup failed: ${attemptLookupError.message}`,
      },
      { status: 500 },
    );
  }

  if (existingAttempt) {
    const {
      data: testQuestions,
      error: testQuestionsError,
    } = await admin
      .from("test_questions")
      .select("question_id")
      .eq("test_id", test_id);

    if (testQuestionsError) {
      return NextResponse.json(
        {
          error:
            `Unable to load test questions: ${testQuestionsError.message}`,
        },
        { status: 500 },
      );
    }

    if (testQuestions?.length) {
      const responseRows =
        testQuestions.map(
          (row) => ({
            attempt_id:
              existingAttempt.id,

            question_id:
              row.question_id,
          }),
        );

      const {
        error: responseInsertError,
      } = await admin
        .from("attempt_responses")
        .upsert(
          responseRows,
          {
            onConflict:
              "attempt_id,question_id",

            ignoreDuplicates:
              true,
          },
        );

      if (responseInsertError) {
        return NextResponse.json(
          {
            error:
              `Unable to initialize responses: ${responseInsertError.message}`,
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      ok: true,
      attempt_id:
        existingAttempt.id,
      attempt:
        existingAttempt,
      resumed:
        true,
    });
  }

  // --------------------------------------------------------------------------
  // 4. Create a new attempt.
  // --------------------------------------------------------------------------

  const {
    data: attempt,
    error: attemptInsertError,
  } = await admin
    .from("test_attempts")
    .insert({
      user_id:
        user.id,

      test_id,

      status:
        "in_progress",

      started_at:
        new Date().toISOString(),
    })
    .select()
    .single();

  if (attemptInsertError) {
    return NextResponse.json(
      {
        error:
          `Unable to create attempt: ${attemptInsertError.message}`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // 5. Pre-create one attempt_responses row for every question.
  // --------------------------------------------------------------------------

  const {
    data: testQuestions,
    error: testQuestionsError,
  } = await admin
    .from("test_questions")
    .select("question_id")
    .eq("test_id", test_id);

  if (testQuestionsError) {
    await admin
      .from("test_attempts")
      .delete()
      .eq("id", attempt.id)
      .eq("user_id", user.id);

    return NextResponse.json(
      {
        error:
          `Unable to load test questions: ${testQuestionsError.message}`,
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
      {
        error:
          "This test has no questions.",
      },
      { status: 400 },
    );
  }

  const responseRows =
    testQuestions.map(
      (row) => ({
        attempt_id:
          attempt.id,

        question_id:
          row.question_id,
      }),
    );

  const {
    error: responseInsertError,
  } = await admin
    .from("attempt_responses")
    .insert(responseRows);

  if (responseInsertError) {
    await admin
      .from("test_attempts")
      .delete()
      .eq("id", attempt.id)
      .eq("user_id", user.id);

    return NextResponse.json(
      {
        error:
          `Unable to initialize responses: ${responseInsertError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    attempt_id:
      attempt.id,
    attempt,
    resumed:
      false,
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

  await admin
    .from("attempt_answers")
    .delete()
    .eq("attempt_id", attempt.id);

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

  const completedAt =
    new Date().toISOString();

  const {
    data: updatedAttempt,
    error: updateAttemptError,
  } = await admin
    .from("attempts")
    .update({
      status:
        "completed",

      score,

      attempted,

      total_questions:
        questions?.length || 0,

      completed_at:
        completedAt,
    })
    .eq("id", attempt.id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateAttemptError) {
    return NextResponse.json(
      {
        error:
          `Unable to complete attempt: ${updateAttemptError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    attempt:
      updatedAttempt,
    score,
    attempted,
    total_questions:
      questions?.length || 0,
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

  const requestedQuestionCount =
    Math.min(
      Math.floor(requestedCount),
      100,
    );

  // --------------------------------------------------------------------------
  // Custom tests require Test Series entitlement.
  // --------------------------------------------------------------------------

  const entitlement =
    await getTestEntitlement(
      user.id,
      "custom",
    );

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

  let query =
    admin
      .from("questions")
      .select("id")
      .eq("status", "published");

  if (unit_ids.length) {
    query =
      query.in(
        "unit_id",
        unit_ids,
      );
  }

  if (topic_ids.length) {
    query =
      query.in(
        "topic_id",
        topic_ids,
      );
  }

  if (
    difficulties.length &&
    difficulties.length < 3
  ) {
    query =
      query.in(
        "difficulty",
        difficulties,
      );
  }

  const {
    data: pool,
    error: poolError,
  } = await query.limit(2000);

  if (poolError) {
    return NextResponse.json(
      {
        error:
          `Unable to load matching questions: ${poolError.message}`,
      },
      { status: 500 },
    );
  }

  if (!pool || pool.length === 0) {
    return NextResponse.json(
      {
        error:
          "No questions match the selected criteria.",
      },
      { status: 400 },
    );
  }

  // --------------------------------------------------------------------------
  // Randomize the question pool using Fisher-Yates.
  // --------------------------------------------------------------------------

  const ids =
    pool.map(
      (row) => row.id,
    );

  for (
    let i = ids.length - 1;
    i > 0;
    i--
  ) {
    const j =
      Math.floor(
        Math.random() *
          (i + 1),
      );

    [ids[i], ids[j]] =
      [ids[j], ids[i]];
  }

  const chosen =
    ids.slice(
      0,
      Math.min(
        requestedQuestionCount,
        ids.length,
      ),
    );

  // --------------------------------------------------------------------------
  // Create the actual test.
  // --------------------------------------------------------------------------

  const testKey =
    `CUSTOM_${user.id.slice(0, 8)}_${Date.now()}`;

  const {
    data: test,
    error: testError,
  } = await admin
    .from("tests")
    .insert({
      test_id:
        testKey,

      title:
        `Custom test · ${chosen.length} Q`,

      test_type:
        "custom",

      total_questions:
        chosen.length,

      duration_minutes:
        Math.max(
          10,
          chosen.length,
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
        "published",
    })
    .select()
    .single();

  if (testError) {
    return NextResponse.json(
      {
        error:
          `Unable to create custom test: ${testError.message}`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // Attach the selected questions to the newly-created test.
  // --------------------------------------------------------------------------

  const testQuestionRows =
    chosen.map(
      (questionId, index) => ({
        test_id:
          test.id,

        question_id:
          questionId,

        sequence_number:
          index + 1,
      }),
    );

  const {
    error: testQuestionsError,
  } = await admin
    .from("test_questions")
    .insert(testQuestionRows);

  if (testQuestionsError) {
    await admin
      .from("tests")
      .delete()
      .eq("id", test.id);

    return NextResponse.json(
      {
        error:
          `Unable to attach questions to custom test: ${testQuestionsError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    test_uuid:
      test.id,
    total:
      chosen.length,
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
    return NextResponse.json(
      { error: "Missing plan_id." },
      { status: 400 },
    );
  }

  const {
    data: plan,
    error: planError,
  } = await admin
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .eq("is_active", true)
    .maybeSingle();

  if (planError) {
    return NextResponse.json(
      {
        error:
          `Plan lookup failed: ${planError.message}`,
      },
      { status: 500 },
    );
  }

  if (!plan) {
    return NextResponse.json(
      {
        error:
          "Selected plan is not available.",
      },
      { status: 404 },
    );
  }

  if (!plan.is_purchasable) {
    return NextResponse.json(
      {
        error:
          "This plan is not currently available for purchase.",
      },
      { status: 400 },
    );
  }

  const {
    data: existingSubscriptions,
    error: existingError,
  } = await admin
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .order(
      "created_at",
      { ascending: false },
    );

  if (existingError) {
    return NextResponse.json(
      {
        error:
          `Unable to check existing subscriptions: ${existingError.message}`,
      },
      { status: 500 },
    );
  }

  const activeSubscription =
    (existingSubscriptions || []).find(
      (sub) =>
        sub.status === "active" &&
        (!sub.expires_at ||
          new Date(sub.expires_at) >
            new Date()),
    ) || null;

  if (activeSubscription) {
    return NextResponse.json(
      {
        error:
          "You already have an active subscription.",

        subscription_id:
          activeSubscription.razorpay_subscription_id,
      },
      { status: 409 },
    );
  }

  const pastDueSubscription =
    (existingSubscriptions || []).find(
      (sub) =>
        sub.status === "past_due",
    ) || null;

  if (pastDueSubscription) {
    return NextResponse.json(
      {
        error:
          "You already have a subscription with an unresolved payment status.",

        subscription_id:
          pastDueSubscription.razorpay_subscription_id,
      },
      { status: 409 },
    );
  }

  const createdSubscription =
    (existingSubscriptions || []).find(
      (sub) =>
        sub.status === "created",
    ) || null;

  if (createdSubscription) {
    let providerSubscription;

    try {
      const rzp =
        getRazorpay();

      providerSubscription =
        await rzp.subscriptions.fetch(
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
      providerSubscription.status ===
        "cancelled" ||
      providerSubscription.status ===
        "expired"
    ) {
      await admin
        .from("subscriptions")
        .update({
          status:
            providerSubscription.status ===
              "cancelled"
              ? "cancelled"
              : "expired",

          updated_at:
            new Date().toISOString(),
        })
        .eq(
          "id",
          createdSubscription.id,
        )
        .eq(
          "user_id",
          user.id,
        );
    } else if (
      providerSubscription.status ===
      "active"
    ) {
      return NextResponse.json(
        {
          error:
            "You already have an active subscription.",

          subscription_id:
            providerSubscription.id,
        },
        { status: 409 },
      );
    } else if (
      providerSubscription.customer_id
    ) {
      return NextResponse.json(
        {
          error:
            "Your payment authorization is already in progress. Please finish the current payment before starting another subscription.",

          subscription_id:
            providerSubscription.razorpay_subscription_id,
        },
        { status: 409 },
      );
    } else {
      return NextResponse.json(
        {
          error:
            "You already have a subscription that is still being processed. Please finish or close the current payment window before starting another subscription.",

          subscription_id:
            createdSubscription.razorpay_subscription_id,
        },
        { status: 409 },
      );
    }
  }

  const rzp =
    getRazorpay();

  const expireBy =
    Math.floor(
      Date.now() / 1000,
    ) +
    30 * 60;

  let razorpaySubscription;

  try {
    razorpaySubscription =
      await rzp.subscriptions.create({
        plan_id:
          plan.razorpay_plan_id,

        total_count:
          12,

        customer_notify:
          1,

        expire_by:
          expireBy,
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

  const authorizationExpiry =
    new Date(
      (razorpaySubscription.expire_by ||
        expireBy) *
        1000,
    );

  const {
    data: insertedSubscription,
    error: insertError,
  } = await admin
    .from("subscriptions")
    .insert({
      user_id:
        user.id,

      plan_id:
        plan.id,

      razorpay_subscription_id:
        razorpaySubscription.id,

      razorpay_customer_id:
        razorpaySubscription.customer_id ||
        null,

      status:
        razorpaySubscription.status ||
        "created",

      cancel_at_period_end:
        false,

      expires_at:
        authorizationExpiry.toISOString(),

      created_at:
        new Date().toISOString(),

      updated_at:
        new Date().toISOString(),
    })
    .select()
    .single();

  if (insertError) {
    try {
      await rzp.subscriptions.cancel(
        razorpaySubscription.id,
        {
          cancel_at_cycle_end:
            false,
        },
      );
    } catch (cancelError) {
      console.error(
        "Failed to clean up orphaned Razorpay subscription:",
        cancelError,
      );
    }

    return NextResponse.json(
      {
        error:
          `Unable to save subscription: ${insertError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,

    subscription_id:
      insertedSubscription.razorpay_subscription_id,

    razorpay_key_id:
      process.env.RAZORPAY_KEY_ID,
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

  const {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
  } = body || {};

  if (
    !razorpay_payment_id ||
    !razorpay_subscription_id ||
    !razorpay_signature
  ) {
    return NextResponse.json(
      {
        error:
          "Incomplete Razorpay verification data.",
      },
      { status: 400 },
    );
  }

  const {
    data: sub,
    error: subError,
  } = await admin
    .from("subscriptions")
    .select("*")
    .eq(
      "razorpay_subscription_id",
      razorpay_subscription_id,
    )
    .maybeSingle();

  if (subError) {
    return NextResponse.json(
      {
        error:
          `Subscription lookup failed: ${subError.message}`,
      },
      { status: 500 },
    );
  }

  if (
    !sub ||
    sub.user_id !== user.id
  ) {
    return NextResponse.json(
      {
        error:
          "Not your subscription",
      },
      { status: 403 },
    );
  }

  const secret =
    process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Razorpay secret is not configured.",
      },
      { status: 500 },
    );
  }

  const generatedSignature =
    crypto
      .createHmac(
        "sha256",
        secret,
      )
      .update(
        `${razorpay_payment_id}|${razorpay_subscription_id}`,
      )
      .digest("hex");

  if (
    generatedSignature !==
    razorpay_signature
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid Razorpay signature.",
      },
      { status: 400 },
    );
  }

  const rzp =
    getRazorpay();

  let providerSubscription;

  try {
    providerSubscription =
      await rzp.subscriptions.fetch(
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
      providerSubscription.status ===
      "active"
        ? "active"
        : providerSubscription.status ||
          "active",

    razorpay_customer_id:
      providerSubscription.customer_id ||
      sub.razorpay_customer_id ||
      null,

    updated_at:
      new Date().toISOString(),
  };

  if (
    providerSubscription.current_start
  ) {
    patch.started_at =
      new Date(
        providerSubscription.current_start *
          1000,
      ).toISOString();
  }

  if (
    providerSubscription.current_end
  ) {
    patch.expires_at =
      new Date(
        providerSubscription.current_end *
          1000,
      ).toISOString();
  }

  const {
    error: updateError,
  } = await admin
    .from("subscriptions")
    .update(patch)
    .eq(
      "id",
      sub.id,
    )
    .eq(
      "user_id",
      user.id,
    );

  if (updateError) {
    return NextResponse.json(
      {
        error:
          `Unable to update subscription: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    status:
      patch.status,
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

  const {
    razorpay_subscription_id,
  } = body || {};

  if (!razorpay_subscription_id) {
    return NextResponse.json(
      {
        error:
          "Missing Razorpay subscription ID.",
      },
      { status: 400 },
    );
  }

  const {
    data: sub,
    error: subError,
  } = await admin
    .from("subscriptions")
    .select("*")
    .eq(
      "razorpay_subscription_id",
      razorpay_subscription_id,
    )
    .maybeSingle();

  if (subError) {
    return NextResponse.json(
      {
        error:
          `Subscription lookup failed: ${subError.message}`,
      },
      { status: 500 },
    );
  }

  if (
    !sub ||
    sub.user_id !== user.id
  ) {
    return NextResponse.json(
      {
        error:
          "Not your subscription",
      },
      { status: 403 },
    );
  }

  try {
    const rzp =
      getRazorpay();

    await rzp.subscriptions.cancel(
      razorpay_subscription_id,
      {
        cancel_at_cycle_end:
          1,
      },
    );
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Razorpay cancel failed: ` +
          `${e?.error?.description || e.message}`,
      },
      { status: 500 },
    );
  }

  await admin
    .from("subscriptions")
    .update({
      cancel_at_period_end:
        true,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "razorpay_subscription_id",
      razorpay_subscription_id,
    );

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

  const {
    razorpay_subscription_id,
  } = body || {};

  if (!razorpay_subscription_id) {
    return NextResponse.json(
      {
        error:
          "Missing Razorpay subscription ID.",
      },
      { status: 400 },
    );
  }

  const {
    data: sub,
    error: subLookupError,
  } = await admin
    .from("subscriptions")
    .select(
      "id, user_id, razorpay_subscription_id, status, cancel_at_period_end",
    )
    .eq(
      "razorpay_subscription_id",
      razorpay_subscription_id,
    )
    .maybeSingle();

  if (subLookupError) {
    return NextResponse.json(
      {
        error:
          `Unable to find subscription: ${subLookupError.message}`,
      },
      { status: 500 },
    );
  }

  if (!sub) {
    return NextResponse.json(
      {
        error:
          "Subscription was not found.",
      },
      { status: 404 },
    );
  }

  if (
    sub.user_id !==
    user.id
  ) {
    return NextResponse.json(
      {
        error:
          "This subscription does not belong to the current user.",
      },
      { status: 403 },
    );
  }

  // Never use this endpoint to alter an active or unresolved payment state.
  if (
    sub.status !==
    "created"
  ) {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status:
        sub.status,
    });
  }

  let providerSubscription;

  try {
    const rzp =
      getRazorpay();

    providerSubscription =
      await rzp.subscriptions.fetch(
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

  if (
    providerSubscription.status ===
    "active"
  ) {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status:
        "active",
    });
  }

  if (
    providerSubscription.status ===
      "cancelled" ||
    providerSubscription.status ===
      "expired"
  ) {
    await admin
      .from("subscriptions")
      .update({
        status:
          providerSubscription.status,

        updated_at:
          new Date().toISOString(),
      })
      .eq(
        "id",
        sub.id,
      )
      .eq(
        "user_id",
        user.id,
      );

    return NextResponse.json({
      ok: true,

      cancelled:
        providerSubscription.status ===
        "cancelled",

      status:
        providerSubscription.status,
    });
  }

  if (
    providerSubscription.customer_id
  ) {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status:
        providerSubscription.status,
    });
  }

  const {
    error: updateError,
  } = await admin
    .from("subscriptions")
    .update({
      status:
        "cancelled",

      cancel_at_period_end:
        false,

      updated_at:
        new Date().toISOString(),
    })
    .eq(
      "id",
      sub.id,
    )
    .eq(
      "user_id",
      user.id,
    )
    .eq(
      "status",
      "created",
    );

  if (updateError) {
    return NextResponse.json(
      {
        error:
          `Unable to release pending subscription: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,

    cancelled:
      true,

    status:
      "cancelled",

    provider_status:
      providerSubscription.status,

    provider_action:
      "expire_by",
  });
}

// ----------------------------------------------------------------------------
// POST /api/webhooks/razorpay
// ----------------------------------------------------------------------------

async function handleRazorpayWebhook(request) {
  const rawBody =
    await request.text();

  const sig =
    request.headers.get(
      "x-razorpay-signature",
    ) || "";

  const secret =
    process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error:
          "Webhook secret not configured",
      },
      { status: 500 },
    );
  }

  const expected =
    crypto
      .createHmac(
        "sha256",
        secret,
      )
      .update(rawBody)
      .digest("hex");

  const a =
    Buffer.from(expected);

  const b =
    Buffer.from(sig);

  if (
    a.length !==
      b.length ||
    !crypto.timingSafeEqual(
      a,
      b,
    )
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Signature mismatch",
      },
      { status: 401 },
    );
  }

  let evt;

  try {
    evt =
      JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      {
        error:
          "Bad JSON",
      },
      { status: 400 },
    );
  }

  const admin =
    getSupabaseAdmin();

  const sub =
    evt?.payload?.subscription?.entity;

  const pay =
    evt?.payload?.payment?.entity;

  const subjectId =
    sub?.id ||
    pay?.id ||
    "unknown";

  const providerEventId =
    `${evt.event}:${subjectId}:${evt.created_at}`;

  const {
    error: dupErr,
  } = await admin
    .from("payment_events")
    .insert({
      provider:
        "razorpay",

      provider_event_id:
        providerEventId,

      event_type:
        evt.event,

      payload:
        evt,
    });

  if (dupErr) {
    if (
      dupErr.code ===
      "23505"
    ) {
      return NextResponse.json({
        ok: true,
        duplicate:
          true,
      });
    }

    return NextResponse.json(
      {
        error:
          dupErr.message,
      },
      { status: 500 },
    );
  }

  // Update subscription state.
  if (
    sub?.id &&
    evt.event.startsWith(
      "subscription.",
    )
  ) {
    const statusMap = {
      "subscription.activated":
        "active",

      "subscription.charged":
        "active",

      "subscription.pending":
        "past_due",

      "subscription.halted":
        "past_due",

      "subscription.cancelled":
        "cancelled",

      "subscription.completed":
        "expired",

      "subscription.expired":
        "expired",
    };

    const nextStatus =
      statusMap[evt.event] ||
      sub.status ||
      "active";

    const patch = {
      status:
        nextStatus,

      razorpay_customer_id:
        sub.customer_id ||
        undefined,

      updated_at:
        new Date().toISOString(),
    };

    if (
      sub.current_start
    ) {
      patch.started_at =
        new Date(
          sub.current_start *
            1000,
        ).toISOString();
    }

    if (
      sub.current_end
    ) {
      patch.expires_at =
        new Date(
          sub.current_end *
            1000,
        ).toISOString();
    }

    if (
      evt.event ===
      "subscription.cancelled"
    ) {
      patch.cancel_at_period_end =
        true;
    }

    await admin
      .from("subscriptions")
      .update(patch)
      .eq(
        "razorpay_subscription_id",
        sub.id,
      );
  }

  return NextResponse.json({
    ok: true,
  });
}

// ----------------------------------------------------------------------------
// DISPATCHER
// ----------------------------------------------------------------------------

async function dispatch(
  request,
  method,
) {
  const url =
    new URL(
      request.url,
    );

  const path =
    url.pathname.replace(
      /^\/api/,
      "",
    );

  if (
    method === "POST" &&
    path === "/admin/import"
  ) {
    return handleImport(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/attempt/create"
  ) {
    return handleCreateAttempt(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/attempt/submit"
  ) {
    return handleSubmitAttempt(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/custom-test/create"
  ) {
    return handleCustomTestCreate(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/billing/create-subscription"
  ) {
    return handleCreateSubscription(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/billing/verify"
  ) {
    return handleVerify(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/billing/cancel"
  ) {
    return handleCancel(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/billing/cancel-pending"
  ) {
    return handleCancelPending(
      request,
    );
  }

  if (
    method === "POST" &&
    path === "/webhooks/razorpay"
  ) {
    return handleRazorpayWebhook(
      request,
    );
  }

  if (
    method === "GET" &&
    path === "/health"
  ) {
    return NextResponse.json({
      ok: true,
      ts:
        Date.now(),
    });
  }

  return NextResponse.json(
    {
      error:
        `No route for ${method} ${path}`,
    },
    { status: 404 },
  );
}

export async function GET(
  request,
) {
  return dispatch(
    request,
    "GET",
  );
}

export async function POST(
  request,
) {
  return dispatch(
    request,
    "POST",
  );
}

export async function PUT(
  request,
) {
  return dispatch(
    request,
    "PUT",
  );
}

export async function DELETE(
  request,
) {
  return dispatch(
    request,
    "DELETE",
  );
}