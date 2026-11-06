import { NextResponse } from 'next/server';
import { dbError, jsonError, requireApi } from '@/lib/api';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: { id: string } };

// The "Create project" button on an accepted proposal: makes the project and its job cost row, or returns the project it already has.
export async function POST(_request: Request, { params }: Params) {
  if (!uuidSchema.safeParse(params.id).success) return jsonError(404, 'Not found');
  const ctx = await requireApi({ minRank: getModule('projects')!.write, write: true });
  if (ctx instanceof Response) return ctx;

  const { data, error } = await ctx.supabase.rpc('create_project_from_proposal', { p_proposal: params.id });
  if (error) return dbError(error, 'creating the project');
  return NextResponse.json({ data: { id: data } }, { status: 201 });
}
