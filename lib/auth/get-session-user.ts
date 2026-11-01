import { createSupabaseServerClient }
from './supabase-server'

export async function getSessionUser() {

 const supabase =
   createSupabaseServerClient()

 const {
   data: { user }
 } = await supabase.auth.getUser()

 return user

}
