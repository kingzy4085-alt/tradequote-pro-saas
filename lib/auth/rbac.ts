const RoleHierarchy: Record<string, number> = {
  owner: 5,
  admin: 4,
  project_manager: 3,
  foreman: 2,
  electrician: 1,
  client: 0,
};

export function hasAccess(role: string, required: string): boolean {
  return (RoleHierarchy[role] ?? -1) >= (RoleHierarchy[required] ?? 0);
}

export function requireRole(
  userRole: string,
  required: string
) {
  if (!hasAccess(userRole, required)) {
    throw new Error('Forbidden');
  }
}

