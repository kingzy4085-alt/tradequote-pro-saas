import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, PageHeader, Panel, StatCard } from '@/components/ui';
import { PROFILE_SECTIONS, clientMoney, mailHref, profileAccess, telHref, type ProfileSection } from '@/lib/client-profile';
import { getPageContext } from '@/lib/context';
import { plural } from '@/lib/dashboard';
import { detailHref } from '@/lib/detail-pages';
import { formatMoney, formatValue } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { uuidSchema } from '@/lib/validation';
import ClientActions from './client-actions';
import ClientNotes from './client-notes';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Client · TradeQuote PRO' };

// The figures are summed from these rows, so the read is wide; the page lists the newest few of each
const SUM_ROWS = 1000;
const SHOWN_ROWS = 25;
type Row = Record<string, unknown> & { id: string; title: string; status: string };

const CONTACT_LINK = 'min-h-[48px] lg:min-h-0 inline-flex items-center text-amber-400 font-semibold hover:underline break-all';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</dt>
      <dd className="text-white mt-0.5 break-words">{children}</dd>
    </div>
  );
}

function Section({ section, rows, showMoney }: { section: ProfileSection; rows: Row[]; showMoney: boolean }) {
  const mod = getModule(section.slug)!;
  const shown = rows.slice(0, SHOWN_ROWS);
  return (
    <section id={section.slug} className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 border-b border-slate-800">
        <h2 className="text-lg font-bold text-white">
          {mod.label} <span className="text-sm font-semibold text-slate-500">{rows.length >= SUM_ROWS ? `${SUM_ROWS}+` : rows.length}</span>
        </h2>
        <Link href={`/${section.slug}`} className="min-h-[48px] lg:min-h-0 inline-flex items-center text-sm font-semibold text-amber-400 hover:underline">
          Open {mod.label}
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="p-8 text-center text-slate-400">No {mod.label.toLowerCase()} linked to this client yet.</p>
      ) : (
        <ul className="divide-y divide-slate-800">
          {shown.map((r) => {
            const date = r[section.dateKey];
            const details = [
              section.slug === 'invoices' && r.invoice_number ? String(r.invoice_number) : null,
              section.slug === 'projects' && r.site ? String(r.site) : null,
              date ? `${section.dateLabel}: ${formatValue('date', date)}` : null,
            ].filter(Boolean);
            return (
              <li key={r.id}>
                <Link href={detailHref(section.slug, r.id) ?? `/${section.slug}`} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-4 hover:bg-slate-800/50 transition-colors">
                  <div className="min-w-0">
                    <p className="font-medium text-white break-words">{r.title}</p>
                    {details.length > 0 && <p className="text-xs text-slate-400 mt-0.5 break-words">{details.join(' · ')}</p>}
                  </div>
                  <span className="shrink-0 flex items-center gap-3">
                    {showMoney && section.amountKey && <span className="font-semibold text-white">{formatMoney(r[section.amountKey] ?? 0)}</span>}
                    <Badge>{r.status}</Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {rows.length > shown.length && (
        <p className="p-4 border-t border-slate-800 text-sm text-slate-400">
          Showing the newest {shown.length}. The rest are in {mod.label}.
        </p>
      )}
    </section>
  );
}

export default async function ClientProfilePage({ params }: { params: { id: string } }) {
  if (!uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status !== 'ok') notFound();
  const { ctx } = result;
  const access = profileAccess(ctx.role);
  if (!access) notFound();

  const { data: found, error } = await ctx.supabase.from('crm').select('id, title, status, notes, contact_person, email, phone, project_site').eq('id', params.id).maybeSingle();
  if (error) throw new Error('Could not load this client.');
  if (!found) notFound();
  const client = found as unknown as Row;

  // Linked by client_id only. A record that just has this client's name typed on it is not shown.
  const loaded = await Promise.all(
    access.sections.map(async (section) => {
      const { data, error: listError } = await ctx.supabase
        .from(getModule(section.slug)!.table)
        .select(section.columns)
        .eq('client_id', params.id)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(SUM_ROWS);
      if (listError) throw new Error(`Could not load this client's ${getModule(section.slug)!.label.toLowerCase()}.`);
      return [section.slug, (data ?? []) as unknown as Row[]] as const;
    })
  );
  const rowsOf = new Map<string, Row[]>(loaded);
  const money = clientMoney({ estimates: rowsOf.get('estimates'), proposals: rowsOf.get('proposals'), invoices: rowsOf.get('invoices') });
  const tel = telHref(client.phone);
  const mail = mailHref(client.email);
  const canCreate = ctx.canWrite ? access.canCreate : [];

  return (
    <>
      <PageHeader title={client.title} subtitle={[client.contact_person, client.project_site].filter(Boolean).join(' · ') || undefined} back={{ href: '/crm', label: 'Back to Clients' }} />

      <div className="space-y-6">
        <Panel>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-sm">
            <Detail label="Status">
              <Badge>{client.status}</Badge>
            </Detail>
            <Detail label="Contact">{client.contact_person ? String(client.contact_person) : '—'}</Detail>
            <Detail label="Phone">
              {tel ? (
                <a href={tel} className={CONTACT_LINK}>
                  {String(client.phone)}
                </a>
              ) : (
                String(client.phone ?? '') || '—'
              )}
            </Detail>
            <Detail label="Email">
              {mail ? (
                <a href={mail} className={CONTACT_LINK}>
                  {String(client.email)}
                </a>
              ) : (
                String(client.email ?? '') || '—'
              )}
            </Detail>
            <Detail label="Site / facility">{client.project_site ? String(client.project_site) : '—'}</Detail>
          </dl>
          {canCreate.length > 0 && (
            <div className="mt-5 pt-5 border-t border-slate-800">
              <ClientActions client={{ id: client.id, title: client.title }} canCreate={canCreate} />
            </div>
          )}
        </Panel>

        {(access.pipeline || access.finance) && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {access.finance && <StatCard label="Lifetime value" value={formatMoney(money.lifetimeValue)} caption="Every paid invoice" />}
            {access.pipeline && (
              <StatCard label="Open pipeline" value={formatMoney(money.pipeline)} caption={`${plural(money.sentProposals, 'sent proposal')}, ${plural(money.submittedEstimates, 'submitted estimate')}`} />
            )}
            {access.finance && (
              <StatCard
                label="Outstanding"
                value={formatMoney(money.outstanding)}
                caption={`${plural(money.unpaidInvoices, 'unpaid invoice')}${money.overdueInvoices ? `, ${money.overdueInvoices} overdue` : ''}`}
              />
            )}
          </div>
        )}

        <Panel title="Notes">
          <ClientNotes clientId={client.id} initial={String(client.notes ?? '')} canEdit={ctx.canWrite && access.canEditNotes} />
        </Panel>

        {PROFILE_SECTIONS.filter((s) => rowsOf.has(s.slug)).map((section) => (
          <Section key={section.slug} section={section} rows={rowsOf.get(section.slug)!} showMoney={section.slug === 'invoices' ? access.finance : access.pipeline} />
        ))}
      </div>
    </>
  );
}
