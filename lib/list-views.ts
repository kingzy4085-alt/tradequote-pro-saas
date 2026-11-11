// Named views of a module list, so the Command Center can link to "the overdue RFIs" rather than
// to all of them. `?view=overdue` matches the same rows the list highlights: both read the date
// rules in lib/alerts.ts, and it's worked out from the record's own date, so it's right even if
// last night's automation run was missed. Safe to import from the browser.
import { AUTOMATION_RULES } from './alerts';

const quoted = (values: readonly string[]) => values.map((v) => `"${v}"`).join(',');

function overdueRules(slug: string) {
  return AUTOMATION_RULES.filter((rule) => rule.module === slug && rule.overdueWord && rule.dateColumn);
}

const HOLDBACK_STATUSES = ['Sent', 'Overdue', 'Paid'];

/** The words on the list's filter chip, or null if this module has no such view. */
export function listViewLabel(slug: string, view: string | null | undefined): string | null {
  if (view === 'overdue') {
    const word = overdueRules(slug)[0]?.overdueWord;
    return word ? `${word} only` : null;
  }
  if (view === 'holdback' && slug === 'invoices') return 'With holdback';
  return null;
}

/** A PostgREST `or` filter for the view, or null. `today` is the company's date, from the server. */
export function listViewFilter(slug: string, view: string | null | undefined, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  if (view === 'overdue') {
    const parts = overdueRules(slug).map((rule) => {
      const late = `${rule.dateColumn}.lt.${today}`;
      return rule.statuses ? `and(${late},status.in.(${quoted(rule.statuses)}))` : late;
    });
    return parts.length ? parts.join(',') : null;
  }
  if (view === 'holdback' && slug === 'invoices') return `and(holdback_amount.gt.0,status.in.(${quoted(HOLDBACK_STATUSES)}))`;
  return null;
}
