-- A company's GST/HST registration number, printed on invoices and other documents.
-- A Canadian customer needs it on an invoice to claim the tax back. Safe to run more than once.
alter table public.companies add column if not exists tax_number text check (char_length(tax_number) <= 40);

-- Columns on companies are granted one by one, so a new one needs its own (see 20261104000320_review_fixes.sql).
-- Reading is for everyone in the company; row security and companies_update keep changes to the owner and admins.
grant select (tax_number) on public.companies to authenticated;
grant update (tax_number) on public.companies to authenticated;