import { getSupabaseAdmin } from '@/lib/supabase/admin'

// SERVER ONLY. Never import this module from a client component.
//
// Access rules:
// - Admins can access everything.
// - Free tests are available to every authenticated user.
// - Premium tests require an active Test Series subscription.
// - "custom" is a special entitlement check for the custom-test builder.
export async function getTestEntitlement(userId, testId = null) {
  if (!userId) {
    return {
      allowed: false,
      entitled: false,
      isAdmin: false,
      reason: 'Not authenticated.',
    }
  }

  const admin = getSupabaseAdmin()

  const [{ data: profile }, { data: subscriptions, error: subscriptionError }] =
    await Promise.all([
      admin
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .maybeSingle(),

      admin
        .from('subscriptions')
        .select('status, expires_at, plans(features)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString()),
    ])

  if (subscriptionError) {
    throw new Error(
      `Failed to check test entitlement: ${subscriptionError.message}`
    )
  }

  const isAdmin = profile?.role === 'admin'

  const hasTestPlan = (subscriptions || []).some(
    (subscription) => subscription.plans?.features?.tests === true
  )

  // --------------------------------------------------------------------------
  // Custom-test builder
  //
  // "custom" is not a UUID/test row. It is a special entitlement check.
  // --------------------------------------------------------------------------

  if (testId === 'custom') {
    const allowed = isAdmin || hasTestPlan

    return {
      allowed,
      entitled: allowed,
      isAdmin,
      reason: allowed
        ? undefined
        : 'An active Test Series subscription is required for custom tests.',
    }
  }

  // --------------------------------------------------------------------------
  // General entitlement check with no specific test.
  //
  // Used when the caller only needs to know whether the user has the
  // Test Series entitlement.
  // --------------------------------------------------------------------------

  if (!testId) {
    const entitled = isAdmin || hasTestPlan

    return {
      allowed: entitled,
      entitled,
      isAdmin,
      reason: entitled
        ? undefined
        : 'An active Test Series subscription is required.',
    }
  }

  // --------------------------------------------------------------------------
  // Specific test access
  // --------------------------------------------------------------------------

  const { data: test, error: testError } = await admin
    .from('tests')
    .select('id, is_premium, status')
    .eq('id', testId)
    .maybeSingle()

  if (testError) {
    throw new Error(
      `Failed to load test entitlement: ${testError.message}`
    )
  }

  if (!test) {
    return {
      allowed: false,
      entitled: false,
      isAdmin,
      reason: 'Test not found.',
    }
  }

  if (test.status !== 'published') {
    return {
      allowed: false,
      entitled: false,
      isAdmin,
      reason: 'Test is not available.',
    }
  }

  // Admins can access every published test.
  if (isAdmin) {
    return {
      allowed: true,
      entitled: true,
      isAdmin: true,
    }
  }

  // Free tests are available to all authenticated users.
  if (test.is_premium === false) {
    return {
      allowed: true,
      entitled: false,
      isAdmin: false,
    }
  }

  // Premium tests require Test Series entitlement.
  if (hasTestPlan) {
    return {
      allowed: true,
      entitled: true,
      isAdmin: false,
    }
  }

  return {
    allowed: false,
    entitled: false,
    isAdmin: false,
    reason: 'An active Test Series subscription is required for this test.',
  }
}