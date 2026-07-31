'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import SiteHeader from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, CheckCircle2, XCircle, MinusCircle, ArrowLeft, Bookmark } from 'lucide-react'

export default function ResultsPage() {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const { attemptId } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(null)
  const [test, setTest] = useState(null)
  const [items, setItems] = useState([]) // enriched question + response + answer
  const [filter, setFilter] = useState('all') // 'all' | 'incorrect' | 'unattempted' | 'correct'
  const [bookmarks, setBookmarks] = useState({})

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.replace('/auth'); return }

        const { data: at, error: aErr } = await supabase
          .from('test_attempts')
          .select('*, tests(*)')
          .eq('id', attemptId).single()
        if (aErr) throw aErr
        if (at.user_id !== user.id) throw new Error('Attempt does not belong to you.')
        if (at.status === 'in_progress') { router.replace(`/attempt/${at.id}`); return }
        setAttempt(at); setTest(at.tests)

        const { data: tqRows } = await supabase
          .from('test_questions')
          .select('sequence_number, question_id, questions(id, question_code, content_format, question_text, passage_id, is_negative_framing, answer_status, explanation, unit_id, topic_id, subtopic_id)')
          .eq('test_id', at.test_id)
          .order('sequence_number', { ascending: true })

        const qIds = tqRows.map((r) => r.question_id)
        const [{ data: opts }, { data: stmts }, { data: mitems }, { data: psgs }, { data: resp }, { data: answers }, { data: bms }, { data: units }, { data: topics }, { data: subtopics }] = await Promise.all([
          supabase.from('question_options').select('*').in('question_id', qIds).order('sort_order'),
          supabase.from('question_statements').select('*').in('question_id', qIds).order('sort_order'),
          supabase.from('question_match_items').select('*').in('question_id', qIds).order('sort_order'),
          supabase.from('passages').select('*'),
          supabase.from('attempt_responses').select('*').eq('attempt_id', attemptId),
          supabase.from('answers').select('*').in('question_id', qIds),
          supabase.from('bookmarks').select('question_id').eq('user_id', user.id).in('question_id', qIds),
          supabase.from('units').select('id, name'),
          supabase.from('topics').select('id, name'),
          supabase.from('subtopics').select('id, name'),
        ])

        const optionsByQ = {}; (opts || []).forEach((o) => (optionsByQ[o.question_id] ||= []).push(o))
        const stmtsByQ = {}; (stmts || []).forEach((s) => (stmtsByQ[s.question_id] ||= []).push(s))
        const matchByQ = {}; (mitems || []).forEach((m) => (matchByQ[m.question_id] ||= []).push(m))
        const psgById = {}; (psgs || []).forEach((p) => psgById[p.id] = p)
        const respByQ = {}; (resp || []).forEach((r) => respByQ[r.question_id] = r)
        const ansByQ = {}; (answers || []).forEach((a) => ansByQ[a.question_id] = a)
        const unitsById = {}; (units || []).forEach((u) => unitsById[u.id] = u.name)
        const topicsById = {}; (topics || []).forEach((t) => topicsById[t.id] = t.name)
        const subById = {}; (subtopics || []).forEach((s) => subById[s.id] = s.name)

        const bm = {}; (bms || []).forEach((b) => bm[b.question_id] = true)
        setBookmarks(bm)

        const enriched = tqRows.map((r) => ({
          seq: r.sequence_number,
          ...r.questions,
          options: optionsByQ[r.question_id] || [],
          statements: stmtsByQ[r.question_id] || [],
          match_items: matchByQ[r.question_id] || [],
          passage: r.questions.passage_id ? psgById[r.questions.passage_id] : null,
          response: respByQ[r.question_id] || null,
          answer: ansByQ[r.question_id] || null,
          unit_name: r.questions.unit_id ? unitsById[r.questions.unit_id] : null,
          topic_name: r.questions.topic_id ? topicsById[r.questions.topic_id] : null,
          subtopic_name: r.questions.subtopic_id ? subById[r.questions.subtopic_id] : null,
        }))
        setItems(enriched)
        setLoading(false)
      } catch (e) {
        setError(e.message || String(e))
        setLoading(false)
      }
    })()
  }, [attemptId, router, supabase])

  async function toggleBookmark(questionId) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    if (bookmarks[questionId]) {
      await supabase.from('bookmarks').delete().eq('user_id', user.id).eq('question_id', questionId)
      setBookmarks((prev) => { const n = { ...prev }; delete n[questionId]; return n })
    } else {
      await supabase.from('bookmarks').insert({ user_id: user.id, question_id: questionId })
      setBookmarks((prev) => ({ ...prev, [questionId]: true }))
    }
  }

  const filtered = useMemo(() => {
    if (filter === 'all') return items
    if (filter === 'incorrect') return items.filter((i) => i.response?.is_correct === false)
    if (filter === 'correct') return items.filter((i) => i.response?.is_correct === true)
    if (filter === 'unattempted') return items.filter((i) => !i.response?.selected_option_id)
    return items
  }, [items, filter])

  if (loading) return <div className="min-h-screen"><SiteHeader/><div className="p-16 flex justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading results…</div></div>
  if (error) return <div className="min-h-screen"><SiteHeader/><div className="p-16 max-w-md mx-auto"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div></div>

  const total = (test?.total_questions || 0) * 2
  const accuracy = attempt.correct_count + attempt.incorrect_count > 0
    ? Math.round((attempt.correct_count / (attempt.correct_count + attempt.incorrect_count)) * 100) : 0
  const timeStr = attempt.time_taken_seconds ? `${Math.floor(attempt.time_taken_seconds/60)}m ${attempt.time_taken_seconds%60}s` : '—'

  return (
    <div className="min-h-screen">
      <SiteHeader/>
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-4">
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3"/>Back to dashboard</Link>
        </div>

        {/* Score summary */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-wrap justify-between items-start gap-4">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Score</div>
                <div className="text-4xl font-bold">{Number(attempt.score ?? 0)} <span className="text-lg text-muted-foreground">/ {total}</span></div>
                <div className="text-sm text-muted-foreground mt-1">{test?.title}</div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <Stat label="Correct" value={attempt.correct_count} color="text-emerald-600"/>
                <Stat label="Incorrect" value={attempt.incorrect_count} color="text-rose-600"/>
                <Stat label="Unattempted" value={attempt.unattempted_count} color="text-muted-foreground"/>
                <Stat label="Accuracy" value={`${accuracy}%`} />
              </div>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">Time taken: {timeStr} of {test?.duration_minutes} min · Status: {attempt.status.replace('_', ' ')}</div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          {[
            ['all', `All (${items.length})`],
            ['incorrect', `Incorrect (${items.filter((i) => i.response?.is_correct === false).length})`],
            ['unattempted', `Unattempted (${items.filter((i) => !i.response?.selected_option_id).length})`],
            ['correct', `Correct (${items.filter((i) => i.response?.is_correct === true).length})`],
          ].map(([val, lbl]) => (
            <Button key={val} variant={filter === val ? 'default' : 'outline'} size="sm" onClick={() => setFilter(val)}>{lbl}</Button>
          ))}
        </div>

        {/* Solution review */}
        <div className="space-y-4">
          {filtered.map((q) => {
            const selected = q.response?.selected_option_id
            const correct = q.answer?.correct_option_id
            const isDropped = q.answer_status === 'dropped'
            const isCorrect = q.response?.is_correct
            return (
              <Card key={q.id} className={isCorrect === true ? 'border-emerald-300' : isCorrect === false ? 'border-rose-300' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm">
                      <span className="font-semibold">Q{q.seq}.</span>
                      {q.unit_name && <span className="text-xs text-muted-foreground ml-2">{q.unit_name}{q.topic_name ? ` • ${q.topic_name}` : ''}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {isDropped && <Badge variant="outline">Dropped · auto-correct</Badge>}
                      {q.is_negative_framing && <Badge variant="destructive" className="text-xs">Neg. framing</Badge>}
                      {isCorrect === true && <CheckCircle2 className="h-5 w-5 text-emerald-600"/>}
                      {isCorrect === false && <XCircle className="h-5 w-5 text-rose-600"/>}
                      {isCorrect === null && !selected && <MinusCircle className="h-5 w-5 text-muted-foreground"/>}
                      <button onClick={() => toggleBookmark(q.id)} title="Bookmark">
                        <Bookmark className={`h-4 w-4 ${bookmarks[q.id] ? 'fill-primary text-primary' : 'text-muted-foreground'}`}/>
                      </button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {q.passage && (
                    <div className="text-xs bg-muted p-2 rounded">
                      <div className="font-semibold mb-1">{q.passage.passage_label || 'Passage'}</div>
                      <div className="whitespace-pre-line">{q.passage.passage_text}</div>
                    </div>
                  )}
                  <div className="text-sm">{q.question_text}</div>

                  {q.statements.length > 0 && (
                    <ul className="space-y-1 border-l-2 border-primary/30 pl-3 text-sm">
                      {q.statements.map((s) => (<li key={s.id}><span className="font-semibold mr-2">{s.label}.</span>{s.text}</li>))}
                    </ul>
                  )}
                  {q.match_items.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 text-xs border-l-2 border-primary/30 pl-3">
                      <div>
                        <div className="font-semibold">List-I</div>
                        {q.match_items.filter((m) => m.side === 'left').map((m) => <div key={m.id}>{m.label}. {m.text}</div>)}
                      </div>
                      <div>
                        <div className="font-semibold">List-II</div>
                        {q.match_items.filter((m) => m.side === 'right').map((m) => <div key={m.id}>{m.label}. {m.text}</div>)}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5 text-sm">
                    {q.options.map((opt) => {
                      const isSel = selected === opt.option_id
                      const isCorr = correct === opt.option_id
                      let cls = 'border-border'
                      if (isCorr) cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                      else if (isSel && !isCorr) cls = 'border-rose-500 bg-rose-50 dark:bg-rose-950/30'
                      return (
                        <div key={opt.id} className={`px-3 py-2 rounded border ${cls}`}>
                          <span className="font-semibold mr-2">{opt.option_id}.</span>{opt.option_text}
                          {isSel && <Badge variant="outline" className="ml-2 text-xs">Your answer</Badge>}
                          {isCorr && <Badge className="ml-2 text-xs bg-emerald-600">Correct</Badge>}
                        </div>
                      )
                    })}
                  </div>

                  {q.explanation && (
                    <div className="text-sm bg-muted/50 p-3 rounded">
                      <div className="font-semibold text-xs uppercase text-muted-foreground mb-1">Explanation</div>
                      <div className="whitespace-pre-line">{q.explanation}</div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, color = '' }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
    </div>
  )
}
