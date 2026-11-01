import { supabase } from '@/lib/supabase'

export async function GET() {

 return Response.json({
   metric:'open-estimates',
   status:'online'
 })

}
