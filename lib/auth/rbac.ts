const RoleHierarchy = {

 owner:5,

 admin:4,

 project_manager:3,

 foreman:2,

 electrician:1,

 client:0

}

export function requireRole(
 userRole:string,
 required:string
){

 if(
  RoleHierarchy[userRole]
  <
  RoleHierarchy[required]
 ){

  throw new Error('Forbidden')

 }

}
