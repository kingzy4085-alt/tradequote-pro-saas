import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { ATTACHMENT_COLUMNS, attachmentFolder, attachmentModuleDef, recordNoun, type Attachment } from '@/lib/attachments';
import { getPageContext } from '@/lib/context';
import { ROLES, ROLE_LABEL, ROLE_RANK, hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';
import FilesManager from './files-manager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Files · TradeQuote PRO' };

// The files on one drawing, document or Site Vault item: drop them in, open them, delete them.
// Who sees what follows the module's own read, write and delete ranks.
export default async function FilesPage({ params }: { params: { module: string; id: string } }) {
  const mod = attachmentModuleDef(params.module);
  if (!mod || !uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const noun = recordNoun(mod);
  const { data: record, error } = await ctx.supabase.from(mod.table).select('id, title').eq('id', params.id).maybeSingle();
  if (error) throw new Error(`Could not load this ${noun}. Try again in a moment.`);
  if (!record) notFound();
  const { data: files, error: filesError } = await ctx.supabase
    .from('record_attachments')
    .select(ATTACHMENT_COLUMNS)
    .eq('module', mod.slug)
    .eq('record_id', params.id)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (filesError) throw new Error('Could not load the files. Try again in a moment.');

  const roleCanAdd = hasRank(ctx.role, mod.write);
  const adder = ROLES.find((r) => ROLE_RANK[r] === mod.write);
  const viewOnlyReason = !roleCanAdd
    ? `You can open these files. Adding them takes a ${adder ? ROLE_LABEL[adder].toLowerCase() : 'higher role'} or above.`
    : !ctx.canWrite
      ? 'Your trial or subscription has ended, so files can be opened but not added or deleted.'
      : undefined;

  return (
    <>
      <PageHeader title={(record as { title: string }).title} subtitle={`Files on this ${noun}`} back={{ href: `/${mod.slug}`, label: `Back to ${mod.label}` }} />
      <FilesManager
        module={mod.slug}
        recordId={params.id}
        folder={attachmentFolder(ctx.company.id, mod.slug, params.id)}
        initialFiles={(files ?? []) as unknown as Attachment[]}
        canUpload={ctx.canWrite && roleCanAdd}
        canDelete={ctx.canWrite && hasRank(ctx.role, mod.remove)}
        viewOnlyReason={viewOnlyReason}
      />
    </>
  );
}
