import { supabase } from '@/lib/supabase'
import { protect } from '@/lib/auth/protect'

export async function GET(){

 protect('owner','projects')

 return Response.json({
  status:'authorized'
 })

}
