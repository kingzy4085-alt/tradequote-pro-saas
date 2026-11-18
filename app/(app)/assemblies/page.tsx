import { notFound } from 'next/navigation';
import { ASSEMBLY_COLUMNS, ASSEMBLY_LIST_LIMIT, toAssembly } from '@/lib/assemblies';
import { getPageContext } from '@/lib/context';
import { getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';
import AssembliesManager from './assemblies-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Assemblies · TradeQuote PRO' };

export default async function AssembliesPage() {
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  // Assemblies feed estimates, so they follow the estimate roles
  const mod = getModule('estimates')!;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const { data, error } = await ctx.supabase.from('assemblies').select(ASSEMBLY_COLUMNS).order('name').order('id').limit(ASSEMBLY_LIST_LIMIT);
  if (error) throw new Error('Could not load your assemblies. Try again in a moment.');

  return (
    <AssembliesManager
      initial={(data ?? []).map((row) => toAssembly(row as unknown as Parameters<typeof toAssembly>[0]))}
      canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)}
    />
  );
}
