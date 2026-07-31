import Link from 'next/link'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = { title: 'Terms of Service — Forensique' }
const UPDATED = 'June 2025'

export default function TermsPage() {
  return (<><SiteHeader/>
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mt-1">Last updated: {UPDATED}</p>

      <Card className="mt-6"><CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
        <h2 className="font-semibold text-base">1. Who these terms apply to</h2>
        <p>These terms govern your use of Forensique (the &ldquo;Service&rdquo;), operated by the Forensique team. By creating an account or subscribing, you agree to be bound by them. If you do not agree, do not use the Service.</p>

        <h2 className="font-semibold text-base pt-2">2. Eligibility</h2>
        <p>You must be 18 years or older, or have the consent of a parent or legal guardian, to create an account and make payments.</p>

        <h2 className="font-semibold text-base pt-2">3. What Forensique is (and isn&apos;t)</h2>
        <p>Forensique is an unofficial test-preparation platform for the UGC NET/JRF Forensic Science Paper II examination. We are <strong>not affiliated with</strong> the University Grants Commission (UGC) or the National Testing Agency (NTA). Content on this site is authored independently for the purpose of exam preparation and does not constitute official reference material.</p>

        <h2 className="font-semibold text-base pt-2">4. Account &amp; access</h2>
        <p>You are responsible for keeping your account credentials secure. Each subscription is for a single individual; sharing your login is a breach of these terms and may lead to termination without refund.</p>

        <h2 className="font-semibold text-base pt-2">5. Subscription &amp; billing</h2>
        <p>Paid plans renew automatically each month via UPI Autopay, card, or netbanking e-mandate through our payment partner Razorpay. Full billing details, refund windows, and cancellation mechanics are described in the <Link href="/refund" className="underline text-primary">Refund &amp; Cancellation Policy</Link>, which forms part of these Terms.</p>

        <h2 className="font-semibold text-base pt-2">6. Answer keys &amp; revisions</h2>
        <p>Where applicable, we source answer keys from NTA&apos;s published keys and, where NTA revises a key following the official challenge process, we update ours. Historical attempt scores are preserved as taken; the solution-review screen reflects the corrected key with an explicit revision note. We make good-faith efforts to keep keys accurate but do not guarantee freedom from error.</p>

        <h2 className="font-semibold text-base pt-2">7. Intellectual property</h2>
        <p>Question text drawn from official UGC NET / NTA papers remains the property of the respective examining body. Explanations, notes, analytics, code, design, and any other original content on Forensique are the property of Forensique and its licensors, and may not be reproduced, redistributed, or resold without written permission.</p>

        <h2 className="font-semibold text-base pt-2">8. Acceptable use</h2>
        <p>You agree not to (a) scrape or bulk-download content, (b) share account credentials, (c) attempt to bypass paywalls or access controls, (d) use the Service to build a competing test bank, or (e) use the Service for any unlawful purpose. Violations may lead to immediate termination without refund.</p>

        <h2 className="font-semibold text-base pt-2">9. No exam-outcome guarantee</h2>
        <p>Nothing on Forensique is a guarantee that you will qualify UGC NET, JRF, or any other examination. Your performance depends on many factors outside our control.</p>

        <h2 className="font-semibold text-base pt-2">10. Service availability</h2>
        <p>We aim for continuous availability but do not guarantee uninterrupted access. Planned maintenance, third-party outages (Supabase, Razorpay, hosting), or force-majeure events may cause downtime.</p>

        <h2 className="font-semibold text-base pt-2">11. Limitation of liability</h2>
        <p>To the fullest extent permitted by law, Forensique&apos;s aggregate liability arising out of or related to your use of the Service is limited to the fees you paid in the twelve months preceding the claim. We are not liable for indirect, incidental, consequential, or exemplary damages.</p>

        <h2 className="font-semibold text-base pt-2">12. Termination</h2>
        <p>You may cancel your subscription anytime from the Dashboard. We may suspend or terminate your account for breach of these Terms or applicable law.</p>

        <h2 className="font-semibold text-base pt-2">13. Changes to these Terms</h2>
        <p>We may update these Terms from time to time. Material changes will be notified via email or in-app banner at least 14 days before taking effect. Continued use after the effective date constitutes acceptance.</p>

        <h2 className="font-semibold text-base pt-2">14. Governing law &amp; jurisdiction</h2>
        <p>These Terms are governed by the laws of India. Any dispute arising out of or relating to them shall be subject to the exclusive jurisdiction of the courts in India.</p>

        <h2 className="font-semibold text-base pt-2">15. Contact</h2>
        <p>Questions about these Terms: <Link href="/contact" className="underline text-primary">/contact</Link>.</p>
      </CardContent></Card>
    </main><SiteFooter/></>)
}
