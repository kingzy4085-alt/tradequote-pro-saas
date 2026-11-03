'use client';

import { useEffect, useState } from 'react';
import { money } from '@/lib/estimate-math';
import { invoiceTotals, type InvoiceLine } from '@/lib/billing-math';

interface Invoice {
  id: string;
  invoice_number: number;
  project: string;
  client_name: string | null;
  client_address: string | null;
  issue_date: string | null;
  due_date: string | null;
  status: string;
  lines: InvoiceLine[];
  tax_pct: number | string;
  holdback_pct: number | string;
  notes: string | null;
  paid_at: string | null;
  available_change_orders: { id: string; co_number: number; project: string; scope: string | null; price: number }[];
  estimates: { id: number; projectName: string; clientName: string; total_bid: number | null }[];
  billed_percent: Record<string, number>;
}

export default function InvoicePage({ params }: { params: { id: string } }) {
  const [inv, setInv] = useState<Invoice | null>(null);
  const [company, setCompany] = useState<any>({});
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);
  const [progEstimate, setProgEstimate] = useState('');
  const [progPct, setProgPct] = useState('');

  const load = () =>
    fetch(`/api/invoices/${params.id}`).then((r) => r.json()).then((j) => (j.success ? setInv({ ...j.data, lines: j.data.lines || [] }) : setError(j.error))).catch(() => setError('Could not load this invoice.'));
  useEffect(() => {
    load();
    fetch('/api/company').then((r) => r.json()).then((j) => j.data && setCompany(j.data)).catch(() => {});
  }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  if (error) return <main className="min-h-screen bg-slate-950 text-red-400 p-8">{error}</main>;
  if (!inv) return <main className="min-h-screen bg-slate-950 text-slate-400 p-8">Loading…</main>;

  const draft = inv.status === 'Draft';
  const t = invoiceTotals(inv.lines, inv.tax_pct, inv.holdback_pct);
  const edit = (patch: Partial<Invoice>) => { setInv({ ...inv, ...patch }); setDirty(true); };
  const setLine = (i: number, patch: Partial<InvoiceLine>) => edit({ lines: inv.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const onInvoice = new Set(inv.lines.map((l) => l.change_order_id).filter(Boolean));
  const unbilledCOs = inv.available_change_orders.filter((c) => !onInvoice.has(c.id));

  async function save(extra: Record<string, unknown> = {}, okMessage = 'Saved') {
    setStatus('Saving…');
    const { project, client_name, client_address, issue_date, due_date, lines, tax_pct, holdback_pct, notes } = inv!;
    const body = draft ? { project, client_name, client_address, issue_date, due_date, lines, tax_pct, holdback_pct, notes, ...extra } : extra;
    const res = await fetch(`/api/invoices/${params.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) return setStatus(`Not saved: ${res.error}`);
    setDirty(false);
    await load();
    setStatus(okMessage);
    setTimeout(() => setStatus(''), 2500);
  }

  function addProgress() {
    const e = inv!.estimates.find((x) => String(x.id) === progEstimate);
    if (!e || !(Number(progPct) > 0)) return;
    edit({ lines: [...inv!.lines, { description: '', amount: 0, estimate_id: e.id, percent: Number(progPct) }] });
    setProgPct('');
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500 disabled:opacity-70';
  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
  const field = (k: keyof Invoice, l: string, type = 'text') => (
    <div>
      <label className={label} htmlFor={k}>{l}</label>
      <input id={k} type={type} min={0} step="any" disabled={!draft} className={input} value={(inv[k] as string) ?? ''} onChange={(e) => edit({ [k]: e.target.value })} />
    </div>
  );
  const lineLabel = (l: InvoiceLine) => (l.change_order_id ? 'Change order' : l.estimate_id != null ? `Progress ${l.percent}%` : 'Other');
  const fmtDate = (d: string | null) => (d ? new Date(d + 'T12:00').toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' }) : '');

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8 print:p-0 print:bg-white">
      <div className="max-w-6xl mx-auto space-y-6 print:hidden">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">Invoice {inv.invoice_number}</h1>
            <p className="text-slate-400 mt-1">{inv.project} · {inv.status}{inv.paid_at && ` ${new Date(inv.paid_at).toLocaleDateString('en-CA')}`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {dirty && !status && <span className="text-sm text-amber-400">Unsaved changes</span>}
            {status && <span className={`text-sm font-semibold ${status.startsWith('Not') ? 'text-red-400' : 'text-emerald-400'}`}>{status}</span>}
            {draft && <button onClick={() => save()} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Save</button>}
            {draft && <button onClick={() => save({ status: 'Sent' }, 'Marked as sent')} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2.5 rounded-lg">Mark sent</button>}
            {inv.status === 'Sent' && <button onClick={() => save({ status: 'Paid' }, 'Marked as paid')} className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-semibold px-4 py-2.5 rounded-lg">Mark paid</button>}
            {!draft && <button onClick={() => confirm('Set this invoice back to Draft so it can be edited?') && save({ status: 'Draft' }, 'Back to draft')} className="text-sm text-slate-400 hover:text-amber-400">Back to draft</button>}
            <button onClick={() => window.print()} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2.5 rounded-lg">Print / PDF</button>
          </div>
        </div>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {field('project', 'Project')}
          {field('client_name', 'Client')}
          {field('client_address', 'Client address')}
          {field('issue_date', 'Issue date', 'date')}
          {field('due_date', 'Due date', 'date')}
          <div className="grid grid-cols-2 gap-4">
            {field('tax_pct', 'Tax %', 'number')}
            {field('holdback_pct', 'Holdback %', 'number')}
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider text-left">
                <th className="p-3 w-32">Type</th><th className="p-3">Description</th><th className="p-3 w-40 text-right">Amount</th><th className="p-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {inv.lines.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-slate-500">Add progress billing, approved change orders or other charges below.</td></tr>}
              {inv.lines.map((l, i) => (
                <tr key={i}>
                  <td className="p-3 text-slate-400">{lineLabel(l)}</td>
                  <td className="p-2"><input aria-label="Description" disabled={!draft} className={input} value={l.description} placeholder={l.estimate_id != null ? 'Filled in automatically when saved' : ''} onChange={(e) => setLine(i, { description: e.target.value })} /></td>
                  <td className="p-2 text-right">
                    {l.change_order_id || l.estimate_id != null ? (
                      <span className="text-slate-300 px-3">{l.estimate_id != null && !Number(l.amount) ? 'on save' : money(Number(l.amount))}</span>
                    ) : (
                      <input aria-label="Amount" type="number" step="any" disabled={!draft} className={`${input} text-right`} value={l.amount} onChange={(e) => setLine(i, { amount: e.target.value })} />
                    )}
                  </td>
                  <td className="p-2">{draft && <button onClick={() => edit({ lines: inv.lines.filter((_, j) => j !== i) })} className="text-slate-500 hover:text-red-400 px-2" aria-label="Remove line">✕</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {draft && (
          <div className="grid lg:grid-cols-3 gap-4">
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <h2 className="font-bold text-white">Progress billing</h2>
              <select className={input} value={progEstimate} onChange={(e) => setProgEstimate(e.target.value)} aria-label="Estimate">
                <option value="">Choose estimate…</option>
                {inv.estimates.map((e) => <option key={e.id} value={e.id}>#{e.id} {e.projectName} ({inv.billed_percent[e.id] || 0}% billed)</option>)}
              </select>
              <div className="flex gap-2">
                <input type="number" min={0} max={100} step="any" placeholder="% to bill now" className={input} value={progPct} onChange={(e) => setProgPct(e.target.value)} aria-label="Percent to bill" />
                <button onClick={addProgress} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 rounded-lg">Add</button>
              </div>
              <p className="text-xs text-slate-500">Bills that % of the estimate&apos;s price before tax. It won&apos;t let you bill past 100%.</p>
            </section>
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2">
              <h2 className="font-bold text-white">Approved change orders</h2>
              {unbilledCOs.length === 0 ? <p className="text-sm text-slate-500">None waiting to be billed.</p> : unbilledCOs.map((c) => (
                <button key={c.id} onClick={() => edit({ lines: [...inv.lines, { description: `Change order #${c.co_number}${c.scope ? `: ${c.scope.split('\n')[0].slice(0, 80)}` : ''}`, amount: c.price, change_order_id: c.id }] })} className="w-full flex justify-between text-left text-sm bg-slate-950 border border-slate-800 hover:border-amber-500 rounded-lg px-3 py-2">
                  <span className="text-slate-200">+ CO #{c.co_number} · {c.project}</span><span className="text-slate-300">{money(Number(c.price))}</span>
                </button>
              ))}
            </section>
            <section className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
              <h2 className="font-bold text-white">Other charge</h2>
              <button onClick={() => edit({ lines: [...inv.lines, { description: '', amount: 0 }] })} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">+ Add line</button>
              <p className="text-xs text-slate-500">Time and material, call-outs, credits (use a negative amount).</p>
            </section>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-6">
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <label className={label} htmlFor="notes">Notes on invoice</label>
            <textarea id="notes" rows={4} disabled={!draft} className={input} value={inv.notes ?? ''} onChange={(e) => edit({ notes: e.target.value })} placeholder="Payment instructions, PO number…" />
          </section>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-300"><dt>Subtotal</dt><dd>{money(t.subtotal)}</dd></div>
              <div className="flex justify-between text-slate-300"><dt>Tax ({Number(inv.tax_pct) || 0}%)</dt><dd>{money(t.tax)}</dd></div>
              {t.holdback > 0 && <div className="flex justify-between text-slate-300"><dt>Less holdback ({Number(inv.holdback_pct)}%)</dt><dd>−{money(t.holdback)}</dd></div>}
              <div className="flex justify-between text-white text-xl font-bold border-t border-slate-800 pt-3"><dt>Amount due</dt><dd>{money(t.total)}</dd></div>
            </dl>
            {dirty && inv.lines.some((l) => l.estimate_id != null && !Number(l.amount)) && <p className="text-xs text-amber-400 mt-3">Save to price the new progress lines.</p>}
          </section>
        </div>

        {draft && (
          <button onClick={async () => {
            if (!confirm('Delete this draft invoice? Any change orders on it become billable again.')) return;
            const r = await fetch(`/api/invoices/${params.id}`, { method: 'DELETE' }).then((x) => x.json()).catch(() => ({ success: false }));
            if (r.success) { setDirty(false); window.location.href = '/invoices'; } else setStatus(`Not deleted: ${r.error || 'Network error'}`);
          }} className="text-sm text-slate-400 hover:text-red-400">Delete invoice</button>
        )}
      </div>

      {/* Printed invoice */}
      <article className="hidden print:block text-gray-700 text-sm leading-relaxed">
        <header className="flex justify-between border-b-2 border-black pb-4">
          <div>
            <h1 className="text-2xl font-bold text-black">{company.company_name}</h1>
            <p>{company.address}{company.province ? `, ${company.province}` : ''}</p>
            <p>{[company.phone, company.email].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="text-right">
            <p className="text-xl font-bold text-black uppercase">Invoice {inv.invoice_number}</p>
            <p>Issued {fmtDate(inv.issue_date)}</p>
            {inv.due_date && <p className="font-semibold text-black">Due {fmtDate(inv.due_date)}</p>}
          </div>
        </header>
        <section className="grid grid-cols-2 gap-6 py-4">
          <div><p className="text-xs font-bold uppercase text-black">Bill to</p><p className="text-black">{inv.client_name}</p><p>{inv.client_address}</p></div>
          <div><p className="text-xs font-bold uppercase text-black">Project</p><p className="text-black">{inv.project}</p></div>
        </section>
        <table className="w-full border-collapse mb-4">
          <thead><tr className="border-b border-black text-left text-black text-xs uppercase"><th className="py-2">Description</th><th className="py-2 text-right">Amount</th></tr></thead>
          <tbody>{inv.lines.map((l, i) => <tr key={i} className="border-b border-gray-300"><td className="py-2">{l.description}</td><td className="py-2 text-right">{money(Number(l.amount))}</td></tr>)}</tbody>
        </table>
        <dl className="ml-auto w-72 space-y-1">
          <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(t.subtotal)}</dd></div>
          <div className="flex justify-between"><dt>Tax ({Number(inv.tax_pct) || 0}%)</dt><dd>{money(t.tax)}</dd></div>
          {t.holdback > 0 && <div className="flex justify-between"><dt>Less holdback ({Number(inv.holdback_pct)}%)</dt><dd>−{money(t.holdback)}</dd></div>}
          <div className="flex justify-between font-bold text-black text-base border-t border-black pt-1"><dt>Amount due (CAD)</dt><dd>{money(t.total)}</dd></div>
        </dl>
        {inv.notes && <p className="pt-6 whitespace-pre-line">{inv.notes}</p>}
      </article>
    </main>
  );
}
