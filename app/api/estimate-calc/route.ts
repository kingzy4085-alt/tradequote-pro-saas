export async function POST(req: Request) {

 const body = await req.json()

 const total =
  (body.lines ?? []).reduce(
   (sum:number,line:any)=>
    sum +
    (
      Number(line.quantity || 0) *
      Number(line.unit_price || 0)
    ),
   0
  )

 return Response.json({
  total
 })

}
