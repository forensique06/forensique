'use client'

import { useEffect, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, PlayCircle, RotateCw, ClipboardCheck, Upload, Sparkles, IndianRupee, XCircle, CheckCircle2 } from 'lucide-react'

function DashboardInner() {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const params = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [tests, setTests] = useState([])
  const [attempts, setAttempts] = useState([])
  const [subscription, setSubscription] = useState(null)
  const [starting, setStarting] = useState(null)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelResult, setCancelResult] = useState(null)

  const showUpgraded = params.get('upgraded') === '1'

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/auth'); return }
      setUser(user)

      const [{ data: prof }, { data: ts }, { data: at }, { data: subs }] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
        supabase.from('tests').select('id, test_id, title, test_type, total_questions, duration_minutes, is_premium, status').eq('status', 'published').order('created_at', { ascending: false }),
        supabase.from('test_attempts').select('id, status, started_at, submitted_at, score, correct_count, incorrect_count, unattempted_count, test_id, tests(title, total_questions)').eq('user_id', user.id).order('started_at', { ascending: false }).limit(10),
        supabase.from('subscriptions').select('*, plans(name, price_paise, features)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1),
      ])
      setProfile(prof); setTests(ts || []); setAttempts(at || []); setSubscription(subs?.[0] || null)
      setLoading(false)
    })()
  }, [supabase, router])

  async function startAttempt(testId) {
    setStarting(testId)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/attempt/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ test_id: testId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Failed to start attempt')
      router.push(`/attempt/${j.attempt_id}`)
    } catch (e) { alert(e.message); setStarting(null) }
  }

  async function cancelSubscription() {
    if (!subscription?.razorpay_subscription_id) return
    if (!confirm('Cancel your subscription at the end of the current billing cycle? You keep access until then.')) return
    setCancelBusy(true); setCancelResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/billing/cancel', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ razorpay_subscription_id: subscription.razorpay_subscription_id }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Cancel failed')
      setCancelResult({ ok: true })
      // refresh subscription
      const { data: subs } = await supabase.from('subscriptions').select('*, plans(name, price_paise, features)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1)
      setSubscription(subs?.[0] || null)
    } catch (e) { setCancelResult({ ok: false, error: e.message }) }
    finally { setCancelBusy(false) }
  }

  if (loading) return <><SiteHeader/><div className="p-16 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading dashboard…</div></>

  const inProgress = attempts.filter((a) => a.status === 'in_progress')
  const submitted = attempts.filter((a) => a.status !== 'in_progress')
  const isSubActive = subscription && subscription.status === 'active' && new Date(subscription.expires_at) > new Date()

  return (
    <><SiteHeader/>
      <main className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex justify-between items-start mb-6 flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">Welcome back{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}.</h1>
            <p className="text-sm text-muted-foreground">UGC NET/JRF Forensic Science Paper II</p>
          </div>
          {profile?.role === 'admin' && (
            <Link href="/admin/import"><Button variant="outline" size="sm" className="gap-2"><Upload className="h-4 w-4"/>Admin</Button></Link>
          )}
        </div>

        {showUpgraded && <Alert className="mb-6 border-emerald-500"><AlertDescription>🎉 Payment received. Your Test Series subscription is being activated — refresh in a few seconds if it doesn&apos;t show here yet.</AlertDescription></Alert>}

        {/* SUBSCRIPTION CARD */}
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><IndianRupee className="h-4 w-4"/>Subscription</CardTitle></CardHeader>
          <CardContent>
            {!subscription ? (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Free tier</div>
                  <p className="text-xs text-muted-foreground">Access to the free UGC NET FS June 2025 paper. Subscribe to unlock all previous-year papers, the custom test builder, and analytics.</p>
                </div>
                <Link href="/pricing"><Button size="sm">See plans</Button></Link>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap justify-between items-start gap-3">
                  <div>
                    <div className="text-sm font-medium flex items-center gap-2">
                      {subscription.plans?.name}
                      {isSubActive ? <Badge className="bg-emerald-600 text-white"><CheckCircle2 className="h-3 w-3 mr-1"/>Active</Badge> : <Badge variant="outline">{subscription.status}</Badge>}
                      {subscription.cancel_at_period_end && <Badge variant="outline">Cancels at cycle end</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      ₹{Math.round((subscription.plans?.price_paise ?? 0) / 100)}/month · Renews / expires {new Date(subscription.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  {isSubActive && !subscription.cancel_at_period_end && (
                    <Button size="sm" variant="outline" onClick={cancelSubscription} disabled={cancelBusy} className="gap-1">
                      {cancelBusy ? <Loader2 className="h-4 w-4 animate-spin"/> : <XCircle className="h-4 w-4"/>}
                      Cancel subscription
                    </Button>
                  )}
                </div>
                {subscription.cancel_at_period_end && (
                  <Alert><AlertDescription>Your subscription will end on {new Date(subscription.expires_at).toLocaleDateString()}. No further debits will occur. Resubscribe anytime from the pricing page.</AlertDescription></Alert>
                )}
                {cancelResult?.ok && <Alert className="border-emerald-500"><AlertDescription>Cancellation scheduled. You keep access until {new Date(subscription.expires_at).toLocaleDateString()}.</AlertDescription></Alert>}
                {cancelResult?.ok === false && <Alert variant="destructive"><AlertDescription>{cancelResult.error}</AlertDescription></Alert>}
              </div>
            )}
          </CardContent>
        </Card>

        {inProgress.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Continue where you left off</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {inProgress.map((a) => (
                <Card key={a.id}><CardContent className="pt-6 flex justify-between items-center gap-2">
                  <div>
                    <div className="font-medium">{a.tests?.title}</div>
                    <div className="text-xs text-muted-foreground">Started {new Date(a.started_at).toLocaleString()}</div>
                  </div>
                  <Link href={`/attempt/${a.id}`}><Button size="sm" className="gap-1"><RotateCw className="h-4 w-4"/>Resume</Button></Link>
                </CardContent></Card>
              ))}
            </div>
          </div>
        )}

        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Available tests</h2>
            <Link href="/custom-test" className="text-xs text-primary hover:underline inline-flex items-center gap-1"><Sparkles className="h-3 w-3"/>Build a custom test</Link>
          </div>
          {tests.length === 0 ? (
            <Card><CardContent className="pt-6 text-center text-sm text-muted-foreground">
              No tests published yet.{profile?.role === 'admin' ? <> Head to <Link className="underline text-primary" href="/admin/import">Admin → Import</Link> to import the sample UGC NET FS 2025 June paper.</> : ' Check back soon.'}
            </CardContent></Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {tests.map((t) => {
                const gated = t.is_premium && !isSubActive
                return (
                  <Card key={t.id} className={gated ? 'opacity-70' : ''}>
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <CardTitle className="text-base">{t.title}</CardTitle>
                          <CardDescription>{t.total_questions} questions · {t.duration_minutes} min · {t.test_type.replace('_', ' ')}</CardDescription>
                        </div>
                        {!t.is_premium && <Badge variant="secondary">Free</Badge>}
                        {t.is_premium && !isSubActive && <Badge variant="outline">Premium</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent>
                      {gated ? (
                        <Link href="/pricing"><Button variant="outline" size="sm" className="w-full">Subscribe to unlock</Button></Link>
                      ) : (
                        <Button size="sm" onClick={() => startAttempt(t.id)} disabled={starting === t.id} className="gap-2 w-full">
                          {starting === t.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <PlayCircle className="h-4 w-4"/>}
                          Start attempt
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </div>

        {submitted.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent attempts</h2>
            <div className="grid gap-2">
              {submitted.map((a) => (
                <Card key={a.id}><CardContent className="pt-6 flex justify-between items-center flex-wrap gap-2">
                  <div>
                    <div className="font-medium">{a.tests?.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(a.submitted_at || a.started_at).toLocaleString()} · Score {Number(a.score ?? 0)} / {(a.tests?.total_questions ?? 0) * 2} · {a.correct_count}✅ {a.incorrect_count}❌ {a.unattempted_count}⚪
                    </div>
                  </div>
                  <Link href={`/results/${a.id}`}><Button variant="outline" size="sm" className="gap-1"><ClipboardCheck className="h-4 w-4"/>View solutions</Button></Link>
                </CardContent></Card>
              ))}
            </div>
          </div>
        )}
      </main>
      <SiteFooter/>
    </>
  )
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="p-16 flex items-center justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading dashboard…</div>}>
      <DashboardInner />
    </Suspense>
  )
}
