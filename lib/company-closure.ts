// Closing a company account, the steps before the database deletes it (public.close_company in
// 20261113000140_company_logo_and_closure.sql): stop Stripe billing, then remove the company's
// stored files. Each step runs before anything is deleted, so a failure leaves the account whole.
import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import { subscriptionEnded } from '@/lib/billing';
import { COMPANY_LOGOS_BUCKET } from '@/lib/company-logo';
import { JOB_PHOTOS_BUCKET } from '@/lib/daily-log';

/** Buckets that hold company files, each under <company id>/. */
export const COMPANY_FILE_BUCKETS = [JOB_PHOTOS_BUCKET, COMPANY_LOGOS_BUCKET];

export interface CompanyBilling {
  id: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

/**
 * True while Stripe may still charge this company: it is paying or past due, or it has a
 * subscription that has not been cancelled (an unfinished first payment can still go through).
 */
export function mayStillBill(company: Pick<CompanyBilling, 'subscription_status' | 'stripe_subscription_id'>): boolean {
  if (company.subscription_status === 'active' || company.subscription_status === 'past_due') return true;
  return !!company.stripe_subscription_id && company.subscription_status !== 'canceled';
}

const isMissing = (err: unknown) => (err as { code?: string } | null)?.code === 'resource_missing';
const customerOf = (sub: Pick<Stripe.Subscription, 'customer'>) => (typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null));

/**
 * Cancels, at once, every subscription Stripe could still bill the company for: all of its
 * customer's subscriptions that have not ended, and the one on the company row. Returns their ids.
 * Throws if Stripe can't be reached, so the caller stops before deleting anything.
 */
export async function cancelCompanySubscriptions(stripe: Stripe, company: CompanyBilling): Promise<string[]> {
  const live = new Set<string>();
  if (company.stripe_customer_id) {
    let startingAfter: string | undefined;
    for (;;) {
      let page: Stripe.ApiList<Stripe.Subscription>;
      try {
        page = await stripe.subscriptions.list({ customer: company.stripe_customer_id, status: 'all', limit: 100, ...(startingAfter ? { starting_after: startingAfter } : {}) });
      } catch (err) {
        // A customer deleted in Stripe has nothing left to bill
        if (isMissing(err)) break;
        throw err;
      }
      for (const sub of page.data) if (!subscriptionEnded(sub.status)) live.add(sub.id);
      if (!page.has_more || !page.data.length) break;
      startingAfter = page.data[page.data.length - 1].id;
    }
  }
  if (company.stripe_subscription_id && !live.has(company.stripe_subscription_id)) {
    let sub: Stripe.Subscription | null = null;
    try {
      sub = await stripe.subscriptions.retrieve(company.stripe_subscription_id);
    } catch (err) {
      if (!isMissing(err)) throw err;
    }
    // Never another customer's subscription, whatever the row says
    const ours = !company.stripe_customer_id || (sub && customerOf(sub) === company.stripe_customer_id);
    if (sub && ours && !subscriptionEnded(sub.status)) live.add(sub.id);
  }
  for (const id of live) {
    await stripe.subscriptions.cancel(id, {}, { idempotencyKey: `close-company:${company.id}:${id}` });
  }
  return [...live];
}

type Storage = ReturnType<SupabaseClient['storage']['from']>;
type Listed = { name: string; id: string | null };

export interface FileRemoval {
  /** Files deleted. */
  removed: number;
  /** Files found that the caller may not delete (a photo on a signed or locked record, or any file once the company has lapsed). */
  left: string[];
  /** False when a folder could not be listed, or time ran out: there may be files nobody counted. */
  complete: boolean;
}

const LIST_PAGE = 1000;
const REMOVE_BATCH = 500;
const LIST_AT_ONCE = 8;

/** Files and sub-folders directly inside one folder. */
async function listFolder(storage: Storage, folder: string): Promise<{ files: string[]; folders: string[] } | null> {
  const files: string[] = [];
  const folders: string[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await storage.list(folder, { limit: LIST_PAGE, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) {
      console.error(`Could not list ${folder}`, error);
      return null;
    }
    const entries = (data ?? []) as Listed[];
    // Storage lists a folder as an entry with no id
    for (const entry of entries) (entry.id ? files : folders).push(`${folder}/${entry.name}`);
    if (entries.length < LIST_PAGE) return { files, folders };
  }
}

/** Every file under <company id>/ in one bucket that the caller can see, until the deadline. */
async function listCompanyFiles(storage: Storage, companyId: string, deadline: number): Promise<{ files: string[]; complete: boolean }> {
  const files: string[] = [];
  const queue = [companyId];
  let complete = true;
  while (queue.length) {
    if (Date.now() > deadline) return { files, complete: false };
    const listed = await Promise.all(queue.splice(0, LIST_AT_ONCE).map((folder) => listFolder(storage, folder)));
    for (const result of listed) {
      if (!result) {
        complete = false;
        continue;
      }
      files.push(...result.files);
      queue.push(...result.folders);
    }
  }
  return { files, complete };
}

/**
 * Removes every stored file of the company that the caller is allowed to remove, as the signed-in
 * user. Storage's own rules decide: what they protect stays, and is reported in `left`.
 */
export async function removeCompanyFiles(supabase: Pick<SupabaseClient, 'storage'>, companyId: string, options: { timeLimitMs?: number } = {}): Promise<FileRemoval> {
  const deadline = Date.now() + (options.timeLimitMs ?? 20_000);
  const result: FileRemoval = { removed: 0, left: [], complete: true };
  for (const bucket of COMPANY_FILE_BUCKETS) {
    const storage = supabase.storage.from(bucket);
    const { files, complete } = await listCompanyFiles(storage, companyId, deadline);
    if (!complete) result.complete = false;
    for (let i = 0; i < files.length; i += REMOVE_BATCH) {
      const batch = files.slice(i, i + REMOVE_BATCH);
      const { data, error } = await storage.remove(batch);
      if (error) {
        console.error(`Could not remove files from ${bucket}`, error);
        result.left.push(...batch);
        continue;
      }
      const gone = new Set(((data ?? []) as { name: string }[]).map((f) => f.name));
      result.removed += gone.size;
      result.left.push(...batch.filter((path) => !gone.has(path)));
    }
  }
  return result;
}
