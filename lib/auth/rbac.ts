import { Permissions } from './permissions'

export function hasAccess(
 role:string,
 feature:string
){

 const allowed =
   (Permissions as any)[role] ?? []

 if(allowed.includes('*'))
   return true

 return allowed.includes(feature)

}
