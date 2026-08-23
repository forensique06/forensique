import { getSupabaseAdmin } from '@/lib/supabase/admin'

// SERVER ONLY. Never import this module from a client component.
// Premium test access is determined from the database, not from client input.
export async function getTestEntitlement(userId) {
  if (!userId) return { entitled: false, isAdmin: false }

  const admin = getSupabaseAdmin()

  const [{ data: profile }, { data: subscriptions, error }] = await Promise.all([
    admin.from('profiles').select('role').eq('id', userId).maybeSingle(),
    admin
      .from('subscriptions')
      .select('status, expires_at, plans(features)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
  ])

  if (error) throw new Error(`Failed to check test entitlement: ${error.message}`)

  const isAdmin = profile?.role === 'admin'
  const hasTestPlan = (subscriptions || []).some(
    (subscription) => subscription.plans?.features?.tests === true
  )

  return { entitled: isAdmin || hasTestPlan, isAdmin }
}
