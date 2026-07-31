'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Loader2, Clock, AlertTriangle, ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react'

const NOT_VISITED = 'not_visited'
const NOT_ANSWERED = 'not_answered'
const ANSWERED = 'answered'
const MARKED_FOR_REVIEW = 'marked_for_review'
const ANSWERED_AND_MARKED = 'answered_and_marked'

function paletteColor(status) {
  switch (status) {
    case ANSWERED: return 'bg-emerald-600 text-white border-emerald-700'
    case NOT_ANSWERED: return 'bg-rose-600 text-white border-rose-700'
    case MARKED_FOR_REVIEW: return 'bg-violet-600 text-white border-violet-700'
    case ANSWERED_AND_MARKED: return 'bg-violet-600 text-white border-violet-700 ring-2 ring-emerald-400'
    default: return 'bg-muted text-foreground border-border'
  }
}

export default function AttemptPage() {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const { attemptId } = useParams()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [attempt, setAttempt] = useState(null)
  const [test, setTest] = useState(null)
  const [questions, setQuestions] = useState([])
  const [responses, setResponses] = useState({})
  const [current, setCurrent] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const saveTimers = useRef({})

  useEffect(() => {
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { router.replace('/auth'); return }

        const { data: attemptRow, error: aErr } = await supabase
          .from('test_attempts').select('*, tests(*)').eq('id', attemptId).single()
        if (aErr) throw aErr
        if (attemptRow.user_id !== user.id) throw new Error('Attempt does not belong to you.')
        if (attemptRow.status !== 'in_progress') { router.replace(`/results/${attemptRow.id}`); return }

        setAttempt(attemptRow); setTest(attemptRow.tests)

        const { data: tqRows, error: tqErr } = await supabase
          .from('test_questions')
          .select('sequence_number, question_id, questions(id, question_code, content_format, question_text, passage_id, is_negative_framing, answer_status)')
          .eq('test_id', attemptRow.test_id).order('sequence_number', { ascending: true })
        if (tqErr) throw tqErr

        const qIds = tqRows.map((r) => r.question_id)
        const [{ data: opts }, { data: stmts }, { data: mitems }, { data: psgs }, { data: existingResp }] = await Promise.all([
          supabase.from('question_options').select('*').in('question_id', qIds).order('sort_order'),
          supabase.from('question_statements').select('*').in('question_id', qIds).order('sort_order'),
          supabase.from('question_match_items').select('*').in('question_id', qIds).order('sort_order'),
          supabase.from('passages').select('*'),
          supabase.from('attempt_responses').select('*').eq('attempt_id', attemptId),
        ])

        const optionsByQ = {}, stmtsByQ = {}, matchByQ = {}, passageById = {}
        ;(opts || []).forEach((o) => (optionsByQ[o.question_id] ||= []).push(o))
        ;(stmts || []).forEach((s) => (stmtsByQ[s.question_id] ||= []).push(s))
        ;(mitems || []).forEach((m) => (matchByQ[m.question_id] ||= []).push(m))
        ;(psgs || []).forEach((p) => passageById[p.id] = p)

        const enriched = tqRows.map((r) => ({
          ...r.questions, sequence_number: r.sequence_number,
          options: optionsByQ[r.question_id] || [], statements: stmtsByQ[r.question_id] || [],
          match_items: matchByQ[r.question_id] || [], passage: r.questions.passage_id ? passageById[r.questions.passage_id] : null,
        }))
        setQuestions(enriched)

        const respMap = {}
        ;(existingResp || []).forEach((r) => { respMap[r.question_id] = { selected_option_id: r.selected_option_id, status: r.status } })
        enriched.forEach((q) => { if (!respMap[q.id]) respMap[q.id] = { selected_option_id: null, status: NOT_VISITED } })
        setResponses(respMap)

        const startedMs = new Date(attemptRow.started_at).getTime()
        const total = attemptRow.tests.duration_minutes * 60
        const elapsed = Math.floor((Date.now() - startedMs) / 1000)
        setRemaining(Math.max(0, total - elapsed))

        setLoading(false)
      } catch (e) { setError(e.message || String(e)); setLoading(false) }
    })()
  }, [attemptId, router, supabase])

  useEffect(() => {
    if (loading || !questions.length) return
    const q = questions[current]
    if (!q) return
    setResponses((prev) => {
      const r = prev[q.id]
      if (r && r.status === NOT_VISITED) {
        const next = { ...prev, [q.id]: { ...r, status: NOT_ANSWERED } }
        scheduleSave(q.id, next[q.id])
        return next
      }
      return prev
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, loading, questions])

  useEffect(() => {
    if (loading || !attempt) return
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(iv); autoSubmit(); return 0 }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, attempt])

  // PHASE-3 FIX: browser only UPDATEs existing pre-created rows. No upsert.
  const scheduleSave = useCallback(async (questionId, resp) => {
    if (saveTimers.current[questionId]) clearTimeout(saveTimers.current[questionId])
    saveTimers.current[questionId] = setTimeout(async () => {
      try {
        const { error } = await supabase
          .from('attempt_responses')
          .update({
            selected_option_id: resp.selected_option_id,
            status: resp.status,
            answered_at: resp.selected_option_id ? new Date().toISOString() : null,
          })
          .eq('attempt_id', attemptId)
          .eq('question_id', questionId)
        if (error) { console.error('autosave failed', error); setSaveError(error.message) }
        else setSaveError(null)
      } catch (e) { console.error('autosave failed', e); setSaveError(e.message) }
    }, 400)
  }, [attemptId, supabase])

  function chooseOption(optionId) {
    const q = questions[current]
    setResponses((prev) => {
      const r = prev[q.id] || { selected_option_id: null, status: NOT_VISITED }
      const wasMarked = r.status === MARKED_FOR_REVIEW || r.status === ANSWERED_AND_MARKED
      const nextStatus = wasMarked ? ANSWERED_AND_MARKED : ANSWERED
      const next = { ...prev, [q.id]: { selected_option_id: optionId, status: nextStatus } }
      scheduleSave(q.id, next[q.id]); return next
    })
  }

  function clearResponse() {
    const q = questions[current]
    setResponses((prev) => {
      const r = prev[q.id]
      const wasMarked = r?.status === MARKED_FOR_REVIEW || r?.status === ANSWERED_AND_MARKED
      const nextStatus = wasMarked ? MARKED_FOR_REVIEW : NOT_ANSWERED
      const next = { ...prev, [q.id]: { selected_option_id: null, status: nextStatus } }
      scheduleSave(q.id, next[q.id]); return next
    })
  }

  function saveAndNext() { goTo(Math.min(current + 1, questions.length - 1)) }

  function markForReviewAndNext() {
    const q = questions[current]
    setResponses((prev) => {
      const r = prev[q.id] || { selected_option_id: null, status: NOT_ANSWERED }
      const nextStatus = r.selected_option_id ? ANSWERED_AND_MARKED : MARKED_FOR_REVIEW
      const next = { ...prev, [q.id]: { ...r, status: nextStatus } }
      scheduleSave(q.id, next[q.id]); return next
    })
    goTo(Math.min(current + 1, questions.length - 1))
  }

  function goTo(i) { setCurrent(i) }

  async function submit(auto = false) {
    if (submitting) return
    setSubmitting(true)
    try {
      // Flush pending timers: for each questionId with an outstanding timer, run the update NOW.
      const pending = Object.entries(responses).filter(([qid]) => saveTimers.current[qid])
      for (const [qid, r] of pending) {
        clearTimeout(saveTimers.current[qid])
        await supabase.from('attempt_responses').update({
          selected_option_id: r.selected_option_id, status: r.status,
          answered_at: r.selected_option_id ? new Date().toISOString() : null,
        }).eq('attempt_id', attemptId).eq('question_id', qid)
      }

      // PHASE-3: scoring is a Postgres RPC now, not a Next.js API route.
      const { data, error } = await supabase.rpc('finalize_attempt', {
        p_attempt_id: attemptId, p_auto: auto,
      })
      if (error) throw error
      if (!data?.ok) throw new Error(data?.error || 'finalize_attempt failed')
      router.replace(`/results/${attemptId}`)
    } catch (e) { alert('Submit failed: ' + (e.message || e)); setSubmitting(false) }
  }

  async function autoSubmit() { await submit(true) }

  const counts = useMemo(() => {
    const c = { answered: 0, not_answered: 0, marked_for_review: 0, answered_and_marked: 0, not_visited: 0 }
    Object.values(responses).forEach((r) => { c[r.status] = (c[r.status] || 0) + 1 })
    return c
  }, [responses])

  if (loading) return <div className="p-16 flex justify-center items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading test…</div>
  if (error) return <div className="p-16 max-w-md mx-auto"><Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert></div>

  const q = questions[current]
  const r = responses[q.id] || { selected_option_id: null, status: NOT_VISITED }
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const timeStr = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  const timeCritical = remaining < 300

  const paletteContent = (
    <Card><CardContent className="pt-4">
      <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Question palette</div>
      <div className="grid grid-cols-6 sm:grid-cols-8 lg:grid-cols-6 gap-1.5">
        {questions.map((qq, i) => {
          const status = responses[qq.id]?.status || NOT_VISITED
          const isCurrent = i === current
          return (
            <button key={qq.id} onClick={() => goTo(i)}
              className={`h-9 w-9 rounded text-xs font-semibold border ${paletteColor(status)} ${isCurrent ? 'ring-2 ring-offset-1 ring-primary' : ''}`}
            >{i + 1}</button>
          )
        })}
      </div>
      <div className="mt-4 space-y-1 text-xs">
        <LegendRow color="bg-emerald-600" label="Answered" count={counts.answered}/>
        <LegendRow color="bg-rose-600" label="Not answered" count={counts.not_answered}/>
        <LegendRow color="bg-muted border" label="Not visited" count={counts.not_visited}/>
        <LegendRow color="bg-violet-600" label="Marked for review" count={counts.marked_for_review}/>
        <LegendRow color="bg-violet-600 ring-2 ring-emerald-400" label="Answered & marked" count={counts.answered_and_marked}/>
      </div>
    </CardContent></Card>
  )

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="bg-background border-b border-border">
        <div className="container mx-auto px-3 py-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{test?.title}</div>
            <div className="text-xs text-muted-foreground hidden sm:block">100 Q · 2 marks · no negative marking · {test?.duration_minutes} min</div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 font-mono text-base sm:text-lg font-bold px-3 py-2 rounded ${timeCritical ? 'bg-destructive text-destructive-foreground animate-pulse' : 'bg-primary text-primary-foreground'}`}>
              <Clock className="h-4 w-4"/>{timeStr}
            </div>
            {/* Mobile: palette in a sheet */}
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline" size="icon" className="lg:hidden" aria-label="Palette"><LayoutGrid className="h-4 w-4"/></Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 overflow-y-auto">
                <SheetTitle className="text-base">Question palette</SheetTitle>
                <div className="mt-4">{paletteContent}</div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      {saveError && (
        <div className="container mx-auto px-3 py-2"><Alert variant="destructive" className="text-xs">
          <AlertDescription>Autosave failed: {saveError}. Your recent answers may not be saved. Check network / refresh.</AlertDescription>
        </Alert></div>
      )}

      <div className="container mx-auto px-3 py-4 grid lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4 min-w-0">
          {q.passage && (
            <Card><CardContent className="pt-4 bg-slate-50 dark:bg-slate-900/40">
              <div className="text-xs uppercase text-muted-foreground mb-1">{q.passage.passage_label || 'Passage'}</div>
              <div className="text-sm whitespace-pre-line leading-relaxed">{q.passage.passage_text}</div>
            </CardContent></Card>
          )}

          <Card><CardContent className="pt-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium">Question {current + 1} of {questions.length}</div>
              <Badge variant="outline" className="text-xs">{q.content_format.replace('_', ' ')}</Badge>
              {q.is_negative_framing && (
                <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3"/>Negative framing</Badge>
              )}
            </div>
            <div className="text-base leading-relaxed">{q.question_text}</div>
            {q.statements.length > 0 && (
              <ul className="space-y-2 border-l-2 border-primary/40 pl-4 text-sm">
                {q.statements.map((s) => (<li key={s.id}><span className="font-semibold mr-2">{s.label}.</span>{s.text}</li>))}
              </ul>
            )}
            {q.match_items.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm border-l-2 border-primary/40 pl-4">
                <div><div className="text-xs font-semibold text-muted-foreground uppercase mb-1">List-I</div>
                  {q.match_items.filter((m) => m.side === 'left').map((m) => (<div key={m.id}><span className="font-semibold">{m.label}.</span> {m.text}</div>))}
                </div>
                <div><div className="text-xs font-semibold text-muted-foreground uppercase mb-1">List-II</div>
                  {q.match_items.filter((m) => m.side === 'right').map((m) => (<div key={m.id}><span className="font-semibold">{m.label}.</span> {m.text}</div>))}
                </div>
              </div>
            )}
            <div className="space-y-2 pt-2">
              {q.options.map((opt) => {
                const selected = r.selected_option_id === opt.option_id
                return (
                  <button key={opt.id} onClick={() => chooseOption(opt.option_id)}
                    className={`w-full text-left px-4 py-3 rounded-md border transition ${selected ? 'border-primary bg-primary/10 ring-2 ring-primary/40' : 'border-border hover:bg-muted'}`}>
                    <span className="font-semibold mr-2">{opt.option_id}.</span>{opt.option_text}
                  </button>
                )
              })}
            </div>
          </CardContent></Card>

          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => goTo(Math.max(0, current - 1))} disabled={current === 0}><ChevronLeft className="h-4 w-4"/>Previous</Button>
              <Button variant="outline" size="sm" onClick={clearResponse}>Clear</Button>
              <Button variant="outline" size="sm" onClick={markForReviewAndNext}>Mark &amp; next</Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={saveAndNext} className="gap-1">Save &amp; next<ChevronRight className="h-4 w-4"/></Button>
              <Button size="sm" variant="destructive" onClick={() => setShowConfirm(true)}>Submit</Button>
            </div>
          </div>
        </div>

        <div className="hidden lg:block space-y-3 sticky top-16 h-fit">
          {paletteContent}
        </div>
      </div>

      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowConfirm(false)}>
          <Card className="max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <CardContent className="pt-6 space-y-4">
              <div className="font-semibold text-lg">Submit test?</div>
              <div className="text-sm text-muted-foreground">Once submitted, you cannot come back to this attempt.</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="font-semibold">{counts.answered}</span> answered</div>
                <div><span className="font-semibold">{counts.not_answered + counts.not_visited}</span> not answered</div>
                <div><span className="font-semibold">{counts.marked_for_review}</span> marked for review</div>
                <div><span className="font-semibold">{counts.answered_and_marked}</span> answered &amp; marked</div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setShowConfirm(false)} disabled={submitting}>Keep testing</Button>
                <Button variant="destructive" onClick={() => submit(false)} disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin"/>}Submit
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function LegendRow({ color, label, count }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`h-3 w-3 rounded ${color}`}/>
      <span className="flex-1">{label}</span>
      <span className="font-mono">{count}</span>
    </div>
  )
}
