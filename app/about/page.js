import Link from 'next/link'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Card, CardContent } from '@/components/ui/card'

export const metadata = { title: 'About — Forensique', description: 'Why we built Forensique: a test platform only for UGC NET/JRF Forensic Science Paper II aspirants.' }

export default function AboutPage() {
  return (
    <><SiteHeader/>
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <h1 className="text-4xl font-bold">Why Forensique</h1>
        <p className="text-muted-foreground mt-2">A test platform built for one very specific exam — done right.</p>

        <Card className="mt-8"><CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
          <h2 className="font-semibold text-base">The problem with generic test platforms</h2>
          <p>Most UGC NET prep sites treat Forensic Science Paper II as one subject slot in a catalogue of hundreds. Their questions are lightly tagged, their analytics show a total score, and their &ldquo;custom test&rdquo; feature has no idea what a Level-2 fingerprint detail is vs Level-1 vs Level-3. If you’re preparing for this specific exam, that’s not enough.</p>
        </CardContent></Card>

        <Card className="mt-4"><CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
          <h2 className="font-semibold text-base">What we do differently</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>One syllabus, ten units, done properly.</strong> Every question is tagged to a unit, topic, and subtopic that matches the actual UGC NET FS syllabus — not an approximation.</li>
            <li><strong>Analytics that name the fix.</strong> Not &ldquo;you scored 62%&rdquo; but &ldquo;your accuracy on Level-2 fingerprint minutiae is 34%; here&rsquo;s a 10-question custom test on exactly that.&rdquo;</li>
            <li><strong>Exam conditions match the real thing.</strong> 100 questions, 2 marks each, no negative marking, 120-minute timer, NTA-style question palette with the exact five state colours.</li>
            <li><strong>Answer-key transparency.</strong> When NTA revises an official key post-challenge, we update ours — and the solution review clearly shows the revised answer without silently rewriting your original score.</li>
          </ul>
        </CardContent></Card>

        <Card className="mt-4"><CardContent className="pt-6 space-y-3 text-sm leading-relaxed">
          <h2 className="font-semibold text-base">Who we are</h2>
          <p>Forensique is an independent product, not affiliated with UGC or NTA. We’re a small team building this because none of us could find a decent test platform for this exam.</p>
          <p>Have feedback, question errors, or a subject-matter suggestion? Reach us at <Link href="/contact" className="underline text-primary">/contact</Link>.</p>
        </CardContent></Card>
      </main>
      <SiteFooter/></>
  )
}
