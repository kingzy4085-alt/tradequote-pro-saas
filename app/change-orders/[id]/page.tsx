'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/estimate-math';
import { changeOrderTotals } from '@/lib/billing-math';
import { SignaturePad } from '../../daily-logs/signature-pad';

interface CO {
  id: string;
  co_number: number;
  project: string;
  client_name: string | null;
  reason: string | null;
  scope: string | null;
  material_cost: number | string;
  labour_hours: number | string;
  labour_rate: number | string;
  markup_pct: number | string;
  tax_pct: number | string;
  status: string;
  approved_by: string | null;
  approval_signature: string | null;
  approved_at: string | null;
  invoice_id: string | null;
  created_at: string;
}

export default function ChangeOrderPage({ params }: { params: { id: string } }) {
  const [co, setCo] = useState<CO | null>(null);
  const [company, setCompany] = useState<any>({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  const [signer, setSigner] = useState('');
  const [signature, setSignature] = useState('');

  useEffect(() => {
    fetch(`/api/change-orders/${params.id}`).then((r) => r.json()).then((j) => (j.success ? setCo(j.data) : setError(j.error))).catch(() => setError('Could not load this change order.'));
    fetch('/api/company').then((r) => r.json()).then((j) => j.data && setCompany(j.data)).catch(() => {});
  }, [params.id]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <main className="min-h-screen bg-slate-950 text-red-400 p-8">{error}</main>;
  if (!co) return <main className="min-h-screen bg-slate-950 text-slate-400 p-8">Loading…</main>;

  const locked = co.status === 'Approved' || co.status === 'Rejected';
  const t = changeOrderTotals(co);
  const edit = (patch: Partial<CO>) => { setCo({ ...co, ...patch }); setDirty(true); };
  const fields = () => {
    const { project, client_name, reason, scope, material_cost, labour_hours, labour_rate, markup_pct, tax_pct } = co!;
    return { project, client_name, reason, scope, material_cost, labour_hours, labour_rate, markup_pct, tax_pct };
  };

  async function send(body: Record<string, unknown>, okMessage: string) {
    setStatus('Saving…');
    const res = await fetch(`/api/change-orders/${params.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) return setStatus(`Not saved: ${res.error}`);
    setCo(res.data);
    setDirty(false);
    setStatus(okMessage);
    setTimeout(() => setStatus(''), 2500);
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-70';
  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
  const field = (k: keyof CO, l: string, type = 'text') => (
    <div>
      <label className={label} htmlFor={k}>{l}</label>
      <input id={k} type={type} min={0} step="any" disabled={locked} className={input} value={(co[k] as string) ?? ''} onChange={(e) => edit({ [k]: e.target.value })} />
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 print:p-0 print:bg-white">
      {/* Editor */}
      <div className="max-w-5xl mx-auto space-y-6 print:hidden">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Change Order #{co.co_number}</h1>
            <p className="text-slate-400 mt-1">{co.project} · <span className={co.status === 'Approved' ? 'text-emerald-400' : co.status === 'Rejected' ? 'text-red-400' : 'text-amber-400'}>{co.status}</span>{co.invoice_id && ' · Invoiced'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {dirty && !status && <span className="text-sm text-amber-400">Unsaved changes</span>}
            {status && <span className={`text-sm font-semibold ${status.startsWith('Not') ? 'text-red-400' : 'text-emerald-400'}`}>{status}</span>}
            {!locked && <button onClick={() => send(fields(), 'Saved')} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Save</button>}
            {co.status === 'Draft' && <button onClick={() => send({ ...fields(), action: 'send' }, 'Marked as sent')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2.5 rounded-lg">Mark sent</button>}
            <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2.5 rounded-lg">Print / PDF</button>
          </div>
        </div>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 grid sm:grid-cols-2 gap-4">
          {field('project', 'Project')}
          {field('client_name', 'Client')}
          <div className="sm:col-span-2">
            <label className={label} htmlFor="reason">Reason for change</label>
            <input id="reason" disabled={locked} className={input} value={co.reason ?? ''} onChange={(e) => edit({ reason: e.target.value })} placeholder="Client request, site condition, design change…" />
          </div>
          <div className="sm:col-span-2">
            <label className={label} htmlFor="scope">Scope of added / changed work</label>
            <textarea id="scope" rows={4} disabled={locked} className={input} value={co.scope ?? ''} onChange={(e) => edit({ scope: e.target.value })} />
          </div>
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 grid grid-cols-2 gap-4">
            {field('material_cost', 'Material cost ($)', 'number')}
            {field('labour_hours', 'Labour hours', 'number')}
            {field('labour_rate', 'Labour rate ($/hr)', 'number')}
            {field('markup_pct', 'Markup %', 'number')}
            {field('tax_pct', 'Tax %', 'number')}
          </section>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <dl className="space-y-2 text-sm">
              {[['Material', money(Number(co.material_cost) || 0)], ['Labour', money(t.labour)], ['Cost', money(t.cost)], [`Markup (${Number(co.markup_pct) || 0}%)`, money(t.markup)], ['Price', money(t.price)], [`Tax (${Number(co.tax_pct) || 0}%)`, money(t.tax)]].map(([k, v]) => (
                <div key={k} className="flex justify-between text-slate-300"><dt>{k}</dt><dd>{v}</dd></div>
              ))}
              <div className="flex justify-between text-white text-xl font-bold border-t border-slate-800 pt-3"><dt>Total</dt><dd>{money(t.total)}</dd></div>
            </dl>
          </section>
        </div>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
          <h2 className="text-lg font-bold text-white mb-4">Client approval</h2>
          {co.status === 'Approved' ? (
            <div className="space-y-2">
              <img src={co.approval_signature!} alt={`Signature of ${co.approved_by}`} className="h-24 bg-white rounded-lg p-2" />
              <p className="text-slate-300">Approved by {co.approved_by} · {new Date(co.approved_at!).toLocaleString('en-CA')}</p>
              {co.invoice_id ? (
                <a href={`/invoices/${co.invoice_id}`} className="text-sm text-amber-400">View invoice →</a>
              ) : (
                <button onClick={() => confirm('Reopen this change order? The client signature will be removed.') && send({ action: 'reopen' }, 'Reopened')} className="text-sm text-slate-400 hover:text-amber-400">Reopen for changes</button>
              )}
            </div>
          ) : co.status === 'Rejected' ? (
            <button onClick={() => send({ action: 'reopen' }, 'Reopened')} className="text-sm text-slate-400 hover:text-amber-400">Rejected. Reopen as draft</button>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className={label} htmlFor="signer">Client name</label>
                <input id="signer" className={input} value={signer} onChange={(e) => setSigner(e.target.value)} />
                <div className="flex gap-3 mt-4">
                  <button onClick={() => send({ ...fields(), action: 'approve', approved_by: signer, signature }, 'Approved')} disabled={!signer.trim() || !signature} className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-40 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Approve &amp; sign</button>
                  <button onClick={() => confirm('Mark this change order as rejected by the client?') && send({ ...fields(), action: 'reject' }, 'Rejected')} className="text-sm text-slate-400 hover:text-red-400">Client rejected</button>
                </div>
                <p className="text-xs text-slate-500 mt-2">Hand the phone or tablet to the client to sign. Approval locks the price.</p>
              </div>
              <SignaturePad onChange={setSignature} />
            </div>
          )}
        </section>

        {!locked && (
          <button onClick={async () => {
            if (!confirm('Delete this change order?')) return;
            const r = await fetch(`/api/change-orders/${params.id}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => ({ success: false }));
            if (r.success) { setDirty(false); window.location.href = '/change-orders'; } else setStatus(`Not deleted: ${r.error || 'Network error'}`);
          }} className="text-sm text-slate-400 hover:text-red-400">Delete change order</button>
        )}
      </div>

      {/* Printed change order */}
      <article className="hidden print:block text-gray-700 text-sm leading-relaxed">
        <header className="flex justify-between border-b-2 border-black pb-4">
          <div>
            <h1 className="text-2xl font-bold text-black">{company.company_name}</h1>
            <p>{company.address}{company.province ? `, ${company.province}` : ''}</p>
            <p>{[company.phone, company.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-black uppercase">Change Order #{co.co_number}</p>
            <p>{new Date(co.created_at).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 py-4">
          <div><p className="text-xs font-bold uppercase text-black">Client</p><p className="text-black">{co.client_name}</p></div>
          <div><p className="text-xs font-bold uppercase text-black">Project</p><p className="text-black">{co.project}</p></div>
        </section>
        {co.reason && <p className="pb-3"><span className="font-bold text-black">Reason: </span>{co.reason}</p>}
        <h2 className="text-xs font-bold uppercase text-black mb-1">Scope of change</h2>
        <p className="whitespace-pre-line pb-4">{co.scope}</p>
        <dl className="ml-auto w-64 space-y-1">
          <div className="flex justify-between"><dt>Price</dt><dd>{money(t.price)}</dd></div>
          <div className="flex justify-between"><dt>Tax ({Number(co.tax_pct) || 0}%)</dt><dd>{money(t.tax)}</dd></div>
          <div className="flex justify-between font-bold text-black border-t border-black pt-1"><dt>Total (CAD)</dt><dd>{money(t.total)}</dd></div>
        </dl>
        <p className="pt-6">The client authorizes the work above at the stated price. The contract amount and schedule are adjusted accordingly; all other terms are unchanged.</p>
        <section className="grid grid-cols-2 gap-10 pt-10">
          <div>
            {co.approval_signature ? <img src={co.approval_signature} alt="" className="h-12" /> : <div className="h-12" />}
            <div className="border-b border-black" />
            <p className="text-xs mt-1">Client{co.approved_by ? `: ${co.approved_by}` : ''}{co.approved_at ? ` · ${new Date(co.approved_at).toLocaleDateString('en-CA')}` : ' — signature & date'}</p>
          </div>
          <div><div className="h-12" /><div className="border-b border-black" /><p className="text-xs mt-1">For {company.company_name} — signature &amp; date</p></div>
        </section>
      </article>
    </main>
  );
}
