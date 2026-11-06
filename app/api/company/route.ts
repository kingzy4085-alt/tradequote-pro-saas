import { NextResponse } from 'next/server';
import { dbError, jsonError, readJson, requireApi } from '@/lib/api';
import { COMPANY_PROFILE_COLUMNS, CompanyProfileSchema } from '@/lib/company';
import { withCompanyRates } from '@/lib/project-money';

export const dynamic = 'force-dynamic';

export async function GET() {
  const ctx = await requireApi({ minRank: 1 });
  if (ctx instanceof Response) return ctx;
  const { data, error } = await ctx.supabase.from('companies').select(COMPANY_PROFILE_COLUMNS).eq('id', ctx.company.id).maybeSingle();
  if (error) return dbError(error, 'loading the company profile');
  const full = await withCompanyRates(ctx.supabase, ctx.role, data ?? {});
  if ('error' in full) return dbError(full.error, 'loading the company profile');
  return NextResponse.json({ data: data ? full.profile : null });
}

// Owners and admins only; the database enforces the same rule and only lets these columns change
export async function PATCH(request: Request) {
  const ctx = await requireApi({ minRank: 4 });
  if (ctx instanceof Response) return ctx;

  let body: unknown;
  try {
    body = await readJson(request, 50_000);
  } catch {
    return jsonError(400, 'Invalid request');
  }
  const parsed = CompanyProfileSchema.safeParse(body);
  if (!parsed.success) {
    const details = Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message]));
    return jsonError(400, 'Please fix the highlighted fields', details);
  }
  if (!Object.keys(parsed.data).length) return jsonError(400, 'Nothing to update');

  const { data, error } = await ctx.supabase.from('companies').update(parsed.data).eq('id', ctx.company.id).select(COMPANY_PROFILE_COLUMNS).maybeSingle();
  if (error) return dbError(error, 'saving the company profile');
  if (!data) return jsonError(403, 'Only the owner or an admin can change company details');
  const full = await withCompanyRates(ctx.supabase, ctx.role, data);
  if ('error' in full) return dbError(full.error, 'saving the company profile');
  return NextResponse.json({ data: full.profile });
}
