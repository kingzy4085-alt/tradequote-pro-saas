import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(){

 return Response.json({

  activeProjects:0,

  openEstimates:0,

  openRFIs:0,

  margin:0,

  revenue:0

 })

}
