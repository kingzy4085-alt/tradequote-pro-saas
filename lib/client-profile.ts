// The logic behind a client's profile page (/crm/[id]), kept apart from the page so the role gates
// and the sums can be tested. Records belong to a client through client_id only: a name typed on an
// estimate is not a link, and two clients can share one.
import { cents } from './billing-math';
import { dashboardAccess } from './dashboard';
import { getModule } from './modules';
import { ROLE_RANK, type Role } from './roles';

export const PROFILE_SECTIONS = [
  { slug: 'estimates', columns: 'id, title, status, total_amount, bid_due', amountKey: 'total_amount', dateKey: 'bid_due', dateLabel: 'Bid due', newLabel: 'New estimate for this client' },
  { slug: 'proposals', columns: 'id, title, status, total_amount, valid_until, estimate_id', amountKey: 'total_amount', dateKey: 'valid_until', dateLabel: 'Valid until', newLabel: 'New proposal for this client' },
  // A project's contract value is rank-gated in the database, so the list leaves it out
  { slug: 'projects', columns: 'id, title, status, site, start_date', amountKey: null, dateKey: 'start_date', dateLabel: 'Starts', newLabel: 'New project for this client' },
  { slug: 'invoices', columns: 'id, title, status, total, invoice_number, due_date', amountKey: 'total', dateKey: 'due_date', dateLabel: 'Due', newLabel: 'New invoice for this client' },
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];
export type ProfileSlug = ProfileSection['slug'];

export interface ProfileAccess {
  /** The sections this role may read, in page order. */
  sections: ProfileSection[];
  /** Sections this role may add a record to. Still needs an active subscription or trial. */
  canCreate: ProfileSlug[];
  /** Open pipeline: the same people the Command Center shows it to. */
  pipeline: boolean;
  /** Lifetime value and what is owed: finance only, and only with the invoices to back it. */
  finance: boolean;
  canEditNotes: boolean;
}

/** What a role sees on a client's profile, or null if it cannot open the client list at all. */
export function profileAccess(role: Role): ProfileAccess | null {
  const rank = ROLE_RANK[role];
  const crm = getModule('crm')!;
  if (rank < crm.read) return null;
  const money = dashboardAccess(rank);
  const readable = (slug: string) => rank >= getModule(slug)!.read;
  return {
    sections: PROFILE_SECTIONS.filter((s) => readable(s.slug)),
    canCreate: PROFILE_SECTIONS.filter((s) => rank >= getModule(s.slug)!.write).map((s) => s.slug),
    pipeline: money.jobMoney && readable('estimates') && readable('proposals'),
    finance: money.finance && readable('invoices'),
    canEditNotes: rank >= crm.write,
  };
}

type Amounts = { id: string; status: string; total_amount?: unknown; total?: unknown; estimate_id?: unknown };
const amount = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const sum = (rows: readonly Amounts[], pick: (r: Amounts) => unknown) => cents(rows.reduce((total, r) => total + amount(pick(r)), 0));

export interface ClientMoney {
  /** Every Paid invoice. */
  lifetimeValue: number;
  /** Sent proposals, plus Submitted estimates that have not become a proposal yet. */
  pipeline: number;
  sentProposals: number;
  submittedEstimates: number;
  /** Invoices sent and not yet paid, overdue ones included. */
  outstanding: number;
  unpaidInvoices: number;
  overdueInvoices: number;
}

/**
 * The three figures at the top of the profile. An estimate that already has a proposal out is
 * counted once, as the proposal, the same way the Command Center counts the pipeline.
 */
export function clientMoney(rows: { estimates?: readonly Amounts[]; proposals?: readonly Amounts[]; invoices?: readonly Amounts[] }): ClientMoney {
  const proposals = rows.proposals ?? [];
  const invoices = rows.invoices ?? [];
  const sent = proposals.filter((p) => p.status === 'Sent');
  const proposed = new Set(proposals.filter((p) => p.status !== 'Draft' && p.estimate_id).map((p) => String(p.estimate_id)));
  const submitted = (rows.estimates ?? []).filter((e) => e.status === 'Submitted' && !proposed.has(e.id));
  const unpaid = invoices.filter((i) => i.status === 'Sent' || i.status === 'Overdue');
  return {
    lifetimeValue: sum(invoices.filter((i) => i.status === 'Paid'), (i) => i.total),
    pipeline: cents(sum(sent, (p) => p.total_amount) + sum(submitted, (e) => e.total_amount)),
    sentProposals: sent.length,
    submittedEstimates: submitted.length,
    outstanding: sum(unpaid, (i) => i.total),
    unpaidInvoices: unpaid.length,
    overdueInvoices: unpaid.filter((i) => i.status === 'Overdue').length,
  };
}

/** A phone number as a tel: link, or null if there are no digits to dial. Extensions are dropped. */
export function telHref(phone: unknown): string | null {
  const raw = String(phone ?? '').split(/\s*(?:ext\.?|x)\s*\d+\s*$/i)[0];
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  return `tel:${raw.trim().startsWith('+') ? '+' : ''}${digits}`;
}

export function mailHref(email: unknown): string | null {
  const value = String(email ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? `mailto:${value}` : null;
}

const NEW_NOUN: Record<ProfileSlug, string> = { estimates: 'estimate', proposals: 'proposal', projects: 'project', invoices: 'invoice' };

/** The draft a "New ... for this client" button saves: linked by id, with the name copied on for print. */
export function newRecordBody(slug: ProfileSlug, client: { id: string; title: string }) {
  return {
    title: `New ${NEW_NOUN[slug]} for ${client.title}`.slice(0, 200),
    status: getModule(slug)!.statuses[0],
    client_id: client.id,
    client_name: client.title,
  };
}
