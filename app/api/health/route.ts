export async function GET(){

 return Response.json({

  status:'healthy',

  environment:'production',

  version:'0.9'

 })

}
