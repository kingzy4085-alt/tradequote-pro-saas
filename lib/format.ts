import type { FieldType } from './modules';

const cad = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const num = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 });

/** A label for mid-sentence use. Acronyms keep their capitals: "daily log", but "RFI" and "PO". */
export const inSentence = (label: string) => label.replace(/\b[A-Z][a-z]+\b/g, (word) => word.toLowerCase());

export function formatMoney(value: unknown): string {
  const n = Number(value);
  return Number.isFinite(n) ? cad.format(n) : '—';
}

export function formatValue(type: FieldType, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (type) {
    case 'money':
      return formatMoney(value);
    case 'number':
      return Number.isFinite(Number(value)) ? num.format(Number(value)) : String(value);
    case 'boolean':
      return value ? 'Yes' : 'No';
    case 'date': {
      // Dates are stored as YYYY-MM-DD; format without shifting time zones
      const [y, m, d] = String(value).split('-').map(Number);
      return y && m && d ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-CA', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' }) : String(value);
    }
    default:
      return String(value);
  }
}
