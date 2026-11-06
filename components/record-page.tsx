import { notFound } from 'next/navigation';
import RecordEditor from '@/components/record-editor';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { REOPEN_RANK, recordConfig, type RecordRow } from '@/lib/records';
import { ROLE_RANK, hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';

/** The detail page of a safety record. Each module's route is one line that renders this. */
export default async function RecordPage({ slug, id }: { slug: string; id: string }) {
  const mod = getModule(slug);
  if (!mod || !recordConfig(slug) || !uuidSchema.safeParse(id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const { data, error } = await ctx.supabase.from(mod.table).select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`Could not load ${mod.label}`);
  if (!data) notFound();

  return (
    <RecordEditor
      slug={slug}
      initial={data as RecordRow}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
      canReopen={ctx.canWrite && hasRank(ctx.role, REOPEN_RANK)}
      canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)}
      userRank={ROLE_RANK[ctx.role]}
    />
  );
}
