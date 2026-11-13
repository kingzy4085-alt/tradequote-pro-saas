import { createBrowserClient } from '@supabase/ssr';

export function supabaseBrowser() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  if (!url || !anonKey) {
    console.error('Supabase is not configured; browser database actions are unavailable.');
    return null as ReturnType<typeof createBrowserClient>;
  }
  return createBrowserClient(url, anonKey);
}