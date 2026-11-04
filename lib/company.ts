import { z } from 'zod';
import { PROVINCES } from './provinces';

const text = (max: number) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().max(max).nullable()).optional();
const percent = (max: number) => z.coerce.number().finite().min(0, 'Must be 0 or more').max(max).optional();

/** Fields an owner or admin can change on the company profile. Columns match the companies table grants. */
export const CompanyProfileSchema = z
  .object({
    name: z.string().trim().min(1, 'Enter your company name').max(200).optional(),
    province: z.enum(PROVINCES.map((p) => p.code) as [string, ...string[]]).optional(),
    contact: text(200),
    phone: text(40),
    email: z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().email('Enter a valid email').max(320).nullable()).optional(),
    address: text(500),
    default_markup: percent(1000),
    default_tax: percent(100),
    default_labour_rate: percent(100000),
    default_terms: text(10000),
    overtime_multiplier: z.coerce.number().finite().min(1, 'Must be at least 1').max(10, 'Must be 10 or less').optional(),
    default_holdback_pct: percent(100),
  })
  .strip();

export const COMPANY_PROFILE_COLUMNS = 'id, name, province, contact, phone, email, address, default_markup, default_tax, default_labour_rate, default_terms, overtime_multiplier, default_holdback_pct';
