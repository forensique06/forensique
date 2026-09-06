'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { getSupabaseBrowser } from '@/lib/supabase/browser'
import SiteHeader from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2 } from 'lucide-react'

function AuthInner() {
  const supabase = getSupabaseBrowser()
  const router = useRouter()
  const params = useSearchParams()

  const initialMode =
    params.get('mode') === 'signup' ? 'signup' : 'signin'

  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) router.replace('/dashboard')
    })
  }, [supabase, router])

  async function handleSubmit(e) {
    e.preventDefault()

    setError(null)
    setMessage(null)
    setBusy(true)

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName || null,
            },
          },
        })

        if (error) throw error

        if (data.session) {
          router.replace('/dashboard')
        } else {
          setMessage(
            'Signed up. If email confirmations are ON in Supabase, check your inbox. Otherwise sign in below.'
          )
          setMode('signin')
        }
      } else {
        const { error } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          })

        if (error) throw error

        router.replace('/dashboard')
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleGoogleSignIn() {
    setError(null)
    setMessage(null)
    setBusy(true)

    try {
      const { error } =
        await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: `${window.location.origin}/dashboard`,
          },
        })

      if (error) throw error
    } catch (err) {
      setError(err.message || String(err))
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <div className="container mx-auto px-4 py-16 flex justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">

            {/* Forensique branding */}
            <div className="flex justify-center mb-5">
              <img
                src="/brand/logos.png"
                alt="Forensique"
                className="h-20 w-auto max-w-[210px] object-contain"
              />
            </div>

            <CardTitle>
              {mode === 'signup'
                ? 'Create your Forensique account'
                : 'Sign in to Forensique'}
            </CardTitle>

            <CardDescription>
              {mode === 'signup'
                ? 'Free · no card required to start.'
                : 'Welcome back.'}
            </CardDescription>
          </CardHeader>

          <CardContent>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleGoogleSignIn}
              disabled={busy}
            >
              {busy && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Sign in with Google
            </Button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>

              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  or continue with
                </span>
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="space-y-4"
            >
              {mode === 'signup' && (
                <div>
                  <Label htmlFor="name">Full name</Label>

                  <Input
                    id="name"
                    value={fullName}
                    onChange={(e) =>
                      setFullName(e.target.value)
                    }
                    placeholder="Optional"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="email">Email</Label>

                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) =>
                    setEmail(e.target.value)
                  }
                />
              </div>

              <div>
                <Label htmlFor="password">Password</Label>

                <Input
                  id="password"
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) =>
                    setPassword(e.target.value)
                  }
                />
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {error}
                  </AlertDescription>
                </Alert>
              )}

              {message && (
                <Alert>
                  <AlertDescription>
                    {message}
                  </AlertDescription>
                </Alert>
              )}

              <Button
                className="w-full"
                disabled={busy}
              >
                {busy && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}

                {mode === 'signup'
                  ? 'Create account'
                  : 'Sign in'}
              </Button>
            </form>

            <div className="text-center text-sm text-muted-foreground mt-4">
              {mode === 'signup' ? (
                <>
                  Already have an account?{' '}
                  <button
                    className="text-primary underline"
                    onClick={() => setMode('signin')}
                  >
                    Sign in
                  </button>
                </>
              ) : (
                <>
                  New here?{' '}
                  <button
                    className="text-primary underline"
                    onClick={() => setMode('signup')}
                  >
                    Create account
                  </button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm text-muted-foreground">
          Loading…
        </div>
      }
    >
      <AuthInner />
    </Suspense>
  )
}