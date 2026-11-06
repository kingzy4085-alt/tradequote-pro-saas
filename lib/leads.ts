import { z } from 'zod';

const optional = (max: number) => z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().trim().max(max).optional());

/** Founding-list signup from the public pricing page. `tier` and `billing` are no longer sent: the page sells one plan. `website` is a honeypot real visitors never see. */
export const LeadSchema = z.object({
  name: z.string().trim().min(1, 'Name, company and a valid email are required.').max(200),
  company: z.string().trim().min(1, 'Name, company and a valid email are required.').max(200),
  email: z.string().trim().toLowerCase().email('Name, company and a valid email are required.').max(320),
  phone: optional(40),
  tier: z.enum(['Field', 'Crew', 'Contractor', 'Enterprise']).optional(),
  billing: z.enum(['monthly', 'annual']).optional(),
  website: z.string().max(200).optional(),
});
