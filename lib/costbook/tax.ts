// Sales tax on a construction contract, by province. Rates are unchanged in 2026 (the last change was
// Nova Scotia HST 15% to 14% on 2025-04-01), checked against the CRA rate table and each province's bulletins.
//
// `total` is what the client is charged on the contract price. Where the contractor is the consumer of the
// materials it installs (BC, MB general trades), the client is charged GST only and the provincial tax is a
// cost the contractor carries in the material price (pstOnInstalledMaterials). Saskatchewan and Manitoba
// mechanical and electrical work work the other way: the provincial tax is charged on the whole price.
import type { SalesTax, Trade } from './types';

type Rates = Omit<SalesTax, 'province' | 'total' | 'note'>;

const RATES: Record<string, Rates & { note: string }> = {
  AB: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false, note: 'No provincial sales tax. 5% GST on the full price; GST paid on materials is recovered.' },
  BC: {
    gst: 5, pst: 7, qst: 0, hst: 0, pstOnInstalledMaterials: true,
    note: 'Real property contractors are the consumer: they pay 7% PST on materials and charge the client GST only, no PST on the contract or labour. PST cannot be recovered, so it belongs in the material cost (BC PST real property contractors guide).',
  },
  SK: {
    gst: 5, pst: 6, qst: 0, hst: 0, pstOnInstalledMaterials: false,
    note: 'Since April 2017 the contractor buys materials PST-exempt and charges 6% PST on the total contract price, with 5% GST on top (Saskatchewan Bulletin PST-12).',
  },
  MB: {
    gst: 5, pst: 7, qst: 0, hst: 0, pstOnInstalledMaterials: true,
    note: 'General trades: the contractor pays 7% RST on materials and charges GST only. Mechanical and electrical systems (electrical, plumbing, HVAC) and appliances are taxable: 7% RST applies to the supply-and-install charge (Manitoba Bulletins 005, 008 and 031).',
  },
  ON: { gst: 0, pst: 0, qst: 0, hst: 13, pstOnInstalledMaterials: false, note: '13% HST on the full price; HST paid on materials is recovered.' },
  QC: { gst: 5, pst: 0, qst: 9.975, hst: 0, pstOnInstalledMaterials: false, note: '5% GST plus 9.975% QST on the full price; both are recovered on materials.' },
  NB: { gst: 0, pst: 0, qst: 0, hst: 15, pstOnInstalledMaterials: false, note: '15% HST on the full price; HST paid on materials is recovered.' },
  NS: { gst: 0, pst: 0, qst: 0, hst: 14, pstOnInstalledMaterials: false, note: '14% HST on the full price (reduced from 15% on 2025-04-01); recovered on materials.' },
  PE: { gst: 0, pst: 0, qst: 0, hst: 15, pstOnInstalledMaterials: false, note: '15% HST on the full price; recovered on materials.' },
  NL: { gst: 0, pst: 0, qst: 0, hst: 15, pstOnInstalledMaterials: false, note: '15% HST on the full price; recovered on materials.' },
  YT: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false, note: 'No territorial sales tax. 5% GST on the full price.' },
  NT: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false, note: 'No territorial sales tax. 5% GST on the full price.' },
  NU: { gst: 5, pst: 0, qst: 0, hst: 0, pstOnInstalledMaterials: false, note: 'No territorial sales tax. 5% GST on the full price.' },
};

/** Trades Manitoba treats as mechanical and electrical systems, taxable on the whole supply-and-install charge. */
const MB_TAXABLE_TRADES: readonly Trade[] = ['electrical', 'plumbing', 'hvac'];

const sum = (t: Rates) => Math.round((t.gst + t.pst + t.qst + t.hst) * 1000) / 1000;

/**
 * Sales tax on a contract in the province. Where the contractor pays PST on installed materials
 * (BC; Manitoba general trades), the client is charged GST only and the PST belongs in the material cost.
 * Saskatchewan charges 6% PST on the total price. Manitoba electrical, plumbing and HVAC pay RST on the
 * whole supply-and-install charge. The trade defaults to 'general'.
 */
export function salesTax(province: string | null | undefined, opts: { trade?: Trade } = {}): SalesTax {
  const p = String(province ?? '').toUpperCase();
  const known = Object.prototype.hasOwnProperty.call(RATES, p);
  const code = known ? p : 'ON';
  let { note, ...t } = RATES[code];
  if (code === 'MB' && MB_TAXABLE_TRADES.includes(opts.trade ?? 'general')) t = { ...t, pstOnInstalledMaterials: false };
  const total = t.pstOnInstalledMaterials ? t.gst : sum(t);
  return { province: code, ...t, total, note };
}
