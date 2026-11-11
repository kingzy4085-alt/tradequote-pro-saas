import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import PrintButton from '@/app/print/proposal/[id]/print-button';
import { getPageContext } from '@/lib/context';
import { JOB_PHOTOS_BUCKET } from '@/lib/daily-log';
import { detailHref } from '@/lib/detail-pages';
import { formatValue } from '@/lib/format';
import { getModule } from '@/lib/modules';
import { Letterhead, loadLetterhead } from '@/lib/print';
import { checklistChoices, formatSignedAt, isLocked, recordConfig, type RecordRow } from '@/lib/records';
import { hasRank } from '@/lib/roles';
import { uuidSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Print Record · TradeQuote PRO' };

// What goes on the document name, one per record type.
const DOCUMENT_NAMES: Record<string, string> = {
  'loto-permits': 'LOTO Permit',
  'tailgate-logs': 'Tailgate Meeting',
  'safety-inspections': 'Safety Inspection',
};

export default async function PrintRecord({ params }: { params: { module: string; id: string } }) {
  const config = recordConfig(params.module);
  const mod = getModule(params.module);
  if (!config || !mod || !uuidSchema.safeParse(params.id).success) notFound();
  const result = await getPageContext();
  if (result.status === 'signed-out') redirect('/login');
  if (result.status !== 'ok') redirect('/onboarding');
  const { ctx } = result;
  if (!hasRank(ctx.role, mod.read)) notFound();

  const { data, error } = await ctx.supabase.from(mod.table).select('*').eq('id', params.id).maybeSingle();
  if (error) throw new Error(`Could not load ${mod.label}`);
  if (!data) notFound();
  const record = data as RecordRow;
  const signatures = record.signatures ?? [];
  const photos = record.photos ?? [];

  const projectId = record.project_id as string | null;
  const [company, projectResult, photoResult] = await Promise.all([
    loadLetterhead(ctx),
    projectId ? ctx.supabase.from('projects').select('title').eq('id', projectId).maybeSingle() : Promise.resolve({ data: null }),
    photos.length ? ctx.supabase.storage.from(JOB_PHOTOS_BUCKET).createSignedUrls(photos, 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] }),
  ]);
  const projectTitle = (projectResult.data as { title: string } | null)?.title;
  const photoUrls = new Map((photoResult.data ?? []).map((p) => [p.path, p.signedUrl]));
  const date = record[config.dateKey] as string | null;
  const locked = isLocked(config, signatures);

  const rows = mod.fields.filter((f) => f.type !== 'list' && !f.legacy && f.type !== 'textarea');
  const longRows = mod.fields.filter((f) => f.type === 'textarea');

  return (
    <main className="min-h-screen bg-white text-black">
      <div className="max-w-4xl mx-auto p-4 sm:p-8">
        <Letterhead company={company} document={DOCUMENT_NAMES[config.slug]}>
          {date && <p>{formatValue('date', date)}</p>}
          <p className="font-semibold">{record.status}</p>
        </Letterhead>

        <h2 className="text-xl font-bold mt-6">{record.title}</h2>
        {!locked && <p className="text-sm mt-1">Not final: this {config.noun} has not had its last sign-off.</p>}

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 mt-4">
          {rows.map((f) => (
            <div key={f.key} className="border-b border-gray-200 pb-1">
              <dt className="text-xs uppercase tracking-wider text-gray-500">{f.label}</dt>
              <dd>{f.type === 'project' ? (projectTitle ?? '—') : formatValue(f.type, record[f.key])}</dd>
            </div>
          ))}
        </dl>

        {longRows.map((f) =>
          record[f.key] ? (
            <section key={f.key} className="mt-4 break-inside-avoid">
              <h3 className="font-bold">{f.label}</h3>
              <p className="whitespace-pre-line">{String(record[f.key])}</p>
            </section>
          ) : null
        )}
        {record.notes && (
          <section className="mt-4 break-inside-avoid">
            <h3 className="font-bold">Notes</h3>
            <p className="whitespace-pre-line">{record.notes}</p>
          </section>
        )}

        {config.checklists.map((list) => {
          const picked = (record[list.key] as string[] | null) ?? [];
          return (
            <section key={list.key} className="mt-5 break-inside-avoid">
              <h3 className="font-bold mb-1">{list.label}</h3>
              <ul className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
                {checklistChoices(list, picked).map((option) => (
                  <li key={option}>
                    <span aria-hidden="true">{picked.includes(option) ? '☑' : '☐'}</span> {option}
                    <span className="sr-only">{picked.includes(option) ? ' (yes)' : ' (no)'}</span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="mt-6">
          <h3 className="font-bold text-lg border-b border-black pb-1">Sign-offs</h3>
          {config.slots.map((slot) => {
            const signed = signatures.filter((s) => s.slot === slot.key);
            return (
              <div key={slot.key} className="mt-3">
                <p className="font-semibold">{slot.label}</p>
                <p className="text-sm text-gray-700">{slot.attest}</p>
                {signed.length === 0 ? (
                  <p className="text-sm mt-1">Not signed.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                    {signed.map((s) => (
                      <div key={`${s.name}-${s.signed_at}`} className="border border-gray-300 rounded p-2 break-inside-avoid">
                        {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
                        <img src={s.signature} alt={`Signature of ${s.name}`} className="h-16 w-full object-contain" />
                        <p className="font-semibold text-sm mt-1">{s.name}</p>
                        <p className="text-xs text-gray-600">{formatSignedAt(s.signed_at)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {(record.reopen_log ?? []).length > 0 && (
          <section className="mt-6 break-inside-avoid">
            <h3 className="font-bold">Reopen history</h3>
            <ul className="text-sm mt-1 space-y-1">
              {record.reopen_log.map((r) => (
                <li key={r.at}>
                  {formatSignedAt(r.at)}
                  {r.by_name ? ` · ${r.by_name}` : ''}: {r.reason}. Removed: {r.removed.map((x) => x.name).join(', ')}.
                </li>
              ))}
            </ul>
          </section>
        )}

        {photos.length > 0 && (
          <section className="mt-6">
            <h3 className="font-bold text-lg border-b border-black pb-1">Photos ({photos.length})</h3>
            <div className="grid grid-cols-2 gap-3 mt-3">
              {photos.map((p) => {
                const src = photoUrls.get(p);
                return src ? (
                  // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL
                  <img key={p} src={src} alt="Record photo" className="w-full aspect-[4/3] object-cover rounded break-inside-avoid" />
                ) : (
                  <div key={p} className="w-full aspect-[4/3] border border-gray-300 rounded flex items-center justify-center text-sm text-gray-500">
                    Photo could not be loaded
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div className="mt-10 flex items-center justify-between gap-4 print:hidden">
          <Link href={detailHref(mod.slug, params.id) ?? `/${mod.slug}`} className="underline">Back to the record</Link>
          <PrintButton />
        </div>
      </div>
    </main>
  );
}
