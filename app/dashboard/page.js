"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import SiteHeader from "@/components/site-header";
import SiteFooter from "@/components/site-footer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  PlayCircle,
  RotateCw,
  ClipboardCheck,
  Upload,
  Sparkles,
  IndianRupee,
  XCircle,
  CheckCircle2,
  Trash2,
  Clock3,
  CalendarDays,
  CircleX,
  Circle,
  RotateCcw,
} from "lucide-react";

function formatAttemptDate(dateValue) {
  if (!dateValue) return "—";

  const date = new Date(dateValue);

  return {
    date: date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-IN", {
      hour: "numeric",
      minute: "2-digit",
    }),
  };
}

/*
 * NEW: Extract the actual exam date from the test ID/title.
 *
 * Examples:
 *   UGC_NET_FS_2025_06 -> June 2025
 *   UGC_NET_FS_2024_12 -> December 2024
 *   UGC_NET_FS_2013_09 -> September 2013
 *
 * The returned value is YYYYMM, which makes chronological
 * comparison straightforward.
 */
function getTestExamDate(test) {
  const testId = String(test?.test_id || "");
  const title = String(test?.title || "");

  const idMatch = testId.match(/(?:^|_)(\d{4})_(\d{1,2})(?:_|$)/);

  if (idMatch) {
    const year = Number(idMatch[1]);
    const month = Number(idMatch[2]);

    if (month >= 1 && month <= 12) {
      return year * 100 + month;
    }
  }

  const monthNames = {
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };

  const titleMatch = title.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b\D*(\d{4})\b/i,
  );

  if (titleMatch) {
    const month = monthNames[titleMatch[1].toLowerCase()];
    const year = Number(titleMatch[2]);

    return year * 100 + month;
  }

  return null;
}

/*
 * NEW: Sort Available Tests by actual exam date, newest first.
 *
 * If the exam date cannot be determined, created_at remains the
 * fallback ordering, preserving the original database ordering
 * behavior for those tests.
 */
function sortTestsNewestFirst(tests) {
  return [...tests].sort((a, b) => {
    const aExamDate = getTestExamDate(a);
    const bExamDate = getTestExamDate(b);

    if (aExamDate != null && bExamDate == null) {
      return -1;
    }

    if (aExamDate == null && bExamDate != null) {
      return 1;
    }

    if (aExamDate != null && bExamDate != null) {
      if (aExamDate !== bExamDate) {
        return bExamDate - aExamDate;
      }
    }

    const aCreated = a?.created_at
      ? new Date(a.created_at).getTime()
      : 0;

    const bCreated = b?.created_at
      ? new Date(b.created_at).getTime()
      : 0;

    return bCreated - aCreated;
  });
}

function getAccuracy(correct, incorrect) {
  const attempted = correct + incorrect;

  if (attempted === 0) return 0;

  return Math.round((correct / attempted) * 100);
}

function getCurrentSubscription(subscriptions) {
  const now = Date.now();

  return (
    (subscriptions || [])
      .filter((sub) => {
        if (sub.status !== "active") return false;
        if (!sub.expires_at) return false;

        return new Date(sub.expires_at).getTime() > now;
      })
      .sort(
        (a, b) =>
          new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime(),
      )[0] || null
  );
}

