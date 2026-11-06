import { describe, expect, it } from 'vitest';
import { CompanyProfileSchema } from '@/lib/company';
import { DailyLogAction, photoFolder } from '@/lib/daily-log';
import { EstimateLinesSchema, estimateTotals, lineSellPrice } from '@/lib/estimate-math';
import { LeadSchema } from '@/lib/leads';
import { isPublicPath } from '@/middleware';

const line = (quantity: number, material: number, hours: number) => ({ description: 'x', unit: 'ea', quantity, material_unit_cost: material, labour_hours_per_unit: hours });

describe('estimate totals', () => {
  it('marks up material and labour, then taxes the marked-up price', () => {
    const t = estimateTotals([line(10, 2.5, 0.5), line(1, 100, 2)], 95, 15, 5);
    expect(t.material).toBe(125);
    expect(t.labourHours).toBe(7);
    expect(t.labour).toBe(665);
    expect(t.subtotal).toBe(790);
    expect(t.markup).toBe(118.5);
    expect(t.beforeTax).toBe(908.5);
    expect(t.tax).toBe(45.43);
    expect(t.total).toBe(953.93);
  });

  it('treats blanks and junk as zero and rounds to cents', () => {
    const t = estimateTotals([{ description: '', unit: '', quantity: '3', material_unit_cost: '0.333', labour_hours_per_unit: 'abc' }], '', null, undefined);
    expect(t.material).toBe(1);
    expect(t.total).toBe(1);
    expect(estimateTotals([], 100, 10, 5).total).toBe(0);
  });

  it('spreads markup across line sell prices that add up to the pre-tax subtotal', () => {
    const items = [line(10, 2.5, 0.5), line(1, 100, 2)];
    const t = estimateTotals(items, 95, 15, 5);
    const sum = items.reduce((s, _, i) => s + lineSellPrice(t, i, 95), 0);
    expect(Math.abs(sum - t.beforeTax)).toBeLessThan(0.02);
  });
});

describe('estimate line validation', () => {
  it('accepts numeric strings and blank amounts', () => {
    const r = EstimateLinesSchema.safeParse({ items: [{ description: ' Wire ', quantity: '2', unit: 'm', material_unit_cost: '1.239', labour_hours_per_unit: '' }] });
    expect(r.success && r.data.items[0]).toEqual({ description: 'Wire', quantity: 2, unit: 'm', material_unit_cost: 1.24, labour_hours_per_unit: 0 });
  });

  it('rejects negative or non-numeric amounts and too many lines', () => {
    expect(EstimateLinesSchema.safeParse({ items: [line(-1, 1, 1)] }).success).toBe(false);
    expect(EstimateLinesSchema.safeParse({ items: [{ ...line(1, 1, 1), material_unit_cost: 'ten' }] }).success).toBe(false);
    expect(EstimateLinesSchema.safeParse({ items: Array.from({ length: 1001 }, () => line(1, 1, 1)) }).success).toBe(false);
    expect(EstimateLinesSchema.safeParse({ items: 'nope' }).success).toBe(false);
  });
});

describe('daily log actions', () => {
  it('accepts sign, photos and reopen', () => {
    expect(DailyLogAction.safeParse({ action: 'sign', signed_by: 'Pat', signature: 'data:image/png;base64,AAAA' }).success).toBe(true);
    expect(DailyLogAction.safeParse({ action: 'photos', photos: ['a/daily-logs/b/c.jpg'] }).success).toBe(true);
    expect(DailyLogAction.safeParse({ action: 'reopen' }).success).toBe(true);
  });

  it('rejects unsigned sign-offs, non-PNG signatures, too many photos and unknown actions', () => {
    expect(DailyLogAction.safeParse({ action: 'sign', signed_by: '  ', signature: 'data:image/png;base64,AAAA' }).success).toBe(false);
    expect(DailyLogAction.safeParse({ action: 'sign', signed_by: 'Pat', signature: 'javascript:alert(1)' }).success).toBe(false);
    expect(DailyLogAction.safeParse({ action: 'photos', photos: Array.from({ length: 51 }, () => 'x') }).success).toBe(false);
    expect(DailyLogAction.safeParse({ action: 'delete' }).success).toBe(false);
  });

  it('builds the per-log photo folder', () => {
    expect(photoFolder('co', 'log')).toBe('co/daily-logs/log/');
  });
});

describe('company profile validation', () => {
  it('keeps only editable fields and clears blanks', () => {
    const r = CompanyProfileSchema.safeParse({ name: 'Alpha', phone: '', default_markup: '12.5', subscription_status: 'active', stripe_customer_id: 'cus_x' });
    expect(r.success && r.data).toEqual({ name: 'Alpha', phone: null, default_markup: 12.5 });
  });

  it('rejects bad values', () => {
    expect(CompanyProfileSchema.safeParse({ default_tax: 150 }).success).toBe(false);
    expect(CompanyProfileSchema.safeParse({ default_markup: -1 }).success).toBe(false);
    expect(CompanyProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
    expect(CompanyProfileSchema.safeParse({ province: 'XX' }).success).toBe(false);
    expect(CompanyProfileSchema.safeParse({ name: '' }).success).toBe(false);
  });
});

describe('founding-list signups', () => {
  it('requires name, company and a valid email', () => {
    expect(LeadSchema.safeParse({ name: 'A', company: 'B', email: 'A@B.CA', tier: 'Crew', billing: 'annual' }).success).toBe(true);
    expect(LeadSchema.safeParse({ name: 'A', company: 'B', email: 'nope' }).success).toBe(false);
    expect(LeadSchema.safeParse({ name: '', company: 'B', email: 'a@b.ca' }).success).toBe(false);
    expect(LeadSchema.safeParse({ name: 'A', company: 'B', email: 'a@b.ca', tier: 'Solo' }).success).toBe(false);
  });

  it('lowercases the email', () => {
    const r = LeadSchema.safeParse({ name: 'A', company: 'B', email: 'Pat@Example.CA' });
    expect(r.success && r.data.email).toBe('pat@example.ca');
  });
});

describe('public pages', () => {
  it('opens the sales pages, signup API and health check without signing in', () => {
    for (const p of ['/pricing', '/about', '/api/leads', '/api/health']) expect(isPublicPath(p)).toBe(true);
    for (const p of ['/help', '/settings/company', '/api/company', '/api/daily-logs/x', '/print/estimate/x', '/pricing-admin']) expect(isPublicPath(p)).toBe(false);
  });
});
