'use client'

import { createBrowserClient } from '@supabase/ssr'

let _client = null

export function getSupabaseBrowser() {
  if (_client) return _client
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
  return _client
}
