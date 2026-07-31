'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import SiteHeader from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Upload, FileJson } from 'lucide-react'

export default function AdminImportPage() {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [jsonText, setJsonText] = useState('')

  useEffect(() => {
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.replace('/auth'); return }
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (prof?.role !== 'admin') { setAllowed(false); setChecking(false); return }
      setAllowed(true); setChecking(false)
    })()
  }, [supabase, router])

  async function runImport(payload) {
    setBusy(true); setError(null); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/admin/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error || 'Import failed')
      setResult(j)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function importSample() {
    const res = await fetch('/UGC_NET_FS_2025_JUNE.json')
    const json = await res.json()
    await runImport(json)
  }

  async function importPasted() {
    try {
      const json = JSON.parse(jsonText)
      await runImport(json)
    } catch (e) {
      setError('JSON parse error: ' + e.message)
    }
  }

  async function handleFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const text = await f.text()
    try {
      await runImport(JSON.parse(text))
    } catch (err) {
      setError('JSON parse error: ' + err.message)
    }
  }

  if (checking) return <div className="min-h-screen"><SiteHeader/><div className="p-16 flex justify-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin"/>Checking access…</div></div>

  if (!allowed) {
    return (
      <div className="min-h-screen">
        <SiteHeader/>
        <div className="container mx-auto px-4 py-16 max-w-lg text-center">
          <Card><CardContent className="pt-8">
            <div className="font-semibold">Admin only</div>
            <p className="text-sm text-muted-foreground mt-2">Your account is not marked as an admin. Ask your Supabase project owner to run:</p>
            <pre className="text-xs bg-muted p-3 mt-3 rounded text-left overflow-auto">update public.profiles set role = &apos;admin&apos; where email = &apos;YOUR_EMAIL&apos;;</pre>
          </CardContent></Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <SiteHeader/>
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-bold mb-1">Admin · Import test JSON</h1>
        <p className="text-sm text-muted-foreground mb-6">Bulk-import a full test (100 questions + passages) in the UGC_NET_FS JSON shape.</p>

        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><FileJson className="h-4 w-4"/>Import the sample paper</CardTitle>
            <CardDescription>UGC NET FS June 2025 · 100 questions · will be flagged as the free-trial test (is_premium=false).</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={importSample} disabled={busy} className="gap-2">
              {busy ? <Loader2 className="h-4 w-4 animate-spin"/> : <Upload className="h-4 w-4"/>}
              Import UGC_NET_FS_2025_JUNE.json
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import another JSON file</CardTitle>
            <CardDescription>Paste JSON or upload a file. Additional tests default to <code>is_premium = true</code>.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input type="file" accept="application/json" onChange={handleFile} className="text-sm"/>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} placeholder="Or paste JSON here" className="w-full h-40 p-2 rounded border border-border text-xs font-mono bg-muted"/>
            <Button variant="outline" onClick={importPasted} disabled={busy || !jsonText}>Import pasted JSON</Button>
          </CardContent>
        </Card>

        {error && <Alert variant="destructive" className="mt-6"><AlertDescription>{error}</AlertDescription></Alert>}
        {result && (
          <Alert className="mt-6">
            <AlertDescription>
              <div className="font-semibold">Imported successfully.</div>
              <ul className="text-xs mt-2 space-y-1">
                <li>Test: <code>{result.test?.test_id}</code> — {result.test?.title}</li>
                <li>Questions inserted: {result.counts?.questions}</li>
                <li>Passages: {result.counts?.passages}</li>
                <li>Options: {result.counts?.options}</li>
                <li>Statements: {result.counts?.statements}</li>
                <li>Match items: {result.counts?.match_items}</li>
                <li>Dropped questions: {result.counts?.dropped}</li>
              </ul>
              {result.warnings?.length > 0 && (
                <div className="mt-3">
                  <div className="font-semibold text-yellow-700 dark:text-yellow-500">Warnings:</div>
                  <ul className="text-xs list-disc pl-5">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  )
}
