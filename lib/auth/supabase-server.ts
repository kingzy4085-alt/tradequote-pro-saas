import { createClient } from '@supabase/supabase-js'

export function createSupabaseServerClient() {
 const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
 const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ??
             process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
 if (!url || !key) {
   console.error('Supabase is not configured; server auth is unavailable.')
   return null
 }
 return createClient(url, key)
}