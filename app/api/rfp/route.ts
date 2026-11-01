import { supabase } from '@/lib/supabase'

export async function GET() {

  if (!supabase)
    return Response.json({ error: 'Database unavailable' }, { status: 500 })

  const { data, error } = await supabase
    .from('rfp')
    .select('*')
    .order('created_at')

  if (error)
    return Response.json(error, { status: 500 })

  return Response.json(data)
}

export async function POST(req: Request) {

  if (!supabase)
    return Response.json({ error: 'Database unavailable' }, { status: 500 })

  const body = await req.json()

  const { data, error } =
    await supabase
      .from('rfp')
      .insert([body])
      .select()

  if (error)
    return Response.json(error, { status: 500 })

  return Response.json(data)
}