function AttemptStat({ icon: Icon, value, label, className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Icon className="h-4 w-4 shrink-0" />
      <span className="font-medium tabular-nums">{value}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

function DeleteConfirmation({ test, deleting, onCancel, onConfirm }) {
  if (!test) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-[2px]">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <Trash2 className="h-5 w-5 text-destructive" />
            </div>

            <div className="min-w-0">
              <CardTitle className="text-base">Delete custom test?</CardTitle>
              <CardDescription className="mt-1">
                This action cannot be undone.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="font-medium text-sm break-words">{test.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {test.total_questions} questions · {test.duration_minutes} min
            </p>
          </div>

          <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
            Deleting this custom test will permanently remove the test and its
            attempt history.
          </p>

          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={deleting}
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              disabled={deleting}
              className="gap-2"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {deleting ? "Deleting…" : "Delete test"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function DashboardInner() {
  const supabase = getSupabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tests, setTests] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [subscription, setSubscription] = useState(null);

  const [starting, setStarting] = useState(null);

  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelResult, setCancelResult] = useState(null);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  const showUpgraded = params.get("upgraded") === "1";

  useEffect(() => {
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          router.replace("/auth");
          return;
        }

        setUser(user);

        const [{ data: prof }, { data: ts }, { data: at }, { data: subs }] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("*")
              .eq("id", user.id)
              .maybeSingle(),

            supabase
              .from("tests")
              .select(
                "id, test_id, title, test_type, total_questions, duration_minutes, marks_per_question, is_premium, is_user_generated, created_by, status, created_at",
              )
              .eq("status", "published")
              .or(`is_user_generated.eq.false,created_by.eq.${user.id}`)
              .order("created_at", { ascending: false }),

            supabase
              .from("test_attempts")
              .select(
                `
                id,
                status,
                started_at,
                submitted_at,
                score,
                correct_count,
                incorrect_count,
                unattempted_count,
                time_taken_seconds,
                test_id,
                tests(
                  id,
                  title,
                  total_questions,
                  duration_minutes,
                  marks_per_question,
                  test_type,
                  is_user_generated,
                  created_by
                )
              `,
              )
              .eq("user_id", user.id)
              .order("started_at", { ascending: false })
              .limit(20),

            supabase
              .from("subscriptions")
              .select("*, plans(name, price_paise, features)")
              .eq("user_id", user.id)
              .in("status", ["active", "past_due"])
              .order("created_at", { ascending: false }),
          ]);

        setProfile(prof);

        // ONLY NEW BEHAVIOR:
        // Sort the already-authorized tests by actual exam date.
        setTests(sortTestsNewestFirst(ts || []));

        setAttempts(at || []);
        setSubscription(getCurrentSubscription(subs));
      } catch (error) {
        console.error("Dashboard loading failed:", error);
      } finally {
        setLoading(false);
      }
    })();
  }, [supabase, router]);

  async function startAttempt(testId) {
    setStarting(testId);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Your session has expired. Please sign in again.");
      }

      const res = await fetch("/api/attempt/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ test_id: testId }),
      });

      const j = await res.json();

      if (!res.ok) {
        throw new Error(j.error || "Failed to start attempt");
      }

      router.push(`/attempt/${j.attempt_id}`);
    } catch (e) {
      console.error(e);
      window.alert(e.message || "Failed to start attempt");
      setStarting(null);
    }
  }

  async function deleteCustomTest() {
    if (!deleteTarget || !user) return;

    setDeleteBusy(true);
    setDeleteError(null);

    try {
      /*
       * The RLS policy on public.tests is the final authorization layer.
       * These filters also make the intent explicit on the client:
       * - custom test
       * - user generated
       * - created by the current user
       */
      const { error } = await supabase
        .from("tests")
        .delete()
        .eq("id", deleteTarget.id)
        .eq("test_type", "custom")
        .eq("is_user_generated", true)
        .eq("created_by", user.id);

      if (error) {
        throw error;
      }

      /*
       * Remove the test from the UI immediately.
       */
      setTests((current) =>
        current.filter((test) => test.id !== deleteTarget.id),
      );

      /*
       * Because test_attempts now uses ON DELETE CASCADE,
       * associated attempt rows are removed by PostgreSQL as well.
       * Removing them locally keeps the dashboard immediately consistent.
       */
      setAttempts((current) =>
        current.filter((attempt) => attempt.test_id !== deleteTarget.id),
      );

      setDeleteTarget(null);
    } catch (error) {
      console.error("Delete custom test failed:", error);

      setDeleteError(error.message || "Failed to delete the custom test.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function cancelSubscription() {
    if (!subscription?.razorpay_subscription_id) return;

    if (
      !window.confirm(
        "Cancel your subscription at the end of the current billing cycle? You keep access until then.",
      )
    ) {
      return;
    }

    setCancelBusy(true);
    setCancelResult(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      const res = await fetch("/api/billing/cancel", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          razorpay_subscription_id: subscription.razorpay_subscription_id,
        }),
      });

      const j = await res.json();

      if (!res.ok) {
        throw new Error(j.error || "Cancel failed");
      }

      setCancelResult({ ok: true });

      const { data: subs } = await supabase
        .from("subscriptions")
        .select("*, plans(name, price_paise, features)")
        .eq("user_id", user.id)
        .in("status", ["active", "past_due"])
        .order("created_at", { ascending: false });

      setSubscription(getCurrentSubscription(subs));
    } catch (e) {
      setCancelResult({
        ok: false,
        error: e.message,
      });
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) {
    return (
      <>
        <SiteHeader />

        <div className="p-16 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading dashboard…
        </div>
      </>
    );
  }

  const inProgress = attempts.filter(
    (attempt) => attempt.status === "in_progress" && attempt.tests,
  );

  /*
   * IMPORTANT:
   * Only display submitted attempts whose parent test still exists.
   *
   * This prevents old/orphaned custom-test attempts from appearing in
   * Recent Attempts even if there is stale data somewhere.
   */
  const submitted = attempts.filter(
    (attempt) => attempt.status !== "in_progress" && attempt.tests,
  );

  const isSubActive =
    subscription &&
    subscription.status === "active" &&
    new Date(subscription.expires_at) > new Date();

  // Only plans with the `tests` entitlement unlock premium tests and the
  // custom-test builder. Notes-only subscriptions must not unlock test content.
  const isTestEntitled =
    profile?.role === "admin" ||
    (subscription &&
      subscription.status === "active" &&
      new Date(subscription.expires_at) > new Date() &&
      subscription.plans?.features?.tests === true);

  return (
    <>
      <SiteHeader />

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex justify-between items-start mb-6 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">
              Welcome back
              {profile?.full_name ? `, ${profile.full_name.split(" ")[0]}` : ""}
              .
            </h1>

            <p className="text-sm text-muted-foreground">
              UGC NET/JRF Forensic Science Paper II
            </p>
          </div>

          {profile?.role === "admin" && (
            <Link href="/admin/import">
              <Button variant="outline" size="sm" className="gap-2">
                <Upload className="h-4 w-4" />
                Admin
              </Button>
            </Link>
          )}
        </div>

        {showUpgraded && (
          <Alert className="mb-6 border-emerald-500">
            <AlertDescription>
              Payment received. Your Test Series subscription is being activated
              — refresh in a few seconds if it doesn&apos;t show here yet.
            </AlertDescription>
          </Alert>
        )}

        {deleteError && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription className="flex items-center justify-between gap-4">
              <span>{deleteError}</span>

              <button
                type="button"
                onClick={() => setDeleteError(null)}
                className="shrink-0 opacity-70 hover:opacity-100"
                aria-label="Dismiss error"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </AlertDescription>
          </Alert>
        )}

        {/* SUBSCRIPTION CARD */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <IndianRupee className="h-4 w-4" />
              Subscription
            </CardTitle>
          </CardHeader>

          <CardContent>
            {!subscription ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Free tier</div>

                  <p className="text-xs text-muted-foreground">
                    Access to the free UGC NET FS June 2025 paper. Subscribe to
                    unlock all previous-year papers, the custom test builder,
                    and analytics.
                  </p>
                </div>

                <Link href="/pricing">
                  <Button size="sm">See plans</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap justify-between items-start gap-3">
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      {subscription.plans?.name}

                      {isSubActive ? (
                        <Badge className="bg-emerald-600 text-white">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="outline">{subscription.status}</Badge>
                      )}

                      {subscription.cancel_at_period_end && (
                        <Badge variant="outline">Cancels at cycle end</Badge>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground mt-1">
                      ₹
                      {Math.round((subscription.plans?.price_paise ?? 0) / 100)}
                      /month · Renews / expires{" "}
                      {new Date(subscription.expires_at).toLocaleDateString()}
                    </p>
                  </div>

                  {isSubActive && !subscription.cancel_at_period_end && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancelSubscription}
                      disabled={cancelBusy}
                      className="gap-1"
                    >
                      {cancelBusy ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <XCircle className="h-4 w-4" />
                      )}
                      Cancel subscription
                    </Button>
                  )}
                </div>

                {subscription.cancel_at_period_end && (
                  <Alert>
                    <AlertDescription>
                      Your subscription will end on{" "}
                      {new Date(subscription.expires_at).toLocaleDateString()}.
                      No further debits will occur. Resubscribe anytime from the
                      pricing page.
                    </AlertDescription>
                  </Alert>
                )}

                {cancelResult?.ok && (
                  <Alert className="border-emerald-500">
                    <AlertDescription>
                      Cancellation scheduled. You keep access until{" "}
                      {new Date(subscription.expires_at).toLocaleDateString()}.
                    </AlertDescription>
                  </Alert>
                )}

                {cancelResult?.ok === false && (
                  <Alert variant="destructive">
                    <AlertDescription>{cancelResult.error}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* CONTINUE WHERE YOU LEFT OFF */}
        {inProgress.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Continue where you left off
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              {inProgress.map((attempt) => (
                <Card key={attempt.id}>
                  <CardContent className="pt-6 flex justify-between items-center gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {attempt.tests?.title}
                      </div>

                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                        <Clock3 className="h-3.5 w-3.5" />
                        Started{" "}
                        {new Date(attempt.started_at).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>

                    <Link href={`/attempt/${attempt.id}`}>
                      <Button size="sm" className="gap-1 shrink-0">
                        <RotateCw className="h-4 w-4" />
                        Resume
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* AVAILABLE TESTS */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Available tests
            </h2>

            {isTestEntitled ? (
              <Link
                href="/custom-test"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" />
                Build a custom test
              </Link>
            ) : (
              <Link
                href="/pricing"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1"
              >
                <Sparkles className="h-3 w-3" />
                Custom test · Premium
              </Link>
            )}
          </div>

          {tests.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-center text-sm text-muted-foreground">
                No tests published yet.
                {profile?.role === "admin" ? (
                  <>
                    {" "}
                    Head to{" "}
                    <Link
                      className="underline text-primary"
                      href="/admin/import"
                    >
                      Admin → Import
                    </Link>{" "}
                    to import the sample UGC NET FS 2025 June paper.
                  </>
                ) : (
                  " Check back soon."
                )}
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {tests.map((test) => {
                const isAdmin = profile?.role === "admin";

                const gated = test.is_premium && !isTestEntitled;

                const isOwnCustomTest =
                  test.is_user_generated === true &&
                  test.test_type === "custom" &&
                  test.created_by === user?.id;

                return (
                  <Card key={test.id} className={gated ? "opacity-70" : ""}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <CardTitle className="text-base">
                            {test.title}
                          </CardTitle>

                          <CardDescription>
                            {test.total_questions} questions ·{" "}
                            {test.duration_minutes} min ·{" "}
                            {test.test_type.replace("_", " ")}
                          </CardDescription>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {!test.is_premium && (
                            <Badge variant="secondary">Free</Badge>
                          )}

                          {test.is_premium && !isSubActive && (
                            <Badge variant="outline">Premium</Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>

                    <CardContent>
                      <div className="flex gap-2">
                        {gated ? (
                          <Link href="/pricing" className="flex-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full"
                            >
                              Subscribe to unlock
                            </Button>
                          </Link>
                        ) : (
                          <Button
                            size="sm"
                            onClick={() => startAttempt(test.id)}
                            disabled={starting === test.id}
                            className="gap-2 flex-1"
                          >
                            {starting === test.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <PlayCircle className="h-4 w-4" />
                            )}
                            Start attempt
                          </Button>
                        )}

                        {isOwnCustomTest && (
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            onClick={() => {
                              setDeleteError(null);
                              setDeleteTarget(test);
                            }}
                            className="gap-2"
                            aria-label={`Delete ${test.title}`}
                            title="Delete custom test"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="hidden sm:inline">Delete</span>
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* RECENT ATTEMPTS */}
        {submitted.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                  Recent attempts
                </h2>

                <p className="text-xs text-muted-foreground mt-1">
                  Your latest completed test attempts
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {submitted.map((attempt) => {
                const correct = Number(attempt.correct_count ?? 0);

                const incorrect = Number(attempt.incorrect_count ?? 0);

                const unattempted = Number(attempt.unattempted_count ?? 0);

                const accuracy = getAccuracy(correct, incorrect);

                const totalQuestions = Number(
                  attempt.tests?.total_questions ?? 0,
                );

                const marksPerQuestion = Number(
                  attempt.tests?.marks_per_question ?? 2,
                );

                const maxScore = totalQuestions * marksPerQuestion;

                const score = Number(attempt.score ?? 0);

                const dateTime = formatAttemptDate(
                  attempt.submitted_at || attempt.started_at,
                );

                const isCustom =
                  attempt.tests?.is_user_generated === true ||
                  attempt.tests?.test_type === "custom";

                return (
                  <Card
                    key={attempt.id}
                    className="overflow-hidden transition-shadow hover:shadow-sm"
                  >
                    <CardContent className="p-0">
                      <div className="p-5">
                        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                          {/* LEFT SIDE */}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-semibold text-base leading-snug">
                                {attempt.tests?.title}
                              </h3>

                              {isCustom && (
                                <Badge
                                  variant="secondary"
                                  className="text-[11px]"
                                >
                                  Custom
                                </Badge>
                              )}
                            </div>

                            {/* DATE / TIME */}
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {dateTime.date}
                              </span>

                              <span className="inline-flex items-center gap-1.5">
                                <Clock3 className="h-3.5 w-3.5" />
                                {dateTime.time}
                              </span>

                              {attempt.time_taken_seconds != null && (
                                <span>
                                  Time taken:{" "}
                                  {Math.floor(
                                    Number(attempt.time_taken_seconds) / 60,
                                  )}
                                  min
                                </span>
                              )}
                            </div>

                            {/* PERFORMANCE STATS */}
                            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
                              <AttemptStat
                                icon={CheckCircle2}
                                value={correct}
                                label="Correct"
                                className="text-emerald-600"
                              />

                              <AttemptStat
                                icon={CircleX}
                                value={incorrect}
                                label="Incorrect"
                                className="text-rose-600"
                              />

                              <AttemptStat
                                icon={Circle}
                                value={unattempted}
                                label="Unattempted"
                                className="text-muted-foreground"
                              />

                              <div className="h-4 w-px bg-border hidden sm:block" />

                              <div className="text-sm">
                                <span className="font-medium">{accuracy}%</span>{" "}
                                <span className="text-muted-foreground">
                                  Accuracy
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* SCORE + ACTIONS */}
                          <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-4 shrink-0">
                            <div className="lg:text-right">
                              <div className="text-xs text-muted-foreground mb-0.5">
                                Score
                              </div>

                              <div className="text-2xl font-bold tracking-tight tabular-nums">
                                {score}{" "}
                                <span className="text-sm font-medium text-muted-foreground">
                                  / {maxScore}
                                </span>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-2">
                              <Link href={`/results/${attempt.id}`}>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5"
                                >
                                  <ClipboardCheck className="h-4 w-4" />
                                  View solutions
                                </Button>
                              </Link>

                              {attempt.tests?.id && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5"
                                  onClick={() => startAttempt(attempt.test_id)}
                                  disabled={starting === attempt.test_id}
                                >
                                  {starting === attempt.test_id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <RotateCcw className="h-4 w-4" />
                                  )}
                                  Retake
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <SiteFooter />

      <DeleteConfirmation
        test={deleteTarget}
        deleting={deleteBusy}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteTarget(null);
          }
        }}
        onConfirm={deleteCustomTest}
      />
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="p-16 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading dashboard…
        </div>
      }
    >
      <DashboardInner />
    </Suspense>
  );
}