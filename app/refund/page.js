import SiteHeader from '@/components/site-header'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = { title: 'Refund & Cancellation Policy — Forensique' }

export default function RefundPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-3xl font-bold mb-1">Refund &amp; Cancellation Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' })}</p>

        <Card className="mb-4">
          <CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
            <h2 className="font-semibold text-base">1. Auto-renewing subscription</h2>
            <p>Forensique subscriptions bill monthly and renew automatically via UPI Autopay or card/netbanking e-mandate through Razorpay. You will receive a mandatory pre-debit notification from Razorpay at least 24 hours before every renewal, as required by RBI.</p>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
            <h2 className="font-semibold text-base">2. Cancellation — fully self-service</h2>
            <p>You can cancel at any time from your Dashboard → Subscription. There is no form, no email required, no support ticket. On clicking Cancel:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Your subscription is set to <em>cancel at the end of the current billing cycle</em>.</li>
              <li>You retain full access to the plan&apos;s features until the paid-through date.</li>
              <li>No further debits happen after that date.</li>
              <li>You can resubscribe anytime.</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
            <h2 className="font-semibold text-base">3. Refunds</h2>
            <p><strong>Auto-renewal refund window:</strong> if a monthly renewal was auto-debited and you cancel within <strong>48 hours</strong> of that debit — <em>and</em> you have not attempted any premium test or opened any premium note in that billing cycle — you are eligible for a full refund of that month&apos;s charge.</p>
            <p><strong>First-time subscription refund:</strong> your first month is not refundable once you have used any premium feature (attempted a premium test, opened a premium note). If you subscribed and haven&apos;t used anything, contact us within 24 hours and we&apos;ll refund the full amount.</p>
            <p><strong>Not refundable:</strong> partial months after cancellation, months in which any premium content was consumed, subscriptions cancelled outside the windows above.</p>
            <p>Refunds are issued back to the original payment method through Razorpay, typically within 5–10 business days.</p>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
            <h2 className="font-semibold text-base">4. Failed payment / grace period</h2>
            <p>If a monthly renewal fails, Razorpay will retry per its standard dunning schedule. Your account remains active during the retry window (typically 3–5 days). If all retries fail, access is downgraded to the free tier automatically; your data (attempts, bookmarks, analytics) is preserved. Resubscribe anytime to restore access.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
            <h2 className="font-semibold text-base">5. Contact for refund requests</h2>
            <p>Email us at <strong>support@forensique.in</strong> from the email address on your Forensique account, with the payment reference (from your bank statement or Razorpay email). We respond within 2 business days.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
