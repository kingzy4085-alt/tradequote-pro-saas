// The company's GST/HST registration number: accepted on the profile, printed on the letterhead,
// and in the database readable by the company and changeable only by its owner and admins.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { COMPANY_PROFILE_COLUMNS, CompanyProfileSchema } from '@/lib/company';
import { Letterhead } from '@/lib/print';
import { bootDb, type TestDb } from './helpers/db';

describe('GST/HST number on the profile and the letterhead', () => {
  it('is trimmed, blank clears it, and it has a sensible length limit', () => {
    expect(CompanyProfileSchema.parse({ tax_number: '  12345 6789 RT0001 ' }).tax_number).toBe('12345 6789 RT0001');
    expect(CompanyProfileSchema.parse({ tax_number: '   ' }).tax_number).toBeNull();
    expect(CompanyProfileSchema.safeParse({ tax_number: 'x'.repeat(41) }).success).toBe(false);
    expect(COMPANY_PROFILE_COLUMNS.split(', ')).toContain('tax_number');
  });

  it('prints on every document with a letterhead, and leaves no empty line when it is not set', () => {
    const company = { name: 'Alpha Electric', address: '1 Main St', phone: '306-555-0100', contact: null, email: 'a@alpha.ca' };
    const withNumber = renderToStaticMarkup(createElement(Letterhead, { company: { ...company, tax_number: '12345 6789 RT0001' }, document: 'Invoice' }));
    expect(withNumber).toContain('GST/HST No. 12345 6789 RT0001');
    expect(renderToStaticMarkup(createElement(Letterhead, { company, document: 'Invoice' }))).not.toContain('GST/HST');
  });

  it('is shown as text, never as markup', () => {
    const html = renderToStaticMarkup(createElement(Letterhead, { company: { name: 'A', tax_number: '<img src=x onerror=alert(1)>' }, document: 'Invoice' }));
    expect(html).not.toContain('<img');
  });
});

const users = {
  ownerA: { id: '00000000-0000-4000-8000-0000000000a1', email: 'owner@alpha.ca' },
  pmA: { id: '00000000-0000-4000-8000-0000000000a3', email: 'pm@alpha.ca' },
  elecA: { id: '00000000-0000-4000-8000-0000000000a2', email: 'sparky@alpha.ca' },
  ownerB: { id: '00000000-0000-4000-8000-0000000000b1', email: 'owner@bravo.ca' },
};
type U = keyof typeof users;

describe('GST/HST number in the database', () => {
  let t: TestDb<U>;
  let alpha: string;

  beforeAll(async () => {
    t = await bootDb(users);
    alpha = await t.createCompany('ownerA', 'Alpha Electric');
    await t.createCompany('ownerB', 'Bravo Power');
    await t.join('ownerA', 'pmA', 'project_manager');
    await t.join('ownerA', 'elecA', 'electrician');
  });

  it('the owner sets it, and everyone in the company can read it for the documents they print', async () => {
    expect((await t.as('ownerA', `update public.companies set tax_number = '12345 6789 RT0001' where id = $1 returning id`, [alpha])).length).toBe(1);
    for (const who of ['ownerA', 'pmA', 'elecA'] as const) {
      expect(await t.as(who, 'select tax_number from public.companies')).toEqual([{ tax_number: '12345 6789 RT0001' }]);
    }
  });

  it('a project manager or electrician cannot change it', async () => {
    for (const who of ['pmA', 'elecA'] as const) {
      expect(await t.as(who, `update public.companies set tax_number = 'forged' where id = $1 returning id`, [alpha])).toEqual([]);
    }
    expect((await t.asSystem<{ tax_number: string }>('select tax_number from public.companies where id = $1', [alpha]))[0].tax_number).toBe('12345 6789 RT0001');
  });

  it('another company and a visitor see nothing of it', async () => {
    expect(await t.as('ownerB', 'select tax_number from public.companies')).toEqual([{ tax_number: null }]);
    expect(await t.as('ownerB', `update public.companies set tax_number = 'forged' where id = $1 returning id`, [alpha])).toEqual([]);
    expect(await t.fails(null, 'select tax_number from public.companies')).toMatch(/permission denied/);
  });

  it('refuses a number longer than fits on the page', async () => {
    expect(await t.fails('ownerA', `update public.companies set tax_number = $2 where id = $1`, [alpha, 'x'.repeat(41)])).toMatch(/check constraint/);
  });
});
