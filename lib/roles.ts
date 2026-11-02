export const ROLES = ['owner', 'admin', 'project_manager', 'foreman', 'electrician'] as const;
export type Role = (typeof ROLES)[number];

/** Higher rank can do everything a lower rank can. Mirrors public.role_rank() in the database. */
export const ROLE_RANK: Record<Role, number> = {
  owner: 5,
  admin: 4,
  project_manager: 3,
  foreman: 2,
  electrician: 1,
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  project_manager: 'Project Manager',
  foreman: 'Foreman',
  electrician: 'Electrician',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function hasRank(role: Role, minimum: number): boolean {
  return ROLE_RANK[role] >= minimum;
}
