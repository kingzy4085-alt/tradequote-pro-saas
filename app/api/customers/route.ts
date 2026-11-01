import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {

 const { data,error } = await supabase!
  .from('customers')
  .select('*')
  .order('created_at')

 if(error)
  return Response.json(error,{status:500})

 return Response.json(data ?? [])

}

export async function POST(req:Request){

 const body = await req.json()

 const { data,error } = await supabase!
  .from('customers')
  .insert([body])
  .select()

 if(error)
  return Response.json(error,{status:500})

 return Response.json(data)

}

export async function PUT(req:Request){

 const body = await req.json()

 const { data,error } = await supabase!
  .from('customers')
  .update(body)
  .eq('id',body.id)
  .select()

 if(error)
  return Response.json(error,{status:500})

 return Response.json(data)

}

export async function DELETE(req:Request){

 const body = await req.json()

 const { error } = await supabase!
  .from('customers')
  .delete()
  .eq('id',body.id)

 if(error)
  return Response.json(error,{status:500})

 return Response.json({success:true})

}
