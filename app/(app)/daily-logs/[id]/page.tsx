import { notFound } from 'next/navigation';
import { getContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import DailyLogEditor, { type DailyLog } from './daily-log-editor';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Daily Log · TradeQuote PRO' };

export default async function DailyLogPage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const mod = getModule('daily-logs')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const { data: log } = await ctx.supabase.from(mod.table).select('*').eq('id', params.id).maybeSingle();
  if (!log) notFound();

  return (
    <DailyLogEditor
      initial={log as DailyLog}
      statuses={mod.statuses}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
      canReopen={ctx.canWrite && hasRank(ctx.role, 2)}
      canDelete={hasRank(ctx.role, mod.remove)}
    />
  );
}
