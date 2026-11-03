import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Signed-in user's client for the current request; database row security limits it to their company.
export function createUserClient() {
  const store = cookies();
  return createServerClient(supabaseUrl!, anonKey!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Server components can't set cookies; middleware refreshes the session instead
        }
      },
    },
  });
}

// API routes call supabase.from(...); each call uses the requesting user's session.
export const supabase =
  supabaseUrl && anonKey
    ? {
        from: (table: string) => createUserClient().from(table),
        rpc: (fn: string, args?: Record<string, unknown>) => createUserClient().rpc(fn, args),
        get auth() {
          return createUserClient().auth;
        },
      }
    : null;

// Full-access client: only for the public founding-list signup.
export const supabaseAdmin =
  supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey) : null;
