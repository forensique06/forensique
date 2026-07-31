import Link from 'next/link'
import SiteHeader from '@/components/site-header'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = { title: 'FAQ — Forensique' }

const FAQS = [
  { q: 'What exam does Forensique cover?', a: 'UGC NET/JRF Forensic Science Paper II — the exact 10-unit syllabus. We do not cover Paper I (general) or other subjects.' },
  { q: 'What is the exam pattern?', a: '100 questions × 2 marks each = 200 total marks. Duration is 120 minutes. There is currently no negative marking, per the NTA notification. All tests on Forensique follow this exact pattern.' },
  { q: 'Can I try before I subscribe?', a: 'Yes. The UGC NET FS June 2025 paper is our designated free-trial test — unauthenticated visitors and free-tier accounts can attempt the first 25–30 questions under full exam conditions. Sign up (free) to save your progress.' },
  { q: 'How does the custom test builder work?', a: 'Pick a combination of units, topics, difficulty levels, and question count. The builder shows a live match count as you refine filters, so you never build an empty test. Question pool grows as we import more previous-year papers.' },
  { q: 'How often are new previous-year papers added?', a: 'Every UGC NET Forensic Science paper is uploaded within a week of NTA publishing the official answer key. We start with 30–40 papers and add every new sitting as soon as it drops.' },
  { q: 'What if NTA revises an official answer key?', a: 'When NTA publishes a revised key, our admins update it in the system. Your original attempt score stays as taken — the solution review screen shows the corrected answer with a visible “answer key revised” note.' },
  { q: 'What payment methods do you accept?', a: 'UPI Autopay is our recommended method for recurring billing. We also accept card and netbanking e-mandate as a fallback via Razorpay. No manual monthly re-payments; renewal is automatic until you cancel.' },
  { q: 'Can I cancel anytime?', a: 'Yes — cancellation is fully self-service from your dashboard. You keep access until the end of the current billing cycle, then it stops automatically. No emails, no forms.' },
  { q: 'Do you offer refunds?', a: 'See our full Refund & Cancellation Policy.' },
  { q: 'Are Notes and Combined plans available?', a: 'The Test Series plan (₹149/mo) is live. Notes and Combined are on the roadmap and shown on the pricing page so the bundle discount is transparent. We’ll notify subscribers when they launch.' },
]

export default function FAQPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-4xl font-bold mb-2">Frequently asked questions</h1>
        <p className="text-muted-foreground mb-8">Everything about Forensique in one page. Still stuck? <Link href="/contact" className="underline text-primary">Reach out</Link>.</p>
        <div className="space-y-3">
          {FAQS.map((f) => (
            <Card key={f.q}>
              <CardContent className="pt-4">
                <div className="font-semibold">{f.q}</div>
                <div className="text-sm text-muted-foreground mt-1 whitespace-pre-line">{f.a}</div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
