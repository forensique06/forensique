'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { LogOut, Menu, ChevronDown } from 'lucide-react'

const PUBLIC_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/notes', label: 'Notes' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
]

export default function SiteHeader() {
  const supabase = getSupabaseBrowser()

  const [email, setEmail] = useState(null)
  const [fullName, setFullName] = useState(null)
  const [role, setRole] = useState(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let mounted = true

    async function loadUser(user) {
      if (!mounted) return

      if (!user) {
        setEmail(null)
        setFullName(null)
        setRole(null)
        return
      }

      setEmail(user.email ?? null)

      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .maybeSingle()

      if (!mounted) return

      setFullName(prof?.full_name ?? null)
      setRole(prof?.role ?? 'student')
    }

    supabase.auth.getUser().then(({ data }) => {
      loadUser(data?.user ?? null)
    })

    const {
      data: sub,
    } = supabase.auth.onAuthStateChange((_event, session) => {
      loadUser(session?.user ?? null)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
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
    ...(role === 'admin'
      ? [{ href: '/admin/import', label: 'Admin' }]
      : []),
  ]

  const displayName = fullName?.trim() || 'Account'

  return (
    <header className="border-b border-border sticky top-0 z-30 bg-background/85 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">

        {/* Brand */}
        <Link
          href={email ? '/dashboard' : '/'}
          className="flex items-center min-w-0"
          aria-label="Forensique home"
        >
          <img
            src="/brand/logos.png"
            alt="Forensique"
            className="h-12 w-auto max-w-[150px] object-contain"
          />

          {/* <span className="hidden sm:inline ml-2 text-xs font-normal text-muted-foreground whitespace-nowrap">
            · UGC NET FS Paper II
          </span> */}
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-1 text-sm">
          {email ? (
            <>
              {authedLinks.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-muted-foreground hover:text-foreground px-2"
                >
                  {l.label}
                </Link>
              ))}

              {/* User menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2 gap-1.5 font-normal"
                  >
                    <span className="max-w-[180px] truncate">
                      {displayName}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>

                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel className="font-normal">
                    <div className="text-sm font-medium truncate">
                      {displayName}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {email}
                    </div>
                  </DropdownMenuLabel>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onClick={signOut}
                    className="cursor-pointer"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              {PUBLIC_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-muted-foreground hover:text-foreground px-2"
                >
                  {l.label}
                </Link>
              ))}

              <Link href="/auth">
                <Button variant="ghost" size="sm">
                  Sign in
                </Button>
              </Link>

              <Link href="/auth?mode=signup">
                <Button size="sm">
                  Get started
                </Button>
              </Link>
            </>
          )}
        </nav>

        {/* Mobile */}
        <div className="md:hidden flex items-center gap-2">
          {!email && (
            <Link href="/auth?mode=signup">
              <Button size="sm">
                Start
              </Button>
            </Link>
          )}

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>

            <SheetContent side="right" className="w-72">
              <SheetTitle className="text-base">
                Menu
              </SheetTitle>

              <nav className="flex flex-col gap-1 mt-6">
                {(email ? authedLinks : PUBLIC_LINKS).map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="px-3 py-2 rounded hover:bg-muted text-sm"
                  >
                    {l.label}
                  </Link>
                ))}

                {!email && (
                  <>
                    <div className="h-px bg-border my-2" />

                    <Link
                      href="/pricing"
                      onClick={() => setOpen(false)}
                      className="px-3 py-2 rounded hover:bg-muted text-sm"
                    >
                      Pricing
                    </Link>

                    <Link
                      href="/auth"
                      onClick={() => setOpen(false)}
                      className="px-3 py-2 rounded hover:bg-muted text-sm"
                    >
                      Sign in
                    </Link>
                  </>
                )}

                {email && (
                  <>
                    <div className="h-px bg-border my-2" />

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="w-full px-3 py-2 rounded hover:bg-muted text-sm text-left flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            {displayName}
                          </span>
                          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </DropdownMenuTrigger>

                      <DropdownMenuContent
                        align="end"
                        side="top"
                        className="w-64"
                      >
                        <DropdownMenuLabel className="font-normal">
                          <div className="text-sm font-medium truncate">
                            {displayName}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 break-all">
                            {email}
                          </div>
                        </DropdownMenuLabel>

                        <DropdownMenuSeparator />

                        <DropdownMenuItem
                          onClick={signOut}
                          className="cursor-pointer"
                        >
                          <LogOut className="h-4 w-4" />
                          Sign out
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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