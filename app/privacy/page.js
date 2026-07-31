import Link from 'next/link'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = { title: 'Privacy Policy — Forensique' }
const UPDATED = 'June 2025'

export default function PrivacyPage() {
  return (<><SiteHeader/>
    <main className="container mx-auto px-4 py-12 max-w-3xl">
      <h1 className="text-3xl font-bold">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mt-1">Last updated: {UPDATED}</p>

      <Card className="mt-6"><CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
        <h2 className="font-semibold text-base">1. Who we are</h2>
        <p>Forensique (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a test-preparation platform for UGC NET/JRF Forensic Science Paper II aspirants. This policy explains what personal data we collect, why, how we store it, and what rights you have over it.</p>

        <h2 className="font-semibold text-base pt-2">2. What we collect</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Account data</strong>: email address, name (if you provide it), password (stored hashed by our identity provider Supabase Auth, never in plaintext).</li>
          <li><strong>Learning data</strong>: your test attempts, per-question responses, time-per-question, bookmarks, custom-test filters. This is what powers the analytics dashboard.</li>
          <li><strong>Payment metadata</strong>: subscription ID, plan, status, renewal date. Actual card / UPI / netbanking credentials are collected and processed entirely by Razorpay; we never see or store your card number, CVV, or UPI PIN.</li>
          <li><strong>Technical data</strong>: IP address, browser user-agent, and timestamps for security and abuse-prevention.</li>
        </ul>

        <h2 className="font-semibold text-base pt-2">3. Why we collect it (lawful basis)</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>Contract</strong>: to provide the Service you subscribed to.</li>
          <li><strong>Legitimate interest</strong>: fraud prevention, service improvement, aggregated non-identifying analytics.</li>
          <li><strong>Consent</strong>: any marketing emails; you can opt out at any time from the footer of any email.</li>
          <li><strong>Legal obligation</strong>: tax and accounting record-keeping.</li>
        </ul>

        <h2 className="font-semibold text-base pt-2">4. Where your data is stored</h2>
        <p>Application data lives in Supabase (Postgres) hosted in AWS Asia-Pacific regions. Payment data lives with Razorpay. Static assets and page rendering are served from Vercel&apos;s CDN. We do not transfer your personal data to any third party for marketing purposes.</p>

        <h2 className="font-semibold text-base pt-2">5. Who can see your data</h2>
        <p>Row-level security in our database ensures that a signed-in user can only see their own attempts, responses, bookmarks, and subscription. Our admins can access aggregate analytics and, when necessary for support, individual records — access is logged and gated on a role flag.</p>

        <h2 className="font-semibold text-base pt-2">6. Cookies &amp; tracking</h2>
        <p>We use one strictly-necessary session cookie for Supabase Auth. We do not use third-party advertising cookies. If we add analytics in future, it will be a privacy-respecting product and this policy will be updated with 14 days&apos; notice.</p>

        <h2 className="font-semibold text-base pt-2">7. How long we keep data</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>Account &amp; learning data: for as long as your account is active.</li>
          <li>Deleted-account data: purged within 30 days of deletion, except where retained under law (e.g., financial records for 7 years).</li>
          <li>Payment metadata: as long as required by applicable financial/tax law.</li>
        </ul>

        <h2 className="font-semibold text-base pt-2">8. Your rights</h2>
        <p>You can, at any time:</p>
        <ul className="list-disc pl-6 space-y-1">
          <li>Access and download your data (email us; we&apos;ll send a JSON export within 7 days).</li>
          <li>Correct inaccurate data.</li>
          <li>Delete your account. This cascades to attempts, responses, bookmarks, subscription.</li>
          <li>Object to processing or withdraw consent for optional processing (marketing).</li>
          <li>Lodge a complaint with the relevant data-protection authority.</li>
        </ul>

        <h2 className="font-semibold text-base pt-2">9. Children&apos;s privacy</h2>
        <p>The Service is not directed to individuals under 18. If we learn we&apos;ve collected data from a minor, we&apos;ll delete it promptly.</p>

        <h2 className="font-semibold text-base pt-2">10. Security</h2>
        <p>Data-in-transit is TLS-encrypted. Data-at-rest is encrypted by Supabase / Razorpay / AWS. Access to admin interfaces is limited and gated on database-side role flags with column-level restrictions preventing self-promotion or forgery of scoring data.</p>

        <h2 className="font-semibold text-base pt-2">11. Changes to this policy</h2>
        <p>We will notify you by email or in-app banner at least 14 days before any material change.</p>

        <h2 className="font-semibold text-base pt-2">12. Contact</h2>
        <p>For any privacy request, email <strong>privacy@forensique.in</strong> or use <Link href="/contact" className="underline text-primary">/contact</Link>.</p>
      </CardContent></Card>
    </main><SiteFooter/></>)
}
