import { createSupabaseServerClient }
from './supabase-server'

export async function getSessionUser() {
 const supabase = createSupabaseServerClient()
 if (!supabase)
   return null
 const {
   data: { user }
 } = await supabase.auth.getUser()
 return user
}