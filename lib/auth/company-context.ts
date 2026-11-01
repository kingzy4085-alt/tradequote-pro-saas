import { createSupabaseServerClient }
from './supabase-server'

export async function getCompanyContext(){

 const supabase =
   createSupabaseServerClient()

 const {
   data:{ user }
 } = await supabase.auth.getUser()

 if(!user)
   throw new Error('Unauthenticated')

 const { data } = await supabase

   .from('company_users')

   .select('company_id,role')

   .eq('user_id',user.id)

   .single()

 if(!data)
   throw new Error('Company mapping missing')

 return data

}
