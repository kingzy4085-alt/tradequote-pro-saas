export const Roles = {
 OWNER: 'owner',
 ADMIN: 'admin',
 PROJECT_MANAGER: 'project_manager',
 FOREMAN: 'foreman',
 ELECTRICIAN: 'electrician',
 CLIENT: 'client'
} as const

export type Role =
 typeof Roles[keyof typeof Roles]
