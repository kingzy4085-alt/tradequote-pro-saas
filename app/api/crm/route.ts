import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {

 if (!supabase) {
   return Response.json([], { status: 200 })
 }

 const { data, error } = await supabase
   .from('crm')
   .select('*')

 if (error) {
   return Response.json(
     { error: error.message },
     { status: 500 }
   )
 }

 return Response.json(data ?? [])

}
