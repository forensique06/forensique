'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import SiteHeader from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar } from 'recharts'
import { Loader2, ArrowRight, Target } from 'lucide-react'
import Link from 'next/link'

export default function AnalyticsPage() {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [attempts, setAttempts] = useState([])
  const [unitStats, setUnitStats] = useState([])
  const [subtopicStats, setSubtopicStats] = useState([])
  const [timeByUnit, setTimeByUnit] = useState([])

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/auth'); return }

      // Fetch submitted attempts
      const { data: att } = await supabase
        .from('test_attempts')
        .select('id, submitted_at, score, correct_count, incorrect_count, unattempted_count, time_taken_seconds, test_id, tests(title, total_questions)')
        .eq('user_id', user.id)
        .neq('status', 'in_progress')
        .order('submitted_at', { ascending: true })
      setAttempts(att || [])

      if (!att?.length) { setLoading(false); return }

      const attemptIds = att.map((a) => a.id)

      // Load all responses + join to questions.unit_id/topic_id/subtopic_id
      const { data: resp } = await supabase.from('attempt_responses').select('*').in('attempt_id', attemptIds)
      const qIds = [...new Set((resp || []).map((r) => r.question_id))]
      const [{ data: qs }, { data: units }, { data: topics }, { data: subtopics }] = await Promise.all([
        supabase.from('questions').select('id, unit_id, topic_id, subtopic_id').in('id', qIds),
        supabase.from('units').select('id, name, sort_order').order('sort_order'),
        supabase.from('topics').select('id, name'),
        supabase.from('subtopics').select('id, name'),
      ])

      const qById = Object.fromEntries((qs || []).map((q) => [q.id, q]))
      const unitById = Object.fromEntries((units || []).map((u) => [u.id, u]))
      const subtopicById = Object.fromEntries((subtopics || []).map((s) => [s.id, s.name]))

      // Aggregate by unit
      const perUnit = {} // unit_name -> {attempted, correct, timeSum}
      const perSubtopic = {} // subtopic_name -> {attempted, correct}

      for (const r of (resp || [])) {
        const q = qById[r.question_id]; if (!q) continue
        const unitName = unitById[q.unit_id]?.name || 'Uncategorised'
        const attempted = r.selected_option_id != null || r.is_correct === true // dropped q correct without selection
        const correct = r.is_correct === true

        if (!perUnit[unitName]) perUnit[unitName] = { attempted: 0, correct: 0, total: 0, timeSum: 0 }
        perUnit[unitName].total++
        if (attempted) { perUnit[unitName].attempted++; perUnit[unitName].timeSum += (r.time_spent_seconds || 0) }
        if (correct) perUnit[unitName].correct++

        if (q.subtopic_id) {
          const sName = subtopicById[q.subtopic_id]
          if (sName) {
            if (!perSubtopic[sName]) perSubtopic[sName] = { attempted: 0, correct: 0, total: 0 }
            perSubtopic[sName].total++
            if (attempted) perSubtopic[sName].attempted++
            if (correct) perSubtopic[sName].correct++
          }
        }
      }

      const unitRows = Object.entries(perUnit).map(([name, s]) => ({
        name: name.length > 22 ? name.slice(0, 20) + '…' : name,
        fullName: name,
        accuracy: s.attempted ? Math.round((s.correct / s.attempted) * 100) : 0,
        attempted: s.attempted, total: s.total, correct: s.correct,
      })).sort((a, b) => a.fullName.localeCompare(b.fullName))
      setUnitStats(unitRows)

      const subRows = Object.entries(perSubtopic).map(([name, s]) => ({
        name, accuracy: s.attempted ? Math.round((s.correct / s.attempted) * 100) : 0,
        attempted: s.attempted, total: s.total, correct: s.correct,
      }))
      // Weak areas: at least 3 attempted, sorted by accuracy asc
      subRows.sort((a, b) => a.accuracy - b.accuracy || b.attempted - a.attempted)
      setSubtopicStats(subRows.filter((s) => s.attempted >= 3))

      // Time per unit
      const timeRows = Object.entries(perUnit).map(([name, s]) => ({
        name: name.length > 22 ? name.slice(0, 20) + '…' : name,
        avgTime: s.attempted ? Math.round(s.timeSum / s.attempted) : 0,
        accuracy: s.attempted ? Math.round((s.correct / s.attempted) * 100) : 0,
      }))
      setTimeByUnit(timeRows)

      setLoading(false)
    })()
  }, [supabase, router])

  const trend = useMemo(() => attempts.map((a, i) => ({
    n: `#${i + 1}`, date: a.submitted_at ? new Date(a.submitted_at).toLocaleDateString() : '',
    score: Number(a.score ?? 0),
    accuracy: (a.correct_count + a.incorrect_count) > 0
      ? Math.round((a.correct_count / (a.correct_count + a.incorrect_count)) * 100) : 0,
  })), [attempts])

  if (loading) return <div className="min-h-screen"><SiteHeader/><div className="p-16 flex justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading analytics…</div></div>

  if (attempts.length === 0) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="container mx-auto px-4 py-16 max-w-2xl text-center">
          <h1 className="text-2xl font-bold">No attempts yet</h1>
          <p className="text-muted-foreground mt-2">Take your first test to unlock accuracy-by-topic, trend charts, and weak-area callouts.</p>
          <Link href="/dashboard" className="mt-4 inline-block"><Button>Go to dashboard <ArrowRight className="h-4 w-4 ml-1"/></Button></Link>
        </div>
      </div>
    )
  }

  const weakAreas = subtopicStats.slice(0, 5)

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <h1 className="text-2xl font-bold mb-1">Performance analytics</h1>
        <p className="text-sm text-muted-foreground mb-6">Across {attempts.length} submitted attempt{attempts.length === 1 ? '' : 's'}.</p>

        {/* Trend */}
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Score trend</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={trend} margin={{ top: 6, right: 16, bottom: 6, left: -8 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3}/>
                  <XAxis dataKey="n" fontSize={12}/>
                  <YAxis fontSize={12}/>
                  <Tooltip labelFormatter={(l, p) => `Attempt ${l} · ${p?.[0]?.payload?.date || ''}`}/>
                  <Line type="monotone" dataKey="accuracy" stroke="hsl(var(--primary))" strokeWidth={2} dot name="Accuracy %"/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Accuracy by unit — bar + radar side by side */}
        <div className="grid gap-4 lg:grid-cols-2 mb-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Accuracy by unit</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer>
                  <BarChart data={unitStats} layout="vertical" margin={{ top: 4, right: 8, left: 4, bottom: 4 }}>
                    <XAxis type="number" domain={[0, 100]} fontSize={11}/>
                    <YAxis type="category" dataKey="name" width={140} fontSize={11}/>
                    <Tooltip formatter={(v) => `${v}%`}/>
                    <Bar dataKey="accuracy" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Coverage radar</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer>
                  <RadarChart data={unitStats}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="name" fontSize={10}/>
                    <PolarRadiusAxis domain={[0, 100]} fontSize={10}/>
                    <Radar dataKey="accuracy" stroke="hsl(var(--primary))" fill="hsl(var(--primary))" fillOpacity={0.35}/>
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Time vs accuracy */}
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Average time per question, by unit</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={timeByUnit} margin={{ top: 4, right: 16, bottom: 40, left: -8 }}>
                  <XAxis dataKey="name" fontSize={10} angle={-25} textAnchor="end" interval={0}/>
                  <YAxis fontSize={11} label={{ value: 'sec', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}/>
                  <Tooltip formatter={(v, n) => n === 'avgTime' ? `${v}s` : `${v}%`}/>
                  <Bar dataKey="avgTime" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} name="Avg time"/>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Slow &amp; inaccurate together = highest-leverage area to fix.</p>
          </CardContent>
        </Card>

        {/* Weak areas */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><Target className="h-4 w-4"/>Weak areas — practice these next</CardTitle>
          </CardHeader>
          <CardContent>
            {weakAreas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not enough data yet — attempt at least 3 questions per subtopic across your tests, and this list will populate.</p>
            ) : (
              <div className="space-y-2">
                {weakAreas.map((s) => (
                  <div key={s.name} className="flex justify-between items-center p-3 rounded border border-border">
                    <div>
                      <div className="font-medium text-sm">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.correct}/{s.attempted} correct · {s.accuracy}% accuracy</div>
                    </div>
                    <Badge variant={s.accuracy < 40 ? 'destructive' : 'secondary'}>{s.accuracy}%</Badge>
                  </div>
                ))}
                <Link href="/custom-test" className="block mt-3">
                  <Button variant="outline" className="w-full gap-2">Build a targeted custom test <ArrowRight className="h-4 w-4"/></Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
