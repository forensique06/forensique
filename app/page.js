import Link from 'next/link'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, Target, BarChart3, Layers, ShieldCheck, ArrowRight, IndianRupee, BookOpen, Sparkles } from 'lucide-react'

export const metadata = {
  title: 'Forensique — UGC NET/JRF Forensic Science Paper II Test Series',
  description: '100 questions × 2 marks × 120 minutes × no negative marking. Deeply tagged previous-year papers, custom tests, and post-test analytics for UGC NET/JRF Forensic Science Paper II aspirants.',
  openGraph: { title: 'Forensique — UGC NET FS Paper II', description: 'The CBT platform built only for Forensic Science aspirants.', type: 'website' },
  alternates: { canonical: '/' },
}

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="container mx-auto px-4 pt-14 pb-16 text-center">
          <Badge variant="secondary" className="mb-4">Now in beta · UGC NET/JRF Forensic Science Paper II</Badge>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-balance">
            The CBT platform built <span className="text-primary">only</span> for Forensic Science aspirants.
          </h1>
          <p className="mt-6 text-base md:text-lg text-muted-foreground max-w-2xl mx-auto">
            Previous-year papers under real exam conditions, deeply tagged questions across all 10 syllabus units,
            and analytics that show <span className="text-foreground font-medium">where</span> you’re losing marks &mdash; not just a number.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 justify-center text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1"><Target className="h-4 w-4"/>100 Q &times; 2 marks</span>
            <span className="inline-flex items-center gap-1"><Clock className="h-4 w-4"/>120 minutes</span>
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-4 w-4"/>No negative marking</span>
            <span className="inline-flex items-center gap-1"><IndianRupee className="h-4 w-4"/>₹149/month</span>
          </div>
          <div className="mt-8 flex flex-wrap gap-3 justify-center">
            <Link href="/auth?mode=signup"><Button size="lg" className="gap-2">Try the free test <ArrowRight className="h-4 w-4"/></Button></Link>
            <Link href="/pricing"><Button size="lg" variant="outline">See pricing</Button></Link>
          </div>
          <p className="text-xs text-muted-foreground mt-4">No card required for the free test.</p>
        </section>

        <section className="container mx-auto px-4 pb-16 grid gap-4 md:grid-cols-3">
          {[
            { icon: Layers, title: 'Deep topic tagging', body: 'Every question is tagged to unit, topic, and subtopic across the exact 10-unit UGC NET FS syllabus.' },
            { icon: BarChart3, title: 'Real analytics', body: 'Accuracy by subtopic, time per question, weak-area callouts that jump straight into a targeted custom test.' },
            { icon: ShieldCheck, title: 'Exam-accurate CBT', body: 'NTA-style palette, question status states, timer, autosave. What you see here is what you’ll see on exam day.' },
          ].map(({ icon: Icon, title, body }) => (
            <Card key={title}><CardContent className="pt-6">
              <Icon className="h-6 w-6 text-primary mb-3"/>
              <div className="font-semibold">{title}</div>
              <p className="text-sm text-muted-foreground mt-1">{body}</p>
            </CardContent></Card>
          ))}
        </section>

        <section className="container mx-auto px-4 pb-16">
          <div className="grid gap-4 md:grid-cols-3">
            <Card><CardContent className="pt-6">
              <Sparkles className="h-6 w-6 text-primary mb-3"/>
              <div className="font-semibold">Custom test builder</div>
              <p className="text-sm text-muted-foreground mt-1">Pick unit, topic, difficulty, count. Live match counter so you never build an empty test.</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <BookOpen className="h-6 w-6 text-primary mb-3"/>
              <div className="font-semibold">Unit-wise notes</div>
              <p className="text-sm text-muted-foreground mt-1">Concise notes for each of the 10 syllabus units. Coming with the Notes plan.</p>
            </CardContent></Card>
            <Card><CardContent className="pt-6">
              <IndianRupee className="h-6 w-6 text-primary mb-3"/>
              <div className="font-semibold">UPI Autopay pricing</div>
              <p className="text-sm text-muted-foreground mt-1">₹149/month, UPI Autopay first, cancel anytime from the dashboard.</p>
            </CardContent></Card>
          </div>
        </section>

        <section className="container mx-auto px-4 pb-20">
          <Card className="bg-primary text-primary-foreground border-0"><CardContent className="pt-8 pb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="font-semibold text-xl">Take the UGC NET FS June 2025 paper now</div>
              <p className="text-sm opacity-80 mt-1">Free forever. Sign up in 15 seconds · 100 questions · 120 minutes · instant scored solutions with explanations.</p>
            </div>
            <Link href="/auth?mode=signup"><Button size="lg" variant="secondary">Start free test</Button></Link>
          </CardContent></Card>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
