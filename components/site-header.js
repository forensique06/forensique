'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Microscope, LogOut, Menu } from 'lucide-react'

const PUBLIC_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/notes', label: 'Notes' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
]

export default function SiteHeader() {
  const supabase = getSupabaseBrowser()
  const [email, setEmail] = useState(null)
  const [role, setRole] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const user = data?.user
      setEmail(user?.email ?? null)
      if (user) {
        const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
        setRole(prof?.role ?? 'student')
      }
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setEmail(session?.user?.email ?? null))
    return () => sub.subscription.unsubscribe()
  }, [supabase])

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const authedLinks = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/custom-test', label: 'Custom test' },
    { href: '/analytics', label: 'Analytics' },
    { href: '/notes', label: 'Notes' },
    ...(role === 'admin' ? [{ href: '/admin/import', label: 'Admin' }] : []),
  ]

  return (
    <header className="border-b border-border sticky top-0 z-30 bg-background/85 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Microscope className="h-5 w-5 text-primary" />
          <span>Forensique</span>
          <span className="hidden sm:inline text-xs font-normal text-muted-foreground">· UGC NET FS Paper II</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          {email ? (
            <>
              {authedLinks.map((l) => <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground px-2">{l.label}</Link>)}
              <span className="hidden xl:inline text-xs text-muted-foreground ml-2">{email}</span>
              <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="h-4 w-4 mr-1"/>Sign out</Button>
            </>
          ) : (
            <>
              {PUBLIC_LINKS.map((l) => <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground px-2">{l.label}</Link>)}
              <Link href="/auth"><Button variant="ghost" size="sm">Sign in</Button></Link>
              <Link href="/auth?mode=signup"><Button size="sm">Get started</Button></Link>
            </>
          )}
        </nav>

        {/* Mobile: hamburger + sheet */}
        <div className="md:hidden flex items-center gap-2">
          {!email && <Link href="/auth?mode=signup"><Button size="sm">Start</Button></Link>}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open menu"><Menu className="h-5 w-5"/></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetTitle className="text-base">Menu</SheetTitle>
              <nav className="flex flex-col gap-1 mt-6">
                {(email ? authedLinks : PUBLIC_LINKS).map((l) => (
                  <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="px-3 py-2 rounded hover:bg-muted text-sm">{l.label}</Link>
                ))}
                {!email && (
                  <>
                    <div className="h-px bg-border my-2"/>
                    <Link href="/pricing" onClick={() => setOpen(false)} className="px-3 py-2 rounded hover:bg-muted text-sm">Pricing</Link>
                    <Link href="/auth" onClick={() => setOpen(false)} className="px-3 py-2 rounded hover:bg-muted text-sm">Sign in</Link>
                  </>
                )}
                {email && (
                  <>
                    <div className="h-px bg-border my-2"/>
                    <div className="px-3 text-xs text-muted-foreground truncate">{email}</div>
                    <button onClick={signOut} className="px-3 py-2 rounded hover:bg-muted text-sm text-left flex items-center gap-2"><LogOut className="h-4 w-4"/>Sign out</button>
                  </>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
