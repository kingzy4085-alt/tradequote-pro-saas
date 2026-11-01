import { hasAccess } from './rbac'

export function protect(
 role:string,
 feature:string
){

 if(!hasAccess(role,feature))
   throw new Error('Unauthorized')

}
