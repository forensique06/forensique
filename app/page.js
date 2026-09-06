import Link from 'next/link'

import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

import {
  Clock,
  Target,
  BarChart3,
  ShieldCheck,
  ArrowRight,
  IndianRupee,
  Sparkles,
  Check,
  Brain,
  TrendingUp,
  ListChecks,
} from 'lucide-react'

export const metadata = {
  title: 'Forensique — UGC NET/JRF Forensic Science Preparation',
  description:
    'Prepare for UGC NET/JRF Forensic Science with real CBT practice, previous-year papers, topic-level analytics, custom tests, and syllabus-focused preparation.',
  openGraph: {
    title: 'Forensique — UGC NET/JRF Forensic Science',
    description:
      'Practice UGC NET/JRF Forensic Science like the real exam. Take previous-year papers, find your weak areas, and build targeted tests.',
    type: 'website',
  },
  alternates: {
    canonical: '/',
  },
}

const benefits = [
  {
    icon: ShieldCheck,
    title: 'Exam-like CBT practice',
    body:
      'Practice with a structured computer-based test experience including a timer, question navigation, status tracking, and autosave.',
  },
  {
    icon: BarChart3,
    title: 'Know where you are losing marks',
    body:
      'Go beyond a single score. Analyse performance across units, topics, and subtopics to understand exactly where you need more practice.',
  },
  {
    icon: Sparkles,
    title: 'Build targeted tests',
    body:
      'Choose the areas you want to practise, set your test parameters, and turn weak areas into focused practice sessions.',
  },
]

const workflow = [
  {
    number: '01',
    icon: ListChecks,
    title: 'Take a real paper',
    body:
      'Attempt previous-year Forensic Science papers in a focused CBT environment.',
  },
  {
    number: '02',
    icon: BarChart3,
    title: 'Analyse your performance',
    body:
      'See your accuracy, time spent, and performance across the syllabus.',
  },
  {
    number: '03',
    icon: Brain,
    title: 'Find your weak areas',
    body:
      'Identify the units, topics, and subtopics that are costing you marks.',
  },
  {
    number: '04',
    icon: Sparkles,
    title: 'Build a targeted test',
    body:
      'Create a custom test around the areas that need the most attention.',
  },
  {
    number: '05',
    icon: TrendingUp,
    title: 'Practise and improve',
    body:
      'Repeat the cycle and turn mistakes into measurable progress.',
  },
]

