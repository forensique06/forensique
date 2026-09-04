import { getSupabaseAdmin } from '@/lib/supabase/admin'

// SERVER ONLY. Never import this module from a client component.
// Test access is determined from the database, not from client input.
export async function getTestEntitlement(userId, testId) {
  if (!userId || !testId) {
    return {
      allowed: false,
      entitled: false,
      isAdmin: false,
    }
  }

  const admin = getSupabaseAdmin()

  const [
    { data: profile },
    { data: test, error: testError },
    { data: subscriptions, error: subscriptionError },
  ] = await Promise.all([
    admin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle(),

    admin
      .from('tests')
      .select('is_premium')
      .eq('id', testId)
      .maybeSingle(),

    admin
      .from('subscriptions')
      .select('status, expires_at, plans(features)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString()),
  ])

  if (testError) {
    throw new Error(`Failed to check test access: ${testError.message}`)
  }

  if (subscriptionError) {
    throw new Error(
      `Failed to check test entitlement: ${subscriptionError.message}`
    )
  }

  const isAdmin = profile?.role === 'admin'

  // Admins can access every test.
  if (isAdmin) {
    return {
      allowed: true,
      entitled: true,
      isAdmin: true,
    }
  }

  // Free tests are accessible to authenticated users.
  if (test?.is_premium === false) {
    return {
      allowed: true,
      entitled: false,
      isAdmin: false,
    }
  }

  const hasTestPlan = (subscriptions || []).some(
    (subscription) => subscription.plans?.features?.tests === true
  )

  return {
    allowed: hasTestPlan,
    entitled: hasTestPlan,
    isAdmin: false,
  }
}