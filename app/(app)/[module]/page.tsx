import { notFound, redirect } from 'next/navigation';
import ModulePage from '@/components/module-page';
import { getPageContext } from '@/lib/context';
import { MODULE_REDIRECTS, getModule } from '@/lib/modules';
import { hasRank } from '@/lib/roles';

export const dynamic = 'force-dynamic';

export function generateMetadata({ params }: { params: { module: string } }) {
  const mod = getModule(params.module);
  return { title: mod ? `${mod.label} · TradeQuote PRO` : 'TradeQuote PRO' };
}

export default async function ModuleRoute({ params, searchParams }: { params: { module: string }; searchParams: { project?: string | string[]; new?: string | string[]; status?: string | string[]; view?: string | string[]; q?: string | string[] } }) {
  const alias = MODULE_REDIRECTS[params.module];
  if (alias) redirect(`/${alias}`);

  const mod = getModule(params.module);
  if (!mod) notFound();

  const result = await getPageContext();
  if (result.status !== 'ok') redirect('/login');
  const { ctx } = result;
  if (!hasRank(ctx.role, mod.read)) notFound();

  return <ModulePage slug={mod.slug} canWrite={ctx.canWrite && hasRank(ctx.role, mod.write)} canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)} initialProject={typeof searchParams.project === 'string' ? searchParams.project : undefined} initialStatuses={[searchParams.status ?? []].flat()} initialView={typeof searchParams.view === 'string' ? searchParams.view : undefined} initialQuery={typeof searchParams.q === 'string' ? searchParams.q.slice(0, 100) : undefined} startNew={searchParams.new === '1'} />;
}
