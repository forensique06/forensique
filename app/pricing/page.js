"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { getSupabaseBrowser } from "@/lib/supabase/browser";
import SiteHeader from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Loader2 } from "lucide-react";

const PLAN_ORDER = [
  "Test Series",
  "Test Series - 3 Months",
  "Notes",
  "Combined",
];

const FEATURES_TABLE = [
  {
    name: "Full-length previous-year tests (CBT)",
    keys: {
      free: false,
      ts: true,
      nt: false,
      cb: true,
    },
  },
  {
    name: "Custom test builder (unit/topic/difficulty)",
    keys: {
      free: false,
      ts: true,
      nt: false,
      cb: true,
    },
  },
  {
    name: "Solution review with explanations",
    keys: {
      free: "partial",
      ts: true,
      nt: false,
      cb: true,
    },
  },
  {
    name: "Post-test analytics dashboard",
    keys: {
      free: false,
      ts: true,
      nt: false,
      cb: true,
    },
  },
  {
    name: "Bookmarks & practice mode",
    keys: {
      free: false,
      ts: true,
      nt: false,
      cb: true,
    },
  },
  {
    name: "Unit-wise notes (all 10 units)",
    keys: {
      free: "summary",
      ts: false,
      nt: true,
      cb: true,
    },
  },
  {
    name: "Free-trial paper (partial access)",
    keys: {
      free: true,
      ts: true,
      nt: true,
      cb: true,
    },
  },
];

