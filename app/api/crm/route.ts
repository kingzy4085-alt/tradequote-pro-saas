import { supabase } from '@/lib/supabase'
import { authorize } from '@/lib/auth/authorize'

export async function GET(){

 const ctx =
   await authorize('electrician')

 const { data,error }
 =
 await supabase!
 .from('crm')
 .select('*')
 .eq('company_id',ctx.companyId)

 if(error)
  return Response.json(error,{
   status:500
  })

 return Response.json(data)

}
