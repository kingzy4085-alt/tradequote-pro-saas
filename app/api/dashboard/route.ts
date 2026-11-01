import { supabase } from '@/lib/supabase'

export async function GET(){

 return Response.json({

  activeProjects:0,

  openRFIs:0,

  openEstimates:0,

  totalRevenue:0,

  margin:0

 })

}
