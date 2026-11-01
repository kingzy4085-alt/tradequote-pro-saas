import { getCompanyContext }
from './company-context'

export async function authorize(
 requiredRole:string
){

 const ctx =
   await getCompanyContext()

 return {

  companyId:ctx.company_id,

  role:ctx.role

 }

}
