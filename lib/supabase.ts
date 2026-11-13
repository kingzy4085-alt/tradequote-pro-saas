import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

function getSupabaseConfig() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  return { url, anonKey, serviceRoleKey };
}

export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) {
    console.error("Supabase is not configured; skipping server client creation.");
    return null;
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {}
      },
    },
  });
}

// Admin client bypassing RLS for webhooks and background jobs
const { url, anonKey, serviceRoleKey } = getSupabaseConfig();
const adminKey = serviceRoleKey || anonKey;
export const supabaseAdmin = url && adminKey
  ? createSupabaseClient(url, adminKey, { auth: { persistSession: false } })
  : null;

if (!supabaseAdmin) {
  console.error("Supabase is not configured; database-backed handlers will return unavailable.");
}

// Standard client alias for modules importing { supabase }
export const supabase = supabaseAdmin;