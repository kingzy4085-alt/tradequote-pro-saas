import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {

 const { data, error } = await supabase!
  .from('estimate_headers')
  .select('*')
  .order('created_at')

 if (error)
  return Response.json(error,{status:500})

 return Response.json(data ?? [])

}

export async function POST(req: Request) {

 const body = await req.json()

 const { data, error } =
  await supabase!
   .from('estimate_headers')
   .insert([body])
   .select()

 if (error)
  return Response.json(error,{status:500})

 return Response.json(data)

}