export default function LandingPage() {
  return (
    <>
      <SiteHeader />

      <main>
        {/* HERO */}
        <section className="container mx-auto flex min-h-[560px] items-center px-4 py-16 text-center">
          <div className="mx-auto w-full">
            <Badge variant="secondary" className="mb-5">
              UGC NET/JRF · Forensic Science Paper II
            </Badge>

            <h1 className="mx-auto max-w-5xl text-4xl font-bold tracking-tight text-balance sm:text-5xl md:text-6xl lg:text-7xl">
              Prepare for UGC NET Forensic Science
              <span className="text-primary">
                {' '}
                like you're taking the real exam.
              </span>
            </h1>

            <p className="mx-auto mt-6 max-w-2xl text-base leading-7 text-muted-foreground md:text-lg">
              Practise previous-year papers in a real CBT environment, understand
              exactly where you are losing marks, and build targeted tests around
              your weak areas.
            </p>

            <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Target className="h-4 w-4" />
                100 questions × 2 marks
              </span>

              <span className="inline-flex items-center gap-1.5">
                <Clock className="h-4 w-4" />
                120 minutes
              </span>

              <span className="inline-flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4" />
                No negative marking
              </span>
            </div>

            <div className="mt-8">
              <Link href="/auth?mode=signup">
                <Button size="lg" className="gap-2">
                  Start your free test
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              No card required.
            </p>
          </div>
        </section>

        {/* PRODUCT PREVIEW */}
        <section className="container mx-auto px-4 pb-20">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6 text-center">
              <p className="text-sm font-medium text-primary">
                PRACTISE THE WAY YOU WILL PERFORM
              </p>

              <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">
                An exam-focused CBT experience
              </h2>

              <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground md:text-base">
                Focus on the questions instead of figuring out the interface.
                Your test experience is designed around structured exam
                practice.
              </p>
            </div>

            <Card className="overflow-hidden border shadow-sm">
              <CardContent className="p-0">
                <div className="border-b bg-muted/40 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        UGC NET Forensic Science
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Paper II · Practice Test
                      </div>
                    </div>

                    <div className="inline-flex items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-sm font-medium">
                      <Clock className="h-4 w-4 text-primary" />
                      01:58:42
                    </div>
                  </div>
                </div>

                <div className="grid min-h-[360px] md:grid-cols-[1fr_260px]">
                  {/* Question area */}
                  <div className="p-6 md:p-8">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        Question 42
                      </span>

                      <span className="text-xs text-muted-foreground">
                        42 of 100
                      </span>
                    </div>

                    <div className="mt-6 max-w-3xl">
                      <p className="text-base font-medium leading-7 md:text-lg">
                        Which of the following techniques is most appropriate
                        for the examination of a questioned document?
                      </p>

                      <div className="mt-6 space-y-3">
                        {[
                          'Option A',
                          'Option B',
                          'Option C',
                          'Option D',
                        ].map((option, index) => (
                          <div
                            key={option}
                            className="flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium">
                              {String.fromCharCode(65 + index)}
                            </span>

                            <span>{option}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-8 flex items-center justify-between gap-3">
                      <Button variant="outline" size="sm">
                        Previous
                      </Button>

                      <Button size="sm" className="gap-2">
                        Save & Next
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Question palette */}
                  <div className="border-t bg-muted/20 p-5 md:border-l md:border-t-0">
                    <div className="text-sm font-semibold">
                      Question palette
                    </div>

                    <div className="mt-4 grid grid-cols-5 gap-2">
                      {Array.from({ length: 25 }, (_, index) => (
                        <div
                          key={index}
                          className={`flex h-8 items-center justify-center rounded border text-xs ${
                            index === 14
                              ? 'border-primary bg-primary text-primary-foreground'
                              : index < 10
                                ? 'bg-muted'
                                : 'bg-background'
                          }`}
                        >
                          {index + 1}
                        </div>
                      ))}
                    </div>

                    <div className="mt-6 space-y-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm bg-muted" />
                        Answered
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm border bg-background" />
                        Not answered
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-sm bg-primary" />
                        Current
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Product preview. Your actual test interface contains the complete
              question palette, navigation, timer, and test controls.
            </p>
          </div>
        </section>

        {/* CORE VALUE */}
        <section className="border-y bg-muted/20">
          <div className="container mx-auto px-4 py-20">
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-sm font-medium text-primary">
                THE FORENSIQUE APPROACH
              </p>

              <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
                Don't just take mock tests.
                <br />
                Know what to study next.
              </h2>

              <p className="mt-4 text-muted-foreground">
                A test is useful only when you can turn the result into your
                next preparation decision.
              </p>
            </div>

            <div className="mx-auto mt-12 grid max-w-6xl gap-4 md:grid-cols-3">
              {benefits.map(({ icon: Icon, title, body }) => (
                <Card key={title} className="bg-background">
                  <CardContent className="pt-6">
                    <Icon className="mb-4 h-6 w-6 text-primary" />

                    <h3 className="font-semibold">{title}</h3>

                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {body}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* WORKFLOW */}
        <section className="container mx-auto px-4 py-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-sm font-medium text-primary">
              FROM TEST TO IMPROVEMENT
            </p>

            <h2 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">
              Turn every test into a study plan.
            </h2>

            <p className="mt-4 text-muted-foreground">
              Forensique connects practice, analysis, and targeted revision in
              one preparation loop.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-6xl gap-4 md:grid-cols-5">
            {workflow.map(
              ({ number, icon: Icon, title, body }, index) => (
                <Card key={number} className="relative">
                  <CardContent className="pt-6">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {number}
                      </span>

                      <Icon className="h-5 w-5 text-primary" />
                    </div>

                    <h3 className="mt-5 font-semibold">{title}</h3>

                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {body}
                    </p>
                  </CardContent>

                  {index < workflow.length - 1 && (
                    <ArrowRight className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-muted-foreground md:block" />
                  )}
                </Card>
              ),
            )}
          </div>
        </section>

        {/* POSITIONING + PRICING */}
        <section className="border-t">
          <div className="container mx-auto px-4 py-20">
            <div className="grid items-stretch gap-8 lg:grid-cols-2">
              {/* BUILT FOR FORENSIC SCIENCE */}
              <div className="flex h-full flex-col rounded-xl bg-primary p-8 text-primary-foreground md:p-10">
                <div>
                  <p className="text-sm font-medium opacity-80">
                    BUILT FOR FORENSIC SCIENCE
                  </p>

                  <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">
                    Not another generic UGC NET test platform.
                  </h2>

                  <p className="mt-5 max-w-xl leading-7 opacity-85">
                    Forensique is focused specifically on UGC NET/JRF Forensic
                    Science Paper II. The preparation experience is built around
                    the way Forensic Science aspirants actually prepare.
                  </p>
                </div>

                <div className="mt-8 space-y-4">
                  {[
                    'Previous-year paper practice',
                    'Exam-focused CBT experience',
                    'Detailed performance analytics',
                    'Targeted custom tests',
                  ].map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-3 text-sm"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-auto pt-10">
                  <Link href="/auth?mode=signup">
                    <Button
                      size="lg"
                      variant="secondary"
                      className="gap-2"
                    >
                      Start free
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </Link>
                </div>
              </div>

              {/* SIMPLE PRICING */}
              <div className="flex h-full flex-col">
                <div>
                  <p className="text-sm font-medium text-primary">
                    SIMPLE PRICING
                  </p>

                  <h2 className="mt-2 max-w-xl text-3xl font-semibold tracking-tight md:text-4xl">
                    Everything you need to prepare for ₹149/month.
                  </h2>

                  <p className="mt-4 text-muted-foreground">
                    Start with the free test. Upgrade when you want the full
                    preparation experience.
                  </p>
                </div>

                <Card className="mt-8 flex-1">
                  <CardContent className="flex h-full flex-col p-7 md:p-8">
                    <div className="flex items-end justify-between gap-4">
                      <div>
                        <div className="text-sm font-medium">
                          Forensique Premium
                        </div>

                        <div className="mt-2 flex items-baseline gap-1">
                          <span className="text-4xl font-bold">₹149</span>

                          <span className="text-sm text-muted-foreground">
                            /month
                          </span>
                        </div>
                      </div>

                      <IndianRupee className="h-7 w-7 text-primary" />
                    </div>

                    <div className="my-7 h-px bg-border" />

                    <div className="space-y-3">
                      {[
                        'Previous-year paper practice',
                        'Exam-focused CBT experience',
                        'Detailed performance analytics',
                        'Unit, topic, and subtopic analysis',
                        'Custom test builder',
                        'Unit-wise notes',
                      ].map((item) => (
                        <div
                          key={item}
                          className="flex items-start gap-3 text-sm"
                        >
                          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>

                    <div className="mt-auto pt-7">
                      <Link href="/pricing" className="block">
                        <Button className="w-full gap-2" size="lg">
                          View plans
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>

                      <p className="mt-3 text-center text-xs text-muted-foreground">
                        UPI Autopay available. Cancel anytime from your
                        dashboard.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  )
}