'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { estimateTotals, money, type EstimateItem } from '@/lib/estimate-math';

const BLANK: EstimateItem = { description: '', quantity: 1, unit: 'ea', material_unit_cost: 0, labour_hours_per_unit: 0 };

interface Estimate {
  id: string;
  projectName: string;
  clientName: string;
  clientAddress: string | null;
  scope: string | null;
  terms: string | null;
  status: string | null;
  markupPercentage: number | string;
  taxPercentage: number | string;
  labourRate: number | string;
}

export default function EstimateDetailPage({ params }: { params: { id: string } }) {
  const [est, setEst] = useState<Estimate | null>(null);
  const [items, setItems] = useState<EstimateItem[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    fetch(`/api/estimates/${params.id}`)
      .then((r) => r.json())
      .then((j) => {
        if (!j.success) return setError(j.error || 'Could not load this estimate.');
        const { items, ...rest } = j.data;
        setEst({ ...rest, markupPercentage: rest.markupPercentage ?? 0, taxPercentage: rest.taxPercentage ?? 0, labourRate: rest.labourRate ?? 0 });
        setItems(items?.length ? items : [{ ...BLANK }]);
      })
      .catch(() => setError('Could not load this estimate.'));
  }, [params.id]);

  if (error) return <main className="min-h-screen bg-slate-950 text-red-400 p-8">{error}</main>;
  if (!est) return <main className="min-h-screen bg-slate-950 text-slate-400 p-8">Loading estimate…</main>;

  const t = estimateTotals(items, est.labourRate, est.markupPercentage, est.taxPercentage);
  const editEst = (patch: Partial<Estimate>) => { setEst({ ...est, ...patch }); setDirty(true); };
  const editItems = (next: EstimateItem[]) => { setItems(next); setDirty(true); };
  const setItem = (i: number, k: keyof EstimateItem, v: string) => editItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  async function remove() {
    if (!confirm('Delete this estimate and all its lines? This cannot be undone.')) return;
    const res = await fetch(`/api/estimates/${params.id}`, { method: 'DELETE' }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    if (!res.success) return setStatus(`Not deleted: ${res.error}`);
    setDirty(false);
    window.location.href = '/estimates';
  }

  async function save() {
    setStatus('Saving…');
    const res = await fetch(`/api/estimates/${params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...est,
        markupPercentage: Number(est!.markupPercentage) || 0,
        taxPercentage: Number(est!.taxPercentage) || 0,
        labourRate: Number(est!.labourRate) || 0,
        items: items
          .filter((it) => it.description.trim() || Number(it.material_unit_cost) || Number(it.labour_hours_per_unit))
          .map((it) => ({ ...it, quantity: Number(it.quantity) || 0, material_unit_cost: Number(it.material_unit_cost) || 0, labour_hours_per_unit: Number(it.labour_hours_per_unit) || 0 })),
      }),
    }).then((r) => r.json()).catch(() => ({ success: false, error: 'Network error' }));
    setStatus(res.success ? 'Saved' : `Not saved: ${res.error}`);
    if (res.success) {
      setDirty(false);
      setTimeout(() => setStatus(''), 2500);
    }
  }

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500';
  const label = 'block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1';
  const field = (k: keyof Estimate, l: string, type = 'text') => (
    <div>
      <label className={label} htmlFor={k}>{l}</label>
      <input id={k} type={type} step="any" className={input} value={(est[k] as string) ?? ''} onChange={(e) => editEst({ [k]: e.target.value })} />
    </div>
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex flex-col md:flex-row justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">{est.projectName || 'Untitled estimate'}</h1>
            <p className="text-slate-400 mt-1">{est.clientName}</p>
          </div>
          <div className="flex items-center gap-3">
            {dirty && !status && <span className="text-sm text-amber-400">Unsaved changes</span>}
            {status && <span className={`text-sm font-semibold ${status.startsWith('Not') ? 'text-red-400' : 'text-emerald-400'}`}>{status}</span>}
            <button onClick={save} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-5 py-2.5 rounded-lg">Save</button>
            <Link href={`/estimates/${params.id}/proposal`} onClick={(e) => { if (dirty && !confirm('You have unsaved changes. Open the proposal anyway? It shows the last saved version.')) e.preventDefault(); }} className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-semibold px-5 py-2.5 rounded-lg">Proposal</Link>
          </div>
        </div>

        <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {field('projectName', 'Project name')}
          {field('clientName', 'Client')}
          {field('clientAddress', 'Client / site address')}
          {field('labourRate', 'Labour rate ($/hr)', 'number')}
          {field('markupPercentage', 'Markup %', 'number')}
          {field('taxPercentage', 'Tax %', 'number')}
          <div>
            <label className={label} htmlFor="status">Status</label>
            <select id="status" className={input} value={est.status || 'Draft'} onChange={(e) => editEst({ status: e.target.value })}>
              {['Draft', 'Sent', 'Won', 'Lost'].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/50 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="p-3 w-[34%]">Description</th>
                  <th className="p-3">Qty</th>
                  <th className="p-3">Unit</th>
                  <th className="p-3">Material $/unit</th>
                  <th className="p-3">Labour hrs/unit</th>
                  <th className="p-3 text-right">Material</th>
                  <th className="p-3 text-right">Hours</th>
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {items.map((it, i) => (
                  <tr key={i}>
                    <td className="p-2"><input aria-label="Description" className={input} value={it.description ?? ''} onChange={(e) => setItem(i, 'description', e.target.value)} placeholder="e.g. 3/4in EMT conduit" /></td>
                    <td className="p-2"><input aria-label="Quantity" type="number" step="any" className={input} value={it.quantity} onChange={(e) => setItem(i, 'quantity', e.target.value)} /></td>
                    <td className="p-2"><input aria-label="Unit" className={input} value={it.unit ?? ''} onChange={(e) => setItem(i, 'unit', e.target.value)} /></td>
                    <td className="p-2"><input aria-label="Material cost per unit" type="number" step="any" className={input} value={it.material_unit_cost} onChange={(e) => setItem(i, 'material_unit_cost', e.target.value)} /></td>
                    <td className="p-2"><input aria-label="Labour hours per unit" type="number" step="any" className={input} value={it.labour_hours_per_unit} onChange={(e) => setItem(i, 'labour_hours_per_unit', e.target.value)} /></td>
                    <td className="p-3 text-right text-slate-300">{money(t.lines[i].material)}</td>
                    <td className="p-3 text-right text-slate-300">{t.lines[i].hours.toFixed(2)}</td>
                    <td className="p-2 text-right">
                      <button onClick={() => editItems(items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 px-2" aria-label="Remove line">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-slate-800">
            <button onClick={() => editItems([...items, { ...BLANK }])} className="text-amber-400 hover:text-amber-300 font-semibold text-sm">+ Add line</button>
          </div>
        </section>

        <div className="grid lg:grid-cols-2 gap-6">
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <label className={label} htmlFor="scope">Scope of work</label>
              <textarea id="scope" rows={5} className={input} value={est.scope ?? ''} onChange={(e) => editEst({ scope: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor="terms">Terms (leave blank to use your company terms)</label>
              <textarea id="terms" rows={4} className={input} value={est.terms ?? ''} onChange={(e) => editEst({ terms: e.target.value })} />
            </div>
          </section>
          <section className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <dl className="space-y-2 text-sm">
              {[
                ['Material', money(t.material)],
                ['Labour hours', t.labourHours.toFixed(2)],
                ['Labour cost', money(t.labour)],
                ['Subtotal', money(t.subtotal)],
                [`Markup (${Number(est.markupPercentage) || 0}%)`, money(t.markup)],
                [`Tax (${Number(est.taxPercentage) || 0}%)`, money(t.tax)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-slate-300"><dt>{k}</dt><dd>{v}</dd></div>
              ))}
              <div className="flex justify-between text-white text-xl font-bold border-t border-slate-800 pt-3"><dt>Total</dt><dd data-testid="total">{money(t.total)}</dd></div>
            </dl>
            <p className="text-xs text-slate-500 mt-4">Markup is added to material and labour; tax is charged on the marked-up price.</p>
            <button onClick={remove} className="mt-6 text-sm text-slate-400 hover:text-red-400">Delete estimate</button>
          </section>
        </div>
      </div>
    </main>
  );
}
