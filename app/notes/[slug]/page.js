import { notFound } from 'next/navigation'
import Link from 'next/link'
import fs from 'fs/promises'
import path from 'path'
import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import { MDXRemote } from 'next-mdx-remote/rsc'
import SiteHeader from '@/components/site-header'
import SiteFooter from '@/components/site-footer'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Lock, BookOpen } from 'lucide-react'

export const dynamic = 'force-dynamic' // never statically build — gating requires per-request auth

async function getUserAndEntitlement() {
  try {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { user: null, entitled: false }

    // Check for an active subscription whose plan grants 'notes' entitlement.
    // Uses the anon client + user's cookie — RLS on subscriptions ensures they
    // only see their own row.
    const { data: subs } = await supabase
      .from('subscriptions')
      .select('status, expires_at, plans(features)')
      .eq('user_id', user.id)
    const now = new Date()
    const entitled = (subs || []).some((s) =>
      s.status === 'active' && new Date(s.expires_at) > now && s.plans?.features?.notes === true
    )
    return { user, entitled }
  } catch {
    return { user: null, entitled: false }
  }
}

export async function generateMetadata({ params }) {
  const { slug } = await params
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const { data: note } = await supabase.from('notes').select('title, summary').eq('slug', slug).maybeSingle()
  if (!note) return { title: 'Notes — Forensique' }
  return { title: `${note.title} — Forensique notes`, description: note.summary }
}

export default async function NoteDetailPage({ params }) {
  const { slug } = await params
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  const { data: note } = await supabase
    .from('notes')
    .select('slug, title, summary, status, units(name)')
    .eq('slug', slug).eq('status', 'published').maybeSingle()
  if (!note) notFound()

  const { user, entitled } = await getUserAndEntitlement()

  // Gating: only load and compile MDX for entitled viewers.
  let mdxSource = null
  if (entitled) {
    try {
      const filepath = path.join(process.cwd(), 'content', 'notes', `${slug}.mdx`)
      mdxSource = await fs.readFile(filepath, 'utf-8')
    } catch {
      mdxSource = null
    }
  }

  const mdxComponents = {
    h1: (p) => <h1 className="text-3xl font-bold mt-8 mb-3" {...p}/>,
    h2: (p) => <h2 className="text-xl font-semibold mt-6 mb-2" {...p}/>,
    p: (p) => <p className="text-sm leading-relaxed my-3" {...p}/>,
    ul: (p) => <ul className="list-disc pl-6 space-y-1.5 text-sm my-3" {...p}/>,
    ol: (p) => <ol className="list-decimal pl-6 space-y-1.5 text-sm my-3" {...p}/>,
    li: (p) => <li className="leading-relaxed" {...p}/>,
    strong: (p) => <strong className="font-semibold text-foreground" {...p}/>,
    em: (p) => <em className="italic" {...p}/>,
    blockquote: (p) => <blockquote className="border-l-4 border-primary/40 pl-4 my-4 text-sm text-muted-foreground" {...p}/>,
    code: (p) => <code className="bg-muted px-1.5 py-0.5 rounded text-xs" {...p}/>,
  }

  return (
    <><SiteHeader/>
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <Link href="/notes" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3"/>All notes
        </Link>
        <div className="mt-4 flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary"/>
          <Badge variant="outline" className="text-xs">{note.units?.name}</Badge>
        </div>
        <h1 className="text-3xl font-bold mt-2">{note.title}</h1>
        <p className="text-sm text-muted-foreground mt-2">{note.summary}</p>

        {entitled && mdxSource ? (
          <article className="prose prose-sm max-w-none mt-6">
            <MDXRemote source={mdxSource} components={mdxComponents}/>
          </article>
        ) : (
          <Card className="mt-8 bg-muted/40 border-dashed">
            <CardContent className="pt-8 pb-8 text-center">
              <Lock className="h-8 w-8 text-primary mx-auto mb-3"/>
              <div className="font-semibold text-lg">Notes access — coming soon</div>
              <p className="text-sm text-muted-foreground max-w-md mx-auto mt-2">
                The full body of this note becomes available with the <strong>Notes</strong> plan (₹199/mo) or the <strong>Combined</strong> plan (₹299/mo). Both plans are on the roadmap and will unlock automatically once available.
              </p>
              <div className="flex flex-wrap gap-2 justify-center mt-5">
                <Link href="/pricing"><Button variant="outline" size="sm">See pricing</Button></Link>
                {!user && <Link href="/auth?mode=signup"><Button size="sm">Sign up to get notified</Button></Link>}
              </div>
            </CardContent>
          </Card>
        )}
      </main>
      <SiteFooter/>
    </>
  )
}
