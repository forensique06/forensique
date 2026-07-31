'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import SiteHeader from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Check, X, Loader2 } from 'lucide-react'

const PLAN_ORDER = ['Test Series', 'Notes', 'Combined']

const FEATURES_TABLE = [
  { name: 'Full-length previous-year tests (CBT)', keys: { free: false, ts: true, nt: false, cb: true } },
  { name: 'Custom test builder (unit/topic/difficulty)', keys: { free: false, ts: true, nt: false, cb: true } },
  { name: 'Solution review with explanations', keys: { free: 'partial', ts: true, nt: false, cb: true } },
  { name: 'Post-test analytics dashboard', keys: { free: false, ts: true, nt: false, cb: true } },
  { name: 'Bookmarks & practice mode', keys: { free: false, ts: true, nt: false, cb: true } },
  { name: 'Unit-wise notes (all 10 units)', keys: { free: 'summary', ts: false, nt: true, cb: true } },
  { name: 'Free-trial paper (partial access)', keys: { free: true, ts: true, nt: true, cb: true } },
]

export default function PricingPage() {
  const supabase = getSupabaseBrowser()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data } = await supabase.from('plans').select('*').eq('is_active', true).order('sort_order')
      setPlans(data || [])
      const { data: u } = await supabase.auth.getUser()
      setUser(u?.user || null)
      setLoading(false)
    })()
  }, [supabase])

  async function startCheckout(planId) {
    if (!user) { window.location.href = '/auth?mode=signup&next=/pricing'; return }
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/billing/create-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan_id: planId }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Checkout failed')
      openRazorpay(j.subscription_id, j.razorpay_key_id)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  function openRazorpay(subscriptionId, keyId) {
    const rzp = new window.Razorpay({
      key: keyId,
      subscription_id: subscriptionId,
      name: 'Forensique',
      description: 'Test Series — ₹149/month',
      theme: { color: '#0f172a' },
      handler: async (res) => {
        const { data: { session } } = await supabase.auth.getSession()
        await fetch('/api/billing/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify(res),
        })
        window.location.href = '/dashboard?upgraded=1'
      },
      modal: { ondismiss: () => setBusy(false) },
    })
    rzp.open()
  }

  return (
    <div className="min-h-screen">
      <script src="https://checkout.razorpay.com/v1/checkout.js" async />
      <SiteHeader />
      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <div className="text-center mb-10">
          <Badge variant="secondary">Simple, monthly, cancel anytime</Badge>
          <h1 className="text-4xl font-bold mt-3">Pricing</h1>
          <p className="text-muted-foreground mt-2">Every plan renews monthly via UPI Autopay or e-mandate.</p>
        </div>

        {loading ? (
          <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/></div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-3 mb-12">
              {PLAN_ORDER.map((planName) => {
                const plan = plans.find((p) => p.name === planName)
                if (!plan) return null
                const isTS = plan.name === 'Test Series'
                const price = (plan.price_paise / 100).toFixed(0)
                return (
                  <Card key={plan.id} className={isTS ? 'ring-2 ring-primary' : ''}>
                    <CardHeader>
                      <div className="flex justify-between items-start">
                        <CardTitle className="text-xl">{plan.name}</CardTitle>
                        {isTS ? <Badge>Most popular</Badge> : <Badge variant="outline">Coming soon</Badge>}
                      </div>
                      <div className="mt-4">
                        <span className="text-4xl font-bold">₹{price}</span>
                        <span className="text-muted-foreground">/month</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <ul className="space-y-2 text-sm">
                        {plan.features?.tests && <FeatureLine>Full test series &amp; CBT engine</FeatureLine>}
                        {plan.features?.tests && <FeatureLine>Analytics + custom test builder</FeatureLine>}
                        {plan.features?.notes && <FeatureLine>Unit-wise notes (all 10 units)</FeatureLine>}
                        {plan.name === 'Combined' && <FeatureLine>Best value — saves ₹49/month vs. separate</FeatureLine>}
                      </ul>
                      {plan.is_purchasable ? (
                        <Button className="w-full mt-4" disabled={busy} onClick={() => startCheckout(plan.id)}>
                          {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}
                          {user ? 'Subscribe' : 'Sign up & subscribe'}
                        </Button>
                      ) : (
                        <Button variant="outline" disabled className="w-full mt-4">Notify me at launch</Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>

            {error && <div className="text-center text-sm text-destructive mb-6">{error}</div>}

            <Card>
              <CardHeader><CardTitle className="text-base">What&apos;s included</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 font-normal text-muted-foreground">Feature</th>
                        <th className="py-2 font-normal">Free</th>
                        <th className="py-2 font-normal">Test Series</th>
                        <th className="py-2 font-normal">Notes</th>
                        <th className="py-2 font-normal">Combined</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FEATURES_TABLE.map((row) => (
                        <tr key={row.name} className="border-b border-border/50">
                          <td className="py-2.5">{row.name}</td>
                          <td className="py-2.5 text-center"><Cell v={row.keys.free}/></td>
                          <td className="py-2.5 text-center"><Cell v={row.keys.ts}/></td>
                          <td className="py-2.5 text-center"><Cell v={row.keys.nt}/></td>
                          <td className="py-2.5 text-center"><Cell v={row.keys.cb}/></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <div className="text-center mt-8 text-sm text-muted-foreground">
              Questions? See our <Link href="/faq" className="underline text-primary">FAQ</Link> and <Link href="/refund" className="underline text-primary">refund policy</Link>.
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function FeatureLine({ children }) { return <li className="flex gap-2"><Check className="h-4 w-4 text-emerald-600 mt-0.5"/>{children}</li> }
function Cell({ v }) {
  if (v === true) return <Check className="h-4 w-4 text-emerald-600 mx-auto"/>
  if (v === false) return <X className="h-4 w-4 text-muted-foreground mx-auto opacity-40"/>
  return <span className="text-xs text-muted-foreground">{v}</span>
}
