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
      if (
        typeof o?.option_text !== "string" ||
        !o.option_text.trim()
      ) {
        return NextResponse.json(
          {
            error: `${q.question_code}: option ${o?.option_id ?? "?"} is missing option_text`,
          },
          { status: 400 },
        );
      }

      if (placeholderOption.test(o.option_text.trim())) {
        return NextResponse.json(
          {
            error:
              `${q.question_code}: option ${o.option_id} contains placeholder data ` +
              `("${o.option_text}"). Import cancelled.`,
          },
          { status: 400 },
        );
      }
    }

    if (
      q.correct_option_id !== null &&
      q.correct_option_id !== undefined &&
      !["1", "2", "3", "4"].includes(String(q.correct_option_id))
    ) {
      return NextResponse.json(
        {
          error:
            `${q.question_code}: correct_option_id must be 1, 2, 3, or 4.`,
        },
        { status: 400 },
      );
    }

    if (
      q.question_type === "assertion_reason" &&
      (!q.assertion || !q.reason)
    ) {
      warnings.push(
        `${q.question_code}: assertion/reason question is missing assertion or reason text.`,
      );
    }

    if (
      q.question_type === "match" &&
      (!Array.isArray(q.match_items) || q.match_items.length === 0)
    ) {
      warnings.push(
        `${q.question_code}: match question has no match_items.`,
      );
    }

    if (
      q.question_type === "statement" &&
      (!Array.isArray(q.statements) || q.statements.length === 0)
    ) {
      warnings.push(
        `${q.question_code}: statement question has no statements.`,
      );
    }

    if (
      q.passage_id !== null &&
      q.passage_id !== undefined &&
      !passageList.some(
        (p) => String(p?.passage_id) === String(q.passage_id),
      )
    ) {
      warnings.push(
        `${q.question_code}: passage_id ${q.passage_id} does not match a supplied passage.`,
      );
    }
  }

  const {
    data: existingTest,
    error: existingTestError,
  } = await admin
    .from("tests")
    .select("id")
    .eq("test_id", payload.test_id)
    .maybeSingle();

  if (existingTestError) {
    return NextResponse.json(
      {
        error: `Unable to check existing test: ${existingTestError.message}`,
      },
      { status: 500 },
    );
  }

  let testRow;

  if (existingTest) {
    const { data, error } = await admin
      .from("tests")
      .update({
        title: payload.title || payload.test_id,
        test_type: payload.test_type,
        total_questions: Number(payload.total_questions),
        duration_minutes: Number(payload.duration_minutes),
        metadata: payload.metadata || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingTest.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        {
          error: `Unable to update test: ${error.message}`,
        },
        { status: 500 },
      );
    }

    testRow = data;
  } else {
    const { data, error } = await admin
      .from("tests")
      .insert({
        test_id: payload.test_id,
        title: payload.title || payload.test_id,
        test_type: payload.test_type,
        total_questions: Number(payload.total_questions),
        duration_minutes: Number(payload.duration_minutes),
        metadata: payload.metadata || null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        {
          error: `Unable to create test: ${error.message}`,
        },
        { status: 500 },
      );
    }

    testRow = data;
  }

  if (passageList.length > 0) {
    const passageRows = passageList.map((p) => ({
      test_id: testRow.id,
      passage_id: p.passage_id,
      passage_text: p.passage_text || p.text || "",
      metadata: p.metadata || null,
    }));

    const { error: passageError } = await admin
      .from("passages")
      .upsert(passageRows, {
        onConflict: "test_id,passage_id",
      });

    if (passageError) {
      return NextResponse.json(
        {
          error: `Unable to save passages: ${passageError.message}`,
        },
        { status: 500 },
      );
    }
  }

  const questionRows = payload.questions.map((q, index) => ({
    test_id: testRow.id,
    question_code: q.question_code,
    sequence_number:
      q.sequence_number !== undefined
        ? Number(q.sequence_number)
        : index + 1,
    question_text: q.question_text,
    question_type: q.question_type || "mcq",
    correct_option_id:
      q.correct_option_id !== null &&
      q.correct_option_id !== undefined
        ? String(q.correct_option_id)
        : null,
    explanation: q.explanation || null,
    subject: q.subject || null,
    unit: q.unit || null,
    topic: q.topic || null,
    difficulty: q.difficulty || null,
    passage_id: q.passage_id || null,
    metadata: q.metadata || null,
  }));

  const { data: insertedQuestions, error: questionError } = await admin
    .from("questions")
    .upsert(questionRows, {
      onConflict: "test_id,question_code",
    })
    .select("id, question_code");

  if (questionError) {
    return NextResponse.json(
      {
        error: `Unable to save questions: ${questionError.message}`,
      },
      { status: 500 },
    );
  }

  const questionIdByCode = new Map(
    (insertedQuestions || []).map((q) => [q.question_code, q.id]),
  );

  for (const q of payload.questions) {
    const questionId = questionIdByCode.get(q.question_code);

    if (!questionId) {
      return NextResponse.json(
        {
          error:
            `Question ${q.question_code} was not returned after database upsert.`,
        },
        { status: 500 },
      );
    }

    await admin
      .from("options")
      .delete()
      .eq("question_id", questionId);

    const optionRows = q.options.map((o) => ({
      question_id: questionId,
      option_id: String(o.option_id),
      option_text: o.option_text,
    }));

    const { error: optionError } = await admin
      .from("options")
      .insert(optionRows);

    if (optionError) {
      return NextResponse.json(
        {
          error:
            `Unable to save options for ${q.question_code}: ` +
            `${optionError.message}`,
        },
        { status: 500 },
      );
    }

    await admin
      .from("statements")
      .delete()
      .eq("question_id", questionId);

    if (Array.isArray(q.statements) && q.statements.length > 0) {
      const statementRows = q.statements.map((s, index) => ({
        question_id: questionId,
        statement_number:
          s.statement_number !== undefined
            ? Number(s.statement_number)
            : index + 1,
        statement_text: s.statement_text || s.text || "",
      }));

      const { error: statementError } = await admin
        .from("statements")
        .insert(statementRows);

      if (statementError) {
        return NextResponse.json(
          {
            error:
              `Unable to save statements for ${q.question_code}: ` +
              `${statementError.message}`,
          },
          { status: 500 },
        );
      }
    }

    await admin
      .from("match_items")
      .delete()
      .eq("question_id", questionId);

    if (Array.isArray(q.match_items) && q.match_items.length > 0) {
      const matchRows = q.match_items.map((item, index) => ({
        question_id: questionId,
        item_number:
          item.item_number !== undefined
            ? Number(item.item_number)
            : index + 1,
        left_text: item.left_text || item.left || "",
        right_text: item.right_text || item.right || "",
      }));

      const { error: matchError } = await admin
        .from("match_items")
        .insert(matchRows);

      if (matchError) {
        return NextResponse.json(
          {
            error:
              `Unable to save match items for ${q.question_code}: ` +
              `${matchError.message}`,
          },
          { status: 500 },
        );
      }
    }

    await admin
      .from("answers")
      .delete()
      .eq("question_id", questionId);

    if (Array.isArray(q.answers) && q.answers.length > 0) {
      const answerRows = q.answers.map((answer) => ({
        question_id: questionId,
        answer_text: answer.answer_text || answer.text || "",
        answer_type: answer.answer_type || null,
        metadata: answer.metadata || null,
      }));

      const { error: answerError } = await admin
        .from("answers")
        .insert(answerRows);

      if (answerError) {
        return NextResponse.json(
          {
            error:
              `Unable to save answers for ${q.question_code}: ` +
              `${answerError.message}`,
          },
          { status: 500 },
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    test_id: payload.test_id,
    test_database_id: testRow.id,
    imported_questions: payload.questions.length,
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
    return NextResponse.json(
      { error: "Missing test_id" },
      { status: 400 },
    );
  }

  const entitlement = await getTestEntitlement(user.id, test_id);

  if (!entitlement?.allowed) {
    return NextResponse.json(
      {
        error: entitlement?.reason || "You do not have access to this test.",
      },
      { status: 403 },
    );
  }

  const { data: test, error: testError } = await admin
    .from("tests")
    .select("*")
    .eq("id", test_id)
    .maybeSingle();

  if (testError) {
    return NextResponse.json(
      {
        error: `Unable to load test: ${testError.message}`,
      },
      { status: 500 },
    );
  }

  if (!test) {
    return NextResponse.json(
      { error: "Test not found." },
      { status: 404 },
    );
  }

  const { data: questions, error: questionsError } = await admin
    .from("questions")
    .select(
      `
      id,
      question_code,
      sequence_number,
      question_text,
      question_type,
      correct_option_id,
      explanation,
      subject,
      unit,
      topic,
      difficulty,
      passage_id,
      options (
        id,
        option_id,
        option_text
      ),
      statements (
        id,
        statement_number,
        statement_text
      ),
      match_items (
        id,
        item_number,
        left_text,
        right_text
      )
    `,
    )
    .eq("test_id", test_id)
    .order("sequence_number", { ascending: true });

  if (questionsError) {
    return NextResponse.json(
      {
        error: `Unable to load test questions: ${questionsError.message}`,
      },
      { status: 500 },
    );
  }

  if (!questions?.length) {
    return NextResponse.json(
      { error: "This test has no questions." },
      { status: 400 },
    );
  }

  const { data: existingAttempt } = await admin
    .from("attempts")
    .select("*")
    .eq("user_id", user.id)
    .eq("test_id", test_id)
    .eq("status", "in_progress")
    .maybeSingle();

  if (existingAttempt) {
    return NextResponse.json({
      ok: true,
      attempt: existingAttempt,
      questions,
    });
  }

  const { data: attempt, error: attemptError } = await admin
    .from("attempts")
    .insert({
      user_id: user.id,
      test_id,
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (attemptError) {
    return NextResponse.json(
      {
        error: `Unable to create attempt: ${attemptError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    attempt,
    questions,
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

  if (!attempt_id || !answers) {
    return NextResponse.json(
      { error: "Missing attempt_id or answers" },
      { status: 400 },
    );
  }

  const { data: attempt, error: attemptError } = await admin
    .from("attempts")
    .select("*")
    .eq("id", attempt_id)
    .maybeSingle();

  if (attemptError) {
    return NextResponse.json(
      {
        error: `Unable to load attempt: ${attemptError.message}`,
      },
      { status: 500 },
    );
  }

  if (!attempt) {
    return NextResponse.json(
      { error: "Attempt not found." },
      { status: 404 },
    );
  }

  if (attempt.user_id !== user.id) {
    return NextResponse.json(
      { error: "This attempt does not belong to the current user." },
      { status: 403 },
    );
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
      correct_option_id,
      options (
        id,
        option_id,
        option_text
      )
    `,
    )
    .eq("test_id", attempt.test_id);

  if (questionsError) {
    return NextResponse.json(
      {
        error: `Unable to load answer key: ${questionsError.message}`,
      },
      { status: 500 },
    );
  }

  const questionMap = new Map(
    (questions || []).map((q) => [q.id, q]),
  );

  let score = 0;
  let attempted = 0;

  const answerRows = [];

  for (const [questionId, selectedOption] of Object.entries(answers)) {
    const question = questionMap.get(questionId);

    if (!question) continue;

    const normalized =
      selectedOption === null ||
      selectedOption === undefined ||
      selectedOption === ""
        ? null
        : String(selectedOption);

    if (normalized !== null) {
      attempted += 1;

      if (
        question.correct_option_id !== null &&
        String(question.correct_option_id) === normalized
      ) {
        score += 1;
      }
    }

    answerRows.push({
      attempt_id,
      question_id: questionId,
      selected_option_id: normalized,
    });
  }

  if (answerRows.length > 0) {
    const { error: answersError } = await admin
      .from("attempt_answers")
      .upsert(answerRows, {
        onConflict: "attempt_id,question_id",
      });

    if (answersError) {
      return NextResponse.json(
        {
          error: `Unable to save answers: ${answersError.message}`,
        },
        { status: 500 },
      );
    }
  }

  const { data: updatedAttempt, error: updateError } = await admin
    .from("attempts")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      score,
      attempted,
    })
    .eq("id", attempt_id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json(
      {
        error: `Unable to submit attempt: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    attempt: updatedAttempt,
    score,
    attempted,
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

  const entitlement = await getTestEntitlement(user.id, "custom");

  if (!entitlement?.allowed) {
    return NextResponse.json(
      {
        error:
          entitlement?.reason ||
          "You do not have access to the custom test builder.",
      },
      { status: 403 },
    );
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
    unit,
    topic,
    difficulty,
    question_count,
  } = body || {};

  const count = Math.min(
    Math.max(Number(question_count || 10), 1),
    100,
  );

  let query = admin
    .from("questions")
    .select(
      `
      id,
      question_code,
      sequence_number,
      question_text,
      question_type,
      correct_option_id,
      explanation,
      subject,
      unit,
      topic,
      difficulty,
      passage_id,
      options (
        id,
        option_id,
        option_text
      )
    `,
    );

  if (unit) {
    query = query.eq("unit", unit);
  }

  if (topic) {
    query = query.eq("topic", topic);
  }

  if (difficulty) {
    query = query.eq("difficulty", difficulty);
  }

  const { data: questions, error } = await query.limit(count * 3);

  if (error) {
    return NextResponse.json(
      {
        error: `Unable to build custom test: ${error.message}`,
      },
      { status: 500 },
    );
  }

  const shuffled = [...(questions || [])].sort(
    () => Math.random() - 0.5,
  );

  return NextResponse.json({
    ok: true,
    questions: shuffled.slice(0, count),
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
    return NextResponse.json({ error: "Missing plan_id" }, { status: 400 });
  }

  // --------------------------------------------------------------------------
  // Load the plan from our database.
  // --------------------------------------------------------------------------

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("*")
    .eq("id", plan_id)
    .maybeSingle();

  if (planError) {
    return NextResponse.json(
      {
        error: `Failed to load plan: ${planError.message}`,
      },
      { status: 500 },
    );
  }

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (!plan.is_active) {
    return NextResponse.json(
      { error: "This plan is not active." },
      { status: 400 },
    );
  }

  if (!plan.is_purchasable) {
    return NextResponse.json(
      {
        error: "This plan is not purchasable yet.",
      },
      { status: 400 },
    );
  }

  if (!plan.razorpay_plan_id) {
    return NextResponse.json(
      {
        error: "This plan is not linked to a Razorpay plan yet.",
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // Initialise Razorpay.
  // --------------------------------------------------------------------------

  let rzp;

  try {
    rzp = getRazorpay();
  } catch (e) {
    return NextResponse.json(
      {
        error: e?.message || "Razorpay is not configured on the server.",
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // Do not create a second active subscription for the same user/plan.
  //
  // --------------------------------------------------------------------------
  // Check the user's existing subscriptions before creating another one.
  // --------------------------------------------------------------------------

  const { data: existingSubscriptions, error: existingSubscriptionError } =
    await admin
      .from("subscriptions")
      .select(
        "id, plan_id, razorpay_subscription_id, status, expires_at, cancel_at_period_end",
      )
      .eq("user_id", user.id)
      .order("created_at", {
        ascending: false,
      });

  if (existingSubscriptionError) {
    return NextResponse.json(
      {
        error: `Unable to check existing subscriptions: ${existingSubscriptionError.message}`,
      },
      { status: 500 },
    );
  }

  const currentTime = new Date();

  const activeSubscription =
    (existingSubscriptions || []).find((sub) => {
      return (
        sub.status === "active" &&
        sub.expires_at &&
        new Date(sub.expires_at) > currentTime
      );
    }) || null;

  const createdSubscription =
    (existingSubscriptions || []).find(
      (sub) => sub.status === "created",
    ) || null;

  const pastDueSubscription =
    (existingSubscriptions || []).find(
      (sub) => sub.status === "past_due",
    ) || null;

  // --------------------------------------------------------------------------
  // An active Combined subscription means the user already has the highest
  // available plan.
  // --------------------------------------------------------------------------

  if (activeSubscription && activeSubscription.plan_id === plan.id) {
    return NextResponse.json(
      {
        error: "You already have an active subscription for this plan.",
        subscription_id: activeSubscription.razorpay_subscription_id,
      },
      { status: 409 },
    );
  }

  // --------------------------------------------------------------------------
  // If the user is already on Combined, do not allow another subscription.
  // --------------------------------------------------------------------------

  if (activeSubscription && activeSubscription.plan_id !== plan.id) {
    const { data: activePlan } = await admin
      .from("plans")
      .select("id, name")
      .eq("id", activeSubscription.plan_id)
      .maybeSingle();

    if (activePlan?.name === "Combined") {
      return NextResponse.json(
        {
          error: "You already have an active Combined subscription.",
          subscription_id: activeSubscription.razorpay_subscription_id,
        },
        { status: 409 },
      );
    }

    // Allow an upgrade from another active plan to Combined.
    if (plan.name !== "Combined") {
      return NextResponse.json(
        {
          error: "You already have an active subscription.",
          subscription_id: activeSubscription.razorpay_subscription_id,
        },
        { status: 409 },
      );
    }
  }

  // --------------------------------------------------------------------------
  // A past_due subscription represents an unresolved payment state.
  // Do not create another subscription automatically.
  // --------------------------------------------------------------------------

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

  // --------------------------------------------------------------------------
  // A created subscription may simply be an abandoned Checkout.
  // Check Razorpay directly before blocking a new attempt.
  // --------------------------------------------------------------------------

  if (createdSubscription) {
    let providerSubscription;

    try {
      providerSubscription = await rzp.subscriptions.fetch(
        createdSubscription.razorpay_subscription_id,
      );
    } catch (e) {
      return NextResponse.json(
        {
          error:
            `Unable to check your existing Razorpay subscription: ` +
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
    } else if (
      providerSubscription.status === "active" ||
      providerSubscription.status === "authenticated"
    ) {
      return NextResponse.json(
        {
          error:
            "You already have a subscription that has been authorised or activated.",
          subscription_id: providerSubscription.id,
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

  // --------------------------------------------------------------------------
  // Create the Razorpay subscription.
  //
  // IMPORTANT:
  // Do NOT create a Razorpay customer here.
  //
  // Razorpay creates/associates the customer during the subscription
  // authorization Checkout flow.
  // --------------------------------------------------------------------------

  let subscription;

  try {
    subscription = await rzp.subscriptions.create({
      plan_id: plan.razorpay_plan_id,

      total_count: 12,

      quantity: 1,

      customer_notify: 1,

      // Limit the authorisation window so abandoned subscriptions do not
      // remain in the "created" state indefinitely at Razorpay.
      expire_by: Math.floor(Date.now() / 1000) + 30 * 60,

      notes: {
        forensique_user_id: user.id,

        forensique_plan_id: plan.id,
      },
    });
  } catch (e) {
    const description =
      e?.error?.description ||
      e?.description ||
      e?.message ||
      "Unknown Razorpay error.";

    return NextResponse.json(
      {
        error: `Razorpay subscription error: ${description}`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // Save the newly-created subscription in Supabase.
  //
  // The Razorpay subscription is initially "created".
  // Webhooks will later update it to active/pending/etc.
  // --------------------------------------------------------------------------

  const now = new Date();

  const expireBy = subscription.expire_by;

  const authorizationExpiry = new Date(
    (expireBy || Math.floor(Date.now() / 1000) + 30 * 60) * 1000,
  );

  const { error: subscriptionRowError } = await admin
    .from("subscriptions")
    .insert({
      user_id: user.id,

      plan_id: plan.id,

      // Razorpay associates the customer after
      // the authorization transaction.
      razorpay_customer_id: subscription.customer_id || null,

      razorpay_subscription_id: subscription.id,

      status: "created",

      started_at: now.toISOString(),

      expires_at: authorizationExpiry.toISOString(),
    });

  if (subscriptionRowError) {
    // We created the Razorpay subscription but failed
    // to persist our local record. Try to cancel the
    // orphaned Razorpay subscription immediately.
    try {
      await rzp.subscriptions.cancel(subscription.id, {
        cancel_at_cycle_end: false,
      });
    } catch (cleanupError) {
      console.error(
        "Failed to clean up orphaned Razorpay subscription:",
        cleanupError,
      );
    }

    return NextResponse.json(
      {
        error: `Subscription record could not be saved: ${subscriptionRowError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    subscription_id: subscription.id,

    razorpay_key_id: process.env.RAZORPAY_KEY_ID,
  });
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
        error: "Missing Razorpay verification parameters.",
      },
      { status: 400 },
    );
  }

  // --------------------------------------------------------------------------
  // First make sure this subscription belongs to the logged-in user.
  // --------------------------------------------------------------------------

  const { data: localSubscription, error: subscriptionLookupError } =
    await admin
      .from("subscriptions")
      .select(
        `
        id,
        user_id,
        plan_id,
        razorpay_subscription_id,
        status,
        expires_at
      `,
      )
      .eq("razorpay_subscription_id", razorpay_subscription_id)
      .maybeSingle();

  if (subscriptionLookupError) {
    return NextResponse.json(
      {
        error: `Unable to find subscription: ${subscriptionLookupError.message}`,
      },
      { status: 500 },
    );
  }

  if (!localSubscription) {
    return NextResponse.json(
      {
        error: "Subscription was not found in our database.",
      },
      { status: 404 },
    );
  }

  if (localSubscription.user_id !== user.id) {
    return NextResponse.json(
      {
        error: "This subscription does not belong to the current user.",
      },
      { status: 403 },
    );
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

  const secret = process.env.RAZORPAY_KEY_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error: "Razorpay is not configured on the server.",
      },
      { status: 500 },
    );
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest("hex");

  const expectedBuffer = Buffer.from(expected);

  const receivedBuffer = Buffer.from(razorpay_signature);

  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "Razorpay signature verification failed.",
      },
      { status: 400 },
    );
  }

  // --------------------------------------------------------------------------
  // Fetch the subscription directly from Razorpay.
  //
  // This prevents us from blindly trusting the status supplied by the
  // browser callback.
  // --------------------------------------------------------------------------

  let providerSubscription;

  try {
    const rzp = getRazorpay();

    providerSubscription = await rzp.subscriptions.fetch(
      razorpay_subscription_id,
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: `Unable to verify Razorpay subscription: ${
          e?.error?.description || e?.message || "Unknown Razorpay error."
        }`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // Make sure the provider subscription is actually for the plan we sold.
  // --------------------------------------------------------------------------

  const { data: localPlan, error: planLookupError } = await admin
    .from("plans")
    .select("id, name, razorpay_plan_id")
    .eq("id", localSubscription.plan_id)
    .maybeSingle();

  if (planLookupError) {
    return NextResponse.json(
      {
        error: `Unable to verify plan: ${planLookupError.message}`,
      },
      { status: 500 },
    );
  }

  if (
    !localPlan ||
    localPlan.razorpay_plan_id !== providerSubscription.plan_id
  ) {
    return NextResponse.json(
      {
        error: "Razorpay subscription does not match the selected plan.",
      },
      { status: 400 },
    );
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

  let nextStatus = "created";

  if (providerSubscription.status === "active") {
    nextStatus = "active";
  } else if (providerSubscription.status === "pending") {
    nextStatus = "past_due";
  } else if (providerSubscription.status === "halted") {
    nextStatus = "past_due";
  } else if (providerSubscription.status === "cancelled") {
    nextStatus = "cancelled";
  } else if (providerSubscription.status === "completed") {
    nextStatus = "expired";
  } else if (providerSubscription.status === "expired") {
    nextStatus = "expired";
  }

  const patch = {
    status: nextStatus,

    updated_at: new Date().toISOString(),
  };

  if (providerSubscription.customer_id) {
    patch.razorpay_customer_id = providerSubscription.customer_id;
  }

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
    .eq("id", localSubscription.id)
    .eq("user_id", user.id);

  if (updateError) {
    return NextResponse.json(
      {
        error: `Payment was verified but the subscription could not be updated: ${updateError.message}`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    status: nextStatus,
  });
}

// ----------------------------------------------------------------------------
// POST /api/billing/cancel
// ----------------------------------------------------------------------------

async function handleCancel(request) {
  const user = await getUserFromRequest(request);

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const admin = getSupabaseAdmin();

  const { razorpay_subscription_id } = await request.json();

  if (!razorpay_subscription_id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const { data: sub } = await admin
    .from("subscriptions")
    .select("*")
    .eq("razorpay_subscription_id", razorpay_subscription_id)
    .maybeSingle();

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
// Cancels an uncompleted Razorpay subscription when Checkout is dismissed.
// Only subscriptions still in Razorpay's "created" state are cancelled.
// Authorised/active subscriptions are never cancelled by this endpoint.
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

  // --------------------------------------------------------------------------
  // Verify that the subscription belongs to the logged-in user.
  // --------------------------------------------------------------------------

  const { data: sub, error: subLookupError } = await admin
    .from("subscriptions")
    .select("id, user_id, razorpay_subscription_id, status")
    .eq("razorpay_subscription_id", razorpay_subscription_id)
    .maybeSingle();

  if (subLookupError) {
    return NextResponse.json(
      {
        error: `Unable to find subscription: ${subLookupError.message}`,
      },
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

  // --------------------------------------------------------------------------
  // If our local state is no longer "created", do not use this endpoint to
  // cancel it. Normal active/past_due lifecycle handling remains separate.
  // --------------------------------------------------------------------------

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
          `Unable to check Razorpay subscription: ` +
          `${e?.error?.description || e?.message || "Unknown Razorpay error."}`,
      },
      { status: 500 },
    );
  }

  // --------------------------------------------------------------------------
  // Never cancel a subscription that has already been authorised or activated.
  // Razorpay can remain "created" locally for a short time after successful
  // authorisation, so the provider state is authoritative here.
  // --------------------------------------------------------------------------

  if (
    providerSubscription.status === "authenticated" ||
    providerSubscription.status === "active"
  ) {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status: providerSubscription.status,
    });
  }

  if (
    providerSubscription.status === "cancelled" ||
    providerSubscription.status === "expired"
  ) {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status: providerSubscription.status,
    });
  }

  // --------------------------------------------------------------------------
  // Only an actually-created, unauthorised subscription is cancelled here.
  // --------------------------------------------------------------------------

  if (providerSubscription.status !== "created") {
    return NextResponse.json({
      ok: true,
      cancelled: false,
      status: providerSubscription.status,
    });
  }

  try {
    const rzp = getRazorpay();

    await rzp.subscriptions.cancel(razorpay_subscription_id, {
      cancel_at_cycle_end: false,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          `Razorpay cancellation failed: ` +
          `${e?.error?.description || e?.message || "Unknown Razorpay error."}`,
      },
      { status: 500 },
    );
  }

  // The Razorpay subscription.cancelled webhook remains the authoritative
  // lifecycle update for the local subscription row.

  return NextResponse.json({
    ok: true,
    cancelled: true,
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