import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { formatMoney, formatValue } from '@/lib/format';
import { isPortalToken } from '@/lib/portal';
import { loadPortal, portalIp } from '@/lib/portal-server';
import { Letterhead } from '@/lib/print';
import DecisionForm from './decision-form';

export const dynamic = 'force-dynamic';
// The link is the key: keep it out of search results and out of the Referer header of anything the page links to
export const metadata: Metadata = { title: 'Proposal', robots: { index: false, follow: false }, referrer: 'no-referrer' };

const heading = 'text-xs font-bold uppercase text-black mb-1';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-white text-gray-700">
      <article className="max-w-[8.5in] mx-auto p-6 sm:p-10 text-sm leading-relaxed">{children}</article>
    </main>
  );
}

function Message({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Shell>
      <h1 className="text-2xl font-bold text-black mb-3">{title}</h1>
      <div className="text-base">{children}</div>
    </Shell>
  );
}

// What the client sees from a shared link: the proposal, then accept or decline. No account.
export default async function PortalPage({ params }: { params: { token: string } }) {
  const invalid = (
    <Message title="This link is not valid">
      <p>Check that you opened the whole link, or ask the company that sent it for a new one.</p>
    </Message>
  );
  if (!isPortalToken(params.token)) return invalid;

  const result = await loadPortal(params.token, portalIp(headers()));
  if (result.status === 'limited') {
    return (
      <Message title="Too many requests">
        <p>Wait a while, then open the link again.</p>
      </Message>
    );
  }
  if (result.status === 'error') {
    return (
      <Message title="This page could not be loaded">
        <p>Reload the page to try again.</p>
      </Message>
    );
  }
  const view = result.view;
  if (!view) return invalid;

  const contact = [view.company.phone, view.company.email].filter(Boolean).join(' or ');
  if (view.state === 'closed' || !view.proposal) {
    return (
      <Message title="This proposal is no longer open">
        <p>
          The link has expired or was withdrawn. Contact {view.company.name}
          {contact ? ` at ${contact}` : ''} for a current one.
        </p>
      </Message>
    );
  }

  const p = view.proposal;
  return (
    <Shell>
      <Letterhead company={view.company} document="Proposal">
        <p>{formatValue('date', p.created_on)}</p>
        {p.valid_until && <p>Prices valid until {formatValue('date', p.valid_until)}</p>}
      </Letterhead>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-6 py-5">
        <div>
          <p className={heading}>Prepared for</p>
          <p className="text-black font-semibold">{p.client_name || '—'}</p>
        </div>
        <div>
          <p className={heading}>Project</p>
          <p className="text-black font-semibold">{p.title}</p>
        </div>
      </section>

      {p.scope_of_work && (
        <section className="pb-5">
          <h2 className={heading}>Scope of work</h2>
          <p className="whitespace-pre-line break-words">{p.scope_of_work}</p>
        </section>
      )}

      <section className="flex items-baseline justify-between gap-4 border-y-2 border-black py-4 mb-5">
        <h2 className="text-sm font-bold uppercase text-black">Total price</h2>
        <p className="text-2xl font-bold text-black">{p.total_amount === null ? 'To be confirmed' : formatMoney(p.total_amount)}</p>
      </section>

      {p.terms && (
        <section className="pb-6">
          <h2 className={heading}>Terms</h2>
          <p className="whitespace-pre-line break-words">{p.terms}</p>
        </section>
      )}

      {view.state === 'open' ? (
        <DecisionForm token={params.token} company={view.company.name} />
      ) : (
        <section role="status" className={`rounded-xl border-2 p-5 text-base ${view.state === 'accepted' ? 'border-green-700 bg-green-50 text-green-900' : 'border-gray-400 bg-gray-50 text-gray-800'}`}>
          <p className="font-bold">
            {view.state === 'accepted' ? 'Accepted' : 'Declined'}
            {view.decided_at ? ` on ${formatValue('date', String(view.decided_at).slice(0, 10))}` : ''}
            {view.state === 'accepted' && view.signer_name ? ` by ${view.signer_name}` : ''}.
          </p>
          <p className="mt-1">
            {view.company.name} has been told.{contact ? ` Questions? Reach them at ${contact}.` : ''}
          </p>
        </section>
      )}
    </Shell>
  );
}
