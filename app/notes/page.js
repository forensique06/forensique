import Link from 'next/link'
import { createClient } from '@supabase/supabase-js'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Lock, ArrowRight, BookOpen } from 'lucide-react'

export const metadata = {
  title: 'Notes — UGC NET FS Paper II · Forensique',
  description: 'Unit-wise study notes for UGC NET/JRF Forensic Science Paper II. Concise, exam-focused, one section per syllabus unit.',
}

// Server component — reads notes metadata using the anon client (RLS-open table).
export default async function NotesIndexPage() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const { data: notes } = await supabase
    .from('notes')
    .select('slug, title, summary, sort_order, unit_id, units(name)')
    .eq('status', 'published')
    .order('sort_order')

  return (
    <><SiteHeader/>
      <main className="container mx-auto px-4 py-10 max-w-5xl">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-6">
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2"><BookOpen className="h-6 w-6 text-primary"/>Study notes</h1>
            <p className="text-sm text-muted-foreground mt-1">One section per UGC NET FS syllabus unit. Full content requires the Notes or Combined plan.</p>
          </div>
          <Badge variant="outline">Notes plan · Coming soon</Badge>
        </div>

        {!notes || notes.length === 0 ? (
          <Card><CardContent className="pt-6 text-sm text-muted-foreground text-center">Notes are being seeded. Check back shortly.</CardContent></Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {notes.map((n) => (
              <Link href={`/notes/${n.slug}`} key={n.slug}>
                <Card className="h-full hover:shadow transition"><CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{n.title}</CardTitle>
                      <CardDescription className="text-xs mt-0.5">Unit · {n.units?.name}</CardDescription>
                    </div>
                    <Lock className="h-4 w-4 text-muted-foreground shrink-0"/>
                  </div>
                </CardHeader><CardContent className="pt-0">
                  <p className="text-sm text-muted-foreground">{n.summary}</p>
                  <div className="text-xs text-primary mt-3 inline-flex items-center gap-1">Preview <ArrowRight className="h-3 w-3"/></div>
                </CardContent></Card>
              </Link>
            ))}
          </div>
        )}
      </main>
      <SiteFooter/>
    </>
  )
}