export default function PricingPage() {
  const supabase = getSupabaseBrowser();

  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [razorpayLoaded, setRazorpayLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data: planData, error: planError } = await supabase
          .from("plans")
          .select("*")
          .eq("is_active", true)
          .order("sort_order");

        if (planError) {
          throw planError;
        }

        const {
          data: { user: currentUser },
        } = await supabase.auth.getUser();

        if (!mounted) return;

        setPlans(planData || []);
        setUser(currentUser || null);

        if (currentUser) {
          const { data: subs } = await supabase
            .from("subscriptions")
            .select("*, plans(name, price_paise, features, billing_type)")
            .eq("user_id", currentUser.id)
            .eq("status", "active")
            .order("expires_at", { ascending: false });

          const now = new Date();

          const validSubscription =
            (subs || []).find((sub) => {
              if (!sub.expires_at) return false;

              return new Date(sub.expires_at) > now;
            }) || null;

          setSubscription(validSubscription);
        }
      } catch (e) {
        if (mounted) {
          setError(e?.message || "Unable to load pricing information.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [supabase]);

  async function startCheckout(planId) {
    if (!user) {
      window.location.href = "/auth?mode=signup&next=/pricing";
      return;
    }

    if (subscription) {
      setError(
        "You already have active access. A new plan can be purchased after the current access period ends.",
      );
      return;
    }

    if (!razorpayLoaded || !window.Razorpay) {
      setError(
        "Razorpay Checkout is still loading. Please try again in a moment.",
      );
      return;
    }

    if (busy) return;

    setBusy(true);
    setError(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error(
          "Your login session has expired. Please sign in again.",
        );
      }

      const selectedPlan = plans.find((plan) => plan.id === planId);

      if (!selectedPlan) {
        throw new Error("Selected plan could not be found.");
      }

      if (selectedPlan.billing_type === "one_time") {
        const res = await fetch("/api/billing/create-order", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            plan_id: planId,
          }),
        });

        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Unable to create payment order.");
        }

        if (json.already_paid && json.subscription_id) {
          window.location.href = "/dashboard?upgraded=1";

          return;
        }

        if (!json.order_id || !json.razorpay_key_id) {
          throw new Error(
            "Server returned incomplete Razorpay Order checkout data.",
          );
        }

        openOneTimeRazorpay(json.order_id, json.razorpay_key_id, selectedPlan);

        return;
      }

      const res = await fetch("/api/billing/create-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          plan_id: planId,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Unable to create subscription.");
      }

      if (!json.subscription_id || !json.razorpay_key_id) {
        throw new Error("Server returned incomplete Razorpay checkout data.");
      }

      openRazorpay(json.subscription_id, json.razorpay_key_id, selectedPlan);
    } catch (e) {
      console.error("Checkout initialization failed:", e);

      setError(e?.message || "Unable to start payment.");

      setBusy(false);
    }
  }

  function openRazorpay(subscriptionId, keyId, plan) {
    if (!keyId || !subscriptionId) {
      throw new Error("Razorpay checkout data is incomplete.");
    }

    if (!window.Razorpay) {
      throw new Error(
        "Razorpay Checkout has not loaded yet. Please try again.",
      );
    }

    let checkoutCompleted = false;

    const price = Math.round(Number(plan.price_paise || 0) / 100);

    const rzp = new window.Razorpay({
      key: keyId,

      subscription_id: subscriptionId,

      name: "Forensique",

      description: `${plan.name} — ₹${price}/month`,

      prefill: {
        email: user?.email || "",
      },

      theme: {
        color: "#0f172a",
      },

      handler: async (response) => {
        checkoutCompleted = true;

        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            throw new Error(
              "Your login session has expired. Please sign in again.",
            );
          }

          const {
            razorpay_payment_id,
            razorpay_subscription_id,
            razorpay_signature,
          } = response || {};

          if (
            !razorpay_payment_id ||
            !razorpay_subscription_id ||
            !razorpay_signature
          ) {
            throw new Error(
              "Razorpay returned incomplete payment verification data.",
            );
          }

          const verifyRes = await fetch("/api/billing/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              razorpay_payment_id,
              razorpay_subscription_id,
              razorpay_signature,
            }),
          });

          const verifyJson = await verifyRes.json();

          if (!verifyRes.ok) {
            throw new Error(verifyJson.error || "Payment verification failed.");
          }

          window.location.href = "/dashboard?upgraded=1";
        } catch (e) {
          console.error("Payment verification failed:", e);

          setError(e?.message || "Payment verification failed.");

          setBusy(false);
        }
      },

      modal: {
        ondismiss: async () => {
          if (checkoutCompleted) {
            setBusy(false);
            return;
          }

          try {
            const {
              data: { session },
            } = await supabase.auth.getSession();

            if (!session?.access_token) {
              console.warn(
                "Checkout dismissed, but the user session is unavailable. " +
                  "The Razorpay subscription will rely on expire_by.",
              );

              return;
            }

            const cancelRes = await fetch("/api/billing/cancel-pending", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${session.access_token}`,
              },
              body: JSON.stringify({
                razorpay_subscription_id: subscriptionId,
              }),
            });

            const cancelJson = await cancelRes.json();

            if (!cancelRes.ok) {
              console.error(
                "Unable to release abandoned Razorpay subscription:",
                cancelJson,
              );
            }
          } catch (e) {
            console.error(
              "Failed to release abandoned Razorpay subscription:",
              e,
            );
          } finally {
            setBusy(false);
          }
        },
      },
    });

    rzp.on("payment.failed", (response) => {
      console.error("Razorpay payment failed:", response);

      const description =
        response?.error?.description ||
        response?.error?.reason ||
        "Razorpay payment failed.";

      setError(description);
      setBusy(false);
    });

    rzp.open();
  }
  function openOneTimeRazorpay(orderId, keyId, plan) {
    if (!keyId || !orderId) {
      throw new Error("Razorpay Order checkout data is incomplete.");
    }

    if (!window.Razorpay) {
      throw new Error(
        "Razorpay Checkout has not loaded yet. Please try again.",
      );
    }

    let checkoutCompleted = false;

    const price = Math.round(Number(plan.price_paise || 0) / 100);

    const rzp = new window.Razorpay({
      key: keyId,

      order_id: orderId,

      name: "Forensique",

      description: `${plan.name} — ₹${price} one-time`,

      prefill: {
        email: user?.email || "",
      },

      theme: {
        color: "#0f172a",
      },

      handler: async (response) => {
        checkoutCompleted = true;

        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (!session?.access_token) {
            throw new Error(
              "Your login session has expired. Please sign in again.",
            );
          }

          const { razorpay_payment_id, razorpay_order_id, razorpay_signature } =
            response || {};

          if (
            !razorpay_payment_id ||
            !razorpay_order_id ||
            !razorpay_signature
          ) {
            throw new Error(
              "Razorpay returned incomplete payment verification data.",
            );
          }

          const verifyRes = await fetch("/api/billing/verify-order", {
            method: "POST",

            headers: {
              "Content-Type": "application/json",

              Authorization: `Bearer ${session.access_token}`,
            },

            body: JSON.stringify({
              razorpay_payment_id,
              razorpay_order_id,
              razorpay_signature,
            }),
          });

          const verifyJson = await verifyRes.json();

          if (!verifyRes.ok) {
            throw new Error(verifyJson.error || "Payment verification failed.");
          }

          window.location.href = "/dashboard?upgraded=1";
        } catch (e) {
          console.error("One-time payment verification failed:", e);

          setError(e?.message || "Payment verification failed.");

          setBusy(false);
        }
      },

      modal: {
        ondismiss: () => {
          if (checkoutCompleted) {
            setBusy(false);
            return;
          }

          /*
           * Do NOT call /billing/cancel-pending.
           *
           * The one-time Order is deliberately reusable.
           */
          setBusy(false);
        },
      },
    });

    rzp.on("payment.failed", (response) => {
      console.error("Razorpay one-time payment failed:", response);

      const description =
        response?.error?.description ||
        response?.error?.reason ||
        "Razorpay payment failed.";

      setError(description);

      setBusy(false);
    });

    rzp.open();
  }

  return (
    <div className="min-h-screen">
      <Script
        src="https://checkout.razorpay.com/v1/checkout.js"
        strategy="afterInteractive"
        onLoad={() => {
          setRazorpayLoaded(true);
        }}
        onError={() => {
          setRazorpayLoaded(false);
          setError("Unable to load Razorpay Checkout.");
        }}
      />

      <SiteHeader />

      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <div className="text-center mb-10">
          <Badge variant="secondary">Monthly or one-time access</Badge>

          <h1 className="text-4xl font-bold mt-3">Pricing</h1>

          <p className="text-muted-foreground mt-2">
            Choose a recurring monthly plan or a one-time 3-month access plan.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 mb-12">
              {PLAN_ORDER.map((planName) => {
                const plan = plans.find((p) => p.name === planName);

                if (!plan) return null;

                const isTS = plan.name === "Test Series";

                const isThreeMonth = plan.name === "Test Series - 3 Months";

                const price = (Number(plan.price_paise || 0) / 100).toFixed(0);

                return (
                  <Card
                    key={plan.id}
                    className={isTS ? "ring-2 ring-primary" : ""}
                  >
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-xl">{plan.name}</CardTitle>

                        {isTS ? (
                          <Badge>Most popular</Badge>
                        ) : isThreeMonth ? (
                          <Badge>3-month offer</Badge>
                        ) : (
                          <Badge variant="outline">Coming soon</Badge>
                        )}
                      </div>

                      <div className="mt-4">
                        <span className="text-4xl font-bold">₹{price}</span>

                        <span className="text-muted-foreground">
                          {plan.billing_type === "one_time"
                            ? "/3 months"
                            : "/month"}
                        </span>

                        <p className="text-xs text-muted-foreground mt-1">
                          {plan.billing_type === "one_time"
                            ? "One-time payment · 90 days access · No auto-renewal"
                            : "Recurring monthly subscription"}
                        </p>
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-3">
                      <ul className="space-y-2 text-sm">
                        {plan.features?.tests && (
                          <FeatureLine>
                            Full test series &amp; CBT engine
                          </FeatureLine>
                        )}

                        {plan.features?.tests && (
                          <FeatureLine>
                            Analytics + custom test builder
                          </FeatureLine>
                        )}

                        {plan.features?.notes && (
                          <FeatureLine>
                            Unit-wise notes (all 10 units)
                          </FeatureLine>
                        )}

                        {plan.name === "Combined" && (
                          <FeatureLine>
                            Best value — saves ₹49/month vs. separate
                          </FeatureLine>
                        )}
                      </ul>

                      {plan.is_purchasable ? (
                        subscription ? (
                          <div className="mt-4 space-y-2">
                            <div className="flex items-center justify-center gap-2 rounded-md border p-3 text-sm">
                              <Badge variant="default">Active</Badge>

                              <span>
                                {subscription.plans?.name === plan.name
                                  ? subscription.plans?.billing_type ===
                                    "one_time"
                                    ? "One-time access"
                                    : subscription.cancel_at_period_end
                                      ? "Cancellation scheduled"
                                      : "Renews automatically"
                                  : "Access already active"}
                              </span>
                            </div>

                            <div className="text-center text-xs text-muted-foreground">
                              {subscription.plans?.billing_type === "one_time"
                                ? `Access until ${new Date(
                                    subscription.expires_at,
                                  ).toLocaleDateString("en-IN", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })}`
                                : subscription.cancel_at_period_end
                                  ? `Access until ${new Date(
                                      subscription.expires_at,
                                    ).toLocaleDateString("en-IN", {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric",
                                    })}`
                                  : `Renews ${new Date(
                                      subscription.expires_at,
                                    ).toLocaleDateString("en-IN", {
                                      day: "numeric",
                                      month: "short",
                                      year: "numeric",
                                    })}`}
                            </div>

                            <Button
                              variant="outline"
                              className="w-full"
                              disabled
                            >
                              {subscription.plans?.name === plan.name
                                ? "Already subscribed"
                                : "Current access active"}
                            </Button>
                          </div>
                        ) : (
                          <Button
                            className="w-full mt-4"
                            disabled={busy || !razorpayLoaded}
                            onClick={() => startCheckout(plan.id)}
                          >
                            {busy && (
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            )}

                            {!razorpayLoaded
                              ? "Loading payment..."
                              : user
                                ? plan.billing_type === "one_time"
                                  ? `Buy for ₹${price}`
                                  : "Subscribe"
                                : plan.billing_type === "one_time"
                                  ? "Sign up & buy"
                                  : "Sign up & subscribe"}
                          </Button>
                        )
                      ) : (
                        <Button
                          variant="outline"
                          disabled
                          className="w-full mt-4"
                        >
                          Notify me at launch
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {error && (
              <div className="text-center text-sm text-destructive mb-6">
                {error}
              </div>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  What&apos;s included
                </CardTitle>
              </CardHeader>

              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-normal text-muted-foreground">
                          Feature
                        </th>

                        <th className="py-2 font-normal">Free</th>

                        <th className="py-2 font-normal">Test Series</th>

                        <th className="py-2 font-normal">Notes</th>

                        <th className="py-2 font-normal">Combined</th>
                      </tr>
                    </thead>

                    <tbody>
                      {FEATURES_TABLE.map((row) => (
                        <tr
                          key={row.name}
                          className="border-b border-border/50"
                        >
                          <td className="py-2.5">{row.name}</td>

                          <td className="py-2.5 text-center">
                            <Cell v={row.keys.free} />
                          </td>

                          <td className="py-2.5 text-center">
                            <Cell v={row.keys.ts} />
                          </td>

                          <td className="py-2.5 text-center">
                            <Cell v={row.keys.nt} />
                          </td>

                          <td className="py-2.5 text-center">
                            <Cell v={row.keys.cb} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="text-center mt-8 text-sm text-muted-foreground">
              Questions? See our{" "}
              <Link href="/faq" className="underline text-primary">
                FAQ
              </Link>{" "}
              and{" "}
              <Link href="/refund" className="underline text-primary">
                refund policy
              </Link>
              .
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FeatureLine({ children }) {
  return (
    <li className="flex gap-2">
      <Check className="h-4 w-4 text-emerald-600 mt-0.5" />
      {children}
    </li>
  );
}

function Cell({ v }) {
  if (v === true) {
    return <Check className="h-4 w-4 text-emerald-600 mx-auto" />;
  }

  if (v === false) {
    return <X className="h-4 w-4 text-muted-foreground mx-auto opacity-40" />;
  }

  return <span className="text-xs text-muted-foreground">{v}</span>;
}
