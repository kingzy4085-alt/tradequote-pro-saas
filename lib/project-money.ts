// What a job is worth is for project managers and up. The database hides these columns from everyone
// signed in (they are all one database role) and serves them through project_money, the same way
// timecards hide pay. See 20261104000310_contract_rules.sql.
import { hasRank, ROLE_RANK, type Role } from '@/lib/roles';

export const PROJECT_MONEY_RANK = ROLE_RANK.project_manager;

export interface ProjectMoney {
  id: string;
  contract_value: number | string | null;
  approved_changes: number | string | null;
  revised_contract: number | string | null;
}

interface RpcClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- works with both the real and the fake client
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: any }>;
}

/**
 * Fills in the contract money on these project rows for those who may see it. Below that the rows
 * come back as they are, with no call the database would refuse. A failure is returned, not hidden:
 * a form filled from a row missing its contract would save a blank one.
 */
export async function withProjectMoney<T extends { id: string }>(supabase: RpcClient, role: Role, rows: T[]): Promise<{ rows: T[] } | { error: { code?: string; message: string } }> {
  if (rows.length === 0 || !hasRank(role, PROJECT_MONEY_RANK)) return { rows };
  const { data, error } = await supabase.rpc('project_money', { p_ids: rows.map((r) => r.id) });
  if (error) return { error };
  const money = new Map((Array.isArray(data) ? (data as ProjectMoney[]) : []).map((m) => [m.id, m]));
  return { rows: rows.map((r) => ({ ...r, ...money.get(r.id) })) };
}

/** Fills in a change order's money the same way, from change_order_money. See 20261104000320_review_fixes.sql. */
export async function withChangeOrderMoney<T extends { id: string }>(supabase: RpcClient, role: Role, rows: T[]): Promise<{ rows: T[] } | { error: { code?: string; message: string } }> {
  if (rows.length === 0 || !hasRank(role, PROJECT_MONEY_RANK)) return { rows };
  const { data, error } = await supabase.rpc('change_order_money', { p_ids: rows.map((r) => r.id) });
  if (error) return { error };
  const money = new Map((Array.isArray(data) ? (data as { id: string }[]) : []).map((m) => [m.id, m]));
  return { rows: rows.map((r) => ({ ...r, ...money.get(r.id) })) };
}

/** Adds the columns only a rank-gated function can read to this module's rows, for those who may see them. */
export async function withRestrictedMoney<T extends { id: string }>(slug: string, supabase: RpcClient, role: Role, rows: T[]): Promise<{ rows: T[] } | { error: { code?: string; message: string } }> {
  if (slug === 'projects') return withProjectMoney(supabase, role, rows);
  if (slug === 'change-orders') return withChangeOrderMoney(supabase, role, rows);
  return { rows };
}

/** The company's labour rate and default markup, for project managers and up. Everyone else's profile comes back without them. */
export async function withCompanyRates<T extends object>(supabase: RpcClient, role: Role, profile: T): Promise<{ profile: T } | { error: { code?: string; message: string } }> {
  if (!hasRank(role, PROJECT_MONEY_RANK)) return { profile };
  const { data, error } = await supabase.rpc('company_rates', {});
  if (error) return { error };
  return { profile: data && typeof data === 'object' ? { ...profile, ...data } : profile };
}
