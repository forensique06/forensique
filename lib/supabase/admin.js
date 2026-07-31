import { createClient } from '@supabase/supabase-js'

// SERVER ONLY — do not import from a client component.
// Uses SUPABASE_SERVICE_ROLE_KEY, bypasses RLS.
let _admin = null

export function getSupabaseAdmin() {
  if (_admin) return _admin
  _admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  )
  return _admin
}
