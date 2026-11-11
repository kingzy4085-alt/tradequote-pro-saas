// The client portal link: a random token in the URL, and only its hash in the database.
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { SignatureImage, SignerName } from './signature';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes, URL-safe. Shown to the contractor once and never stored. */
export const newPortalToken = () => randomBytes(32).toString('base64url');

export const isPortalToken = (value: unknown): value is string => typeof value === 'string' && TOKEN.test(value);

/** What the database stores and looks up by. */
export const hashPortalToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const portalUrl = (siteUrl: string, token: string) => `${siteUrl.replace(/\/$/, '')}/portal/${token}`;

export const PortalDecision = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('accepted'), name: SignerName, signature: SignatureImage }),
  z.object({ decision: z.literal('declined'), name: z.string().trim().max(200).optional(), reason: z.string().trim().max(2000).optional() }),
]);
export type PortalDecision = z.infer<typeof PortalDecision>;

export type PortalState = 'open' | 'accepted' | 'declined' | 'closed';

export interface PortalView {
  state: PortalState;
  company: { name: string; contact?: string | null; phone?: string | null; email?: string | null; address?: string | null };
  proposal?: { title: string; client_name: string | null; scope_of_work: string | null; terms: string | null; total_amount: number | null; valid_until: string | null; created_on: string };
  expires_at?: string;
  decided_at?: string | null;
  signer_name?: string | null;
}

export interface ShareRow {
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  first_viewed_at: string | null;
  decided_at: string | null;
  decision: 'accepted' | 'declined' | null;
  signer_name: string | null;
  decline_reason: string | null;
}

export type ShareStatus = 'none' | 'live' | 'viewed' | 'accepted' | 'declined' | 'expired' | 'revoked';

/** What the contractor sees about the newest link for a proposal. */
export function shareStatus(share: ShareRow | null | undefined, now: Date = new Date()): ShareStatus {
  if (!share) return 'none';
  if (share.decision) return share.decision;
  if (share.revoked_at) return 'revoked';
  if (new Date(share.expires_at) <= now) return 'expired';
  return share.first_viewed_at ? 'viewed' : 'live';
}
