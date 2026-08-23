'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import SiteHeader from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Loader2, Sparkles, PlayCircle } from 'lucide-react'

const DIFFICULTIES = ['easy', 'medium', 'hard']

export default function CustomTestBuilderPage() {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [entitled, setEntitled] = useState(false)
  const [units, setUnits] = useState([])
  const [topics, setTopics] = useState([])
  const [selectedUnits, setSelectedUnits] = useState(new Set())
  const [selectedTopics, setSelectedTopics] = useState(new Set())
  const [selectedDifficulties, setSelectedDifficulties] = useState(new Set(['easy', 'medium', 'hard']))
  const [count, setCount] = useState(20)
  const [matchCount, setMatchCount] = useState(0)
  const [matchLoading, setMatchLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/auth'); return }
      const [{ data: profile }, { data: subscriptions }] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', user.id).maybeSingle(),
        supabase
          .from('subscriptions')
          .select('status, expires_at, plans(features)')
          .eq('user_id', user.id)
          .eq('status', 'active'),
      ])

      const isAdmin = profile?.role === 'admin'
      const hasTestPlan = (subscriptions || []).some(
        (s) => new Date(s.expires_at) > new Date() && s.plans?.features?.tests === true
      )
      const canBuild = isAdmin || hasTestPlan
      setEntitled(canBuild)

      if (canBuild) {
        const [{ data: us }, { data: ts }] = await Promise.all([
          supabase.from('units').select('id, name, sort_order').order('sort_order'),
          supabase.from('topics').select('id, name, unit_id').order('name'),
        ])
        setUnits(us || [])
        setTopics(ts || [])
      }

      setLoading(false)
    })()
  }, [supabase, router])

  // Debounced live match counter
  useEffect(() => {
    if (loading || !entitled) return
    setMatchLoading(true)
    const handle = setTimeout(async () => {
      let q = supabase.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'published')
      if (selectedUnits.size > 0) q = q.in('unit_id', [...selectedUnits])
      if (selectedTopics.size > 0) q = q.in('topic_id', [...selectedTopics])
      if (selectedDifficulties.size > 0 && selectedDifficulties.size < 3) {
        q = q.in('difficulty', [...selectedDifficulties])
      }
      const { count, error } = await q
      if (!error) setMatchCount(count || 0)
      setMatchLoading(false)
    }, 300)
    return () => clearTimeout(handle)
  }, [selectedUnits, selectedTopics, selectedDifficulties, loading, entitled, supabase])

  function toggle(set, setSet, id) {
    const next = new Set(set); next.has(id) ? next.delete(id) : next.add(id); setSet(next)
  }

  const visibleTopics = useMemo(() => {
    if (selectedUnits.size === 0) return []
    return topics.filter((t) => selectedUnits.has(t.unit_id))
  }, [topics, selectedUnits])

  async function build() {
    setError(null); setCreating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/custom-test/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          unit_ids: [...selectedUnits],
          topic_ids: [...selectedTopics],
          difficulties: [...selectedDifficulties],
          count: Math.min(count, matchCount),
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Build failed')
      // Immediately start the attempt on the new test
      const res2 = await fetch('/api/attempt/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ test_id: j.test_uuid }),
      })
      const j2 = await res2.json()
      if (!res2.ok) throw new Error(j2.error || 'Failed to start')
      router.push(`/attempt/${j2.attempt_id}`)
    } catch (e) {
      setError(e.message); setCreating(false)
    }
  }

  if (loading) return <div className="min-h-screen"><SiteHeader/><div className="p-16 flex justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Loading…</div></div>

  if (!entitled) {
    return (
      <div className="min-h-screen">
        <SiteHeader />
        <div className="container mx-auto px-4 py-16 max-w-lg">
          <Card>
            <CardContent className="pt-8 pb-8 text-center">
              <Sparkles className="h-8 w-8 text-primary mx-auto mb-3" />
              <h1 className="text-xl font-semibold">Custom tests are a Premium feature</h1>
              <p className="text-sm text-muted-foreground mt-2">
                Build tests from the complete question bank by unit, topic, difficulty, and question count with an active Test Series subscription.
              </p>
              <Button className="mt-5" onClick={() => router.push('/pricing')}>
                View Test Series pricing
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  const canBuild = matchCount > 0 && count > 0 && !creating

  return (
    <div className="min-h-screen">
      <SiteHeader />
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="flex items-center gap-2 mb-1"><Sparkles className="h-5 w-5 text-primary"/><h1 className="text-2xl font-bold">Build a custom test</h1></div>
        <p className="text-sm text-muted-foreground mb-6">Filter by unit, topic, and difficulty. We&apos;ll pick questions at random from the matching pool.</p>

        <div className="grid lg:grid-cols-[1fr_320px] gap-4">
          <div className="space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Units ({selectedUnits.size || 'all'})</CardTitle></CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-2">
                  {units.map((u) => (
                    <label key={u.id} className="flex items-center gap-2 text-sm cursor-pointer p-2 rounded hover:bg-muted">
                      <Checkbox checked={selectedUnits.has(u.id)} onCheckedChange={() => {
                        toggle(selectedUnits, setSelectedUnits, u.id)
                        // Also remove topics of deselected unit
                        if (selectedUnits.has(u.id)) {
                          const nextT = new Set(selectedTopics)
                          topics.filter((t) => t.unit_id === u.id).forEach((t) => nextT.delete(t.id))
                          setSelectedTopics(nextT)
                        }
                      }}/>
                      {u.name}
                    </label>
                  ))}
                </div>
              </CardContent>
            </Card>

            {visibleTopics.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="text-sm">Topics (optional — leave empty for all topics in selected units)</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid sm:grid-cols-2 gap-1">
                    {visibleTopics.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-muted">
                        <Checkbox checked={selectedTopics.has(t.id)} onCheckedChange={() => toggle(selectedTopics, setSelectedTopics, t.id)}/>
                        <span className="truncate">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader><CardTitle className="text-sm">Difficulty</CardTitle></CardHeader>
              <CardContent className="flex gap-2">
                {DIFFICULTIES.map((d) => (
                  <Button key={d} variant={selectedDifficulties.has(d) ? 'default' : 'outline'} size="sm"
                    onClick={() => toggle(selectedDifficulties, setSelectedDifficulties, d)}>{d}</Button>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">How many questions?</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  {[10, 20, 30, 50, 100].map((n) => (
                    <Button key={n} variant={count === n ? 'default' : 'outline'} size="sm" onClick={() => setCount(n)}>{n}</Button>
                  ))}
                </div>
                <div>
                  <Label htmlFor="count" className="text-xs">Custom</Label>
                  <Input id="count" type="number" min={1} max={200} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} className="max-w-[120px]"/>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right sidebar — live counter */}
          <div>
            <Card className="sticky top-16">
              <CardContent className="pt-6 text-center">
                <div className="text-xs uppercase text-muted-foreground">Matching questions</div>
                <div className="text-5xl font-bold my-2">
                  {matchLoading ? <Loader2 className="h-8 w-8 mx-auto animate-spin text-muted-foreground"/> : matchCount.toLocaleString()}
                </div>
                {matchCount > 0 && matchCount < count && (
                  <Badge variant="secondary" className="mb-3">Only {matchCount} available — test will be shorter</Badge>
                )}
                <div className="text-sm text-muted-foreground mb-4">Building a <strong>{Math.min(count, matchCount) || count}-question</strong> test · {Math.min(count, matchCount) * 2 || count * 2} marks · no negative marking</div>
                <Button className="w-full gap-2" onClick={build} disabled={!canBuild}>
                  {creating ? <Loader2 className="h-4 w-4 animate-spin"/> : <PlayCircle className="h-4 w-4"/>}
                  Build &amp; start
                </Button>
                {matchCount === 0 && !matchLoading && (
                  <p className="text-xs text-muted-foreground mt-2">Widen your filters — no questions match.</p>
                )}
                {error && <Alert variant="destructive" className="mt-3 text-left"><AlertDescription>{error}</AlertDescription></Alert>}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}