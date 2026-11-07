-- ============================================================================
-- TradeQuote PRO — trial onboarding emails
-- Run after 20261101000000_saas_core.sql (and the job-photos storage migration). Both tables are written only by the
-- server (service role) from the daily /api/cron/trial-emails job and the
-- unsubscribe link; signed-in users can't read or change them.
-- ============================================================================

-- One row per company and step, claimed before sending so a step is never sent twice
create table public.trial_emails (
  company_id uuid not null references public.companies(id) on delete cascade,
  step text not null check (char_length(step) between 1 and 40),
  recipient text not null,
  sent_at timestamptz not null default now(),
  primary key (company_id, step)
);

-- People who clicked unsubscribe. Kept after account deletion so they are never emailed again.
create table public.email_unsubscribes (
  email text primary key check (email = lower(email) and char_length(email) <= 320),
  unsubscribed_at timestamptz not null default now()
);

alter table public.trial_emails enable row level security;
alter table public.email_unsubscribes enable row level security;
revoke all on public.trial_emails, public.email_unsubscribes from anon, authenticated;
