-- The daily automation: status flips, alerts, the digest's bookkeeping and health records.
-- Safe to run more than once. The cron routes call run_company_automation as the service
-- role, one company at a time. Rows flip only where a WHERE says they should, so a second
-- run on the same date changes nothing and adds no events.
--
-- Who owns which status:
--   Invoice Paid and Void, and Draft: the billing engine. Only Sent <-> Overdue flips here,
--   which guard_invoice leaves to "the overdue job".
--   Receivable age: billing's receivable_age_status decides the bucket, this file only asks
--   again each day, since nothing else moves a date-driven status forward. Collected stays.
--   Job cost status, signed safety records and timecards: not touched here.
--
-- No provincial lien or WCB period is hard-coded. Holdback alerts use the release date the
-- company typed, and the WCB reminder names no deadline.

-- Tables --------------------------------------------------------------------------
create table if not exists public.automation_rules (
  key text primary key,
  module text not null,
  table_name text not null,
  grp text not null check (grp in ('Finance', 'Compliance', 'Field', 'Sales')),
  kind text not null check (kind in ('date', 'age', 'condition')),
  min_rank integer not null check (min_rank between 1 and 5),
  date_column text,
  statuses text[],
  offsets integer[],
  weekly boolean not null default false,
  age_days integer,
  where_sql text,
  bucket_sql text,
  detail_sql text,
  msg_soon text not null,
  msg_past text,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  immediate boolean not null default false,
  on_write boolean not null default false
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  rule_key text not null references public.automation_rules(key) on delete cascade,
  module text not null,
  record_id uuid not null,
  title text not null,
  message text not null,
  severity text not null check (severity in ('critical', 'warning', 'info')),
  min_rank integer not null check (min_rank between 1 and 5),
  bucket text not null,
  due_on date,
  immediate boolean not null default false,
  emailed_at timestamptz,
  -- Set when no email is owed: the daily run found a record that was already old, so it is not news
  no_email_reason text,
  bucket_changed_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, rule_key, record_id)
);
alter table public.alerts add column if not exists no_email_reason text;
create index if not exists alerts_open_idx on public.alerts(company_id, severity) where resolved_at is null;
create index if not exists alerts_changed_idx on public.alerts(company_id, bucket_changed_at) where resolved_at is null;
create index if not exists alerts_unsent_idx on public.alerts(created_at) where immediate and emailed_at is null and resolved_at is null;
create index if not exists alerts_resolved_idx on public.alerts(resolved_at) where resolved_at is not null;

-- Snoozing or dismissing is one person's choice. It never hides an alert from anyone else.
create table if not exists public.alert_member_state (
  alert_id uuid not null references public.alerts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  snoozed_until date,
  -- Hidden until the alert moves to another bucket: 30 days overdue comes back at 60
  dismissed_bucket text,
  updated_at timestamptz not null default now(),
  primary key (alert_id, user_id)
);

create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  run_date date not null,
  kind text not null check (kind in ('status_flip', 'alert_raised', 'alert_changed', 'alert_resolved')),
  rule_key text not null,
  table_name text not null,
  record_id uuid not null,
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);
create index if not exists automation_events_company_idx on public.automation_events(company_id, created_at desc);
create index if not exists automation_events_age_idx on public.automation_events(created_at);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  job text not null check (char_length(job) <= 40),
  companies_ok integer not null default 0,
  companies_failed integer not null default 0,
  duration_ms integer not null default 0,
  out_of_time boolean not null default false,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists automation_runs_job_idx on public.automation_runs(job, created_at desc);

create table if not exists public.automation_company_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  last_run_date date not null,
  last_run_at timestamptz not null default now()
);

create table if not exists public.digest_sends (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_date date not null,
  sent_at timestamptz not null default now(),
  primary key (company_id, user_id, digest_date)
);
create index if not exists digest_sends_age_idx on public.digest_sends(digest_date);

-- Unsubscribe scopes. Everything already on the list came from trial emails, so it is marketing.
alter table public.email_unsubscribes add column if not exists scope text not null default 'marketing';
alter table public.email_unsubscribes drop constraint if exists email_unsubscribes_scope_check;
alter table public.email_unsubscribes add constraint email_unsubscribes_scope_check check (scope in ('marketing', 'alerts'));
do $$
begin
  if not exists (select 1 from information_schema.key_column_usage
                 where table_schema = 'public' and table_name = 'email_unsubscribes' and column_name = 'scope') then
    alter table public.email_unsubscribes drop constraint email_unsubscribes_pkey;
    alter table public.email_unsubscribes add primary key (email, scope);
  end if;
end $$;

-- Access ---------------------------------------------------------------------------
alter table public.automation_rules enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_member_state enable row level security;
alter table public.automation_events enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_company_state enable row level security;
alter table public.digest_sends enable row level security;

revoke all on public.automation_rules, public.alerts, public.alert_member_state, public.automation_events,
  public.automation_runs, public.automation_company_state, public.digest_sends from anon, authenticated;
grant select on public.alerts, public.automation_company_state to authenticated;
grant select, insert, update, delete on public.alert_member_state to authenticated;

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated
  using (company_id = public.user_company_id() and public.user_rank() >= min_rank
         -- It's for rank 1 so an electrician can be told, but only about their own card
         and (rule_key <> 'timecards.rejected' or exists (select 1 from public.timecards t where t.id = record_id and t.worker_user_id = auth.uid())));

drop policy if exists automation_company_state_select on public.automation_company_state;
create policy automation_company_state_select on public.automation_company_state for select to authenticated
  using (company_id = public.user_company_id());

drop policy if exists alert_member_state_select on public.alert_member_state;
create policy alert_member_state_select on public.alert_member_state for select to authenticated
  using (user_id = auth.uid());
drop policy if exists alert_member_state_insert on public.alert_member_state;
create policy alert_member_state_insert on public.alert_member_state for insert to authenticated
  with check (user_id = auth.uid() and public.company_can_write() and exists (select 1 from public.alerts a where a.id = alert_id));
drop policy if exists alert_member_state_update on public.alert_member_state;
create policy alert_member_state_update on public.alert_member_state for update to authenticated
  using (user_id = auth.uid() and public.company_can_write())
  with check (user_id = auth.uid() and exists (select 1 from public.alerts a where a.id = alert_id));
drop policy if exists alert_member_state_delete on public.alert_member_state;
create policy alert_member_state_delete on public.alert_member_state for delete to authenticated
  using (user_id = auth.uid() and public.company_can_write());

-- The rules, matching AUTOMATION_RULES in lib/alerts.ts. tests/automation.test.ts keeps them equal.
insert into public.automation_rules (key, module, table_name, grp, kind, min_rank, date_column, statuses, offsets, weekly, age_days, where_sql, bucket_sql, detail_sql, msg_soon, msg_past, severity, immediate, on_write) values
  ('invoices.due', 'invoices', 'invoices', 'Finance', 'date', 4, 'due_date', array['Sent', 'Overdue'], array[3, 0, -1, -30, -60, -90], false, null, null, null, null, 'Payment due in {n}', 'Payment overdue by {n}', 'critical', false, false),
  ('receivables.overdue', 'receivables', 'receivables', 'Finance', 'date', 4, 'due_date', array['Current', '30 Days', '60 Days', '90+ Days'], array[-30, -60, -90], false, null, null, null, null, 'Due in {n}', 'Still unpaid {n} past due', 'critical', false, false),
  ('payables.due', 'payables', 'payables', 'Finance', 'date', 4, 'due_date', array['To Approve', 'Approved'], array[7, 0, -1], false, null, null, null, null, 'Bill due in {n}', 'Bill overdue by {n}', 'critical', false, false),
  ('purchase_orders.required', 'purchase-orders', 'purchase_orders', 'Finance', 'date', 3, 'required_date', array['Issued', 'Partially Received'], array[7, 2, -1], false, null, null, null, null, 'Material required on site in {n}', 'Material late by {n}', 'warning', false, false),
  ('progress_billing.holdback', 'progress-billing', 'progress_billing', 'Finance', 'date', 3, 'holdback_release_date', null, array[7, 0], false, null, 'r.holdback_percent is null or r.holdback_percent > 0', null, null, 'Holdback release date in {n}', 'Holdback release date passed {n} ago', 'warning', false, false),
  ('invoices.holdback', 'invoices', 'invoices', 'Finance', 'date', 4, 'holdback_release_date', array['Sent', 'Overdue', 'Paid'], array[7, 0], false, null, 'r.holdback_amount > 0 and not exists (select 1 from public.progress_billing d where d.invoice_id = r.id and d.holdback_release_date is not null and (d.holdback_percent is null or d.holdback_percent > 0))', null, null, 'Holdback release date in {n}', 'Holdback release date passed {n} ago', 'warning', false, false),
  ('sub_compliance.liability', 'sub-compliance', 'sub_compliance', 'Compliance', 'date', 2, 'liability_expiry', null, array[30, 14, 7, 0, -1], false, null, null, null, null, 'Liability insurance expires in {n}', 'Liability insurance expired {n} ago', 'critical', false, false),
  ('sub_compliance.wcb', 'sub-compliance', 'sub_compliance', 'Compliance', 'date', 2, 'wcb_clearance_expiry', null, array[14, 7, 0, -1], false, null, null, null, null, 'WCB clearance expires in {n}', 'WCB clearance expired {n} ago', 'critical', false, false),
  ('sub_compliance.missing', 'sub-compliance', 'sub_compliance', 'Compliance', 'condition', 2, null, null, null, false, null, 'r.liability_expiry is null or r.wcb_clearance_expiry is null', null, null, 'Insurance or WCB expiry date is missing', null, 'warning', false, false),
  ('sub_compliance.safety_cert', 'sub-compliance', 'sub_compliance', 'Compliance', 'condition', 2, null, null, null, false, null, 'r.safety_cert_verified = false', null, null, 'COR or safety certificate not verified', null, 'info', false, false),
  ('vendors.insurance', 'vendors', 'vendors', 'Compliance', 'date', 2, 'insurance_expiry', array['Preferred', 'Approved'], array[30, 14, 0], false, null, null, null, null, 'Insurance expires in {n}', 'Insurance expired {n} ago', 'critical', false, false),
  ('employees.ticket', 'employees', 'employees', 'Compliance', 'date', 4, 'ticket_expiry', array['Active'], array[60, 30, 7, 0, -1], false, null, null, null, null, 'Tickets expire in {n}', 'Tickets expired {n} ago', 'critical', false, false),
  ('warranty.expiry', 'warranty', 'warranty', 'Compliance', 'date', 2, 'expiry_date', array['Active', 'Expiring'], array[60, 30, 7], false, null, null, null, null, 'Warranty ends in {n}', 'Warranty ended {n} ago', 'warning', false, false),
  ('warehouse.low_stock', 'warehouse-inventory', 'warehouse_inventory', 'Compliance', 'condition', 2, null, array['Low', 'Out of Stock'], null, false, null, null, 'r.status', 'case when r.status = ''Out of Stock'' then ''Out of stock. Reorder now.'' else ''Stock is at or below the reorder point.'' end', '', null, 'warning', false, true),
  ('equipment_rentals.off_rent', 'equipment-rentals', 'equipment_rentals', 'Field', 'date', 1, 'off_rent_date', array['On Rent'], array[2, 0, -1], true, null, null, null, 'case when isfinite(r.off_rent_date) and r.daily_rate is not null and $2 > r.off_rent_date then ''Accrued since then: $'' || to_char(($2 - r.off_rent_date) * r.daily_rate, ''FM999,999,990.00'') || ''.'' end', 'Off-rent date in {n}', 'Past its off-rent date by {n}.', 'warning', false, false),
  ('equipment_rentals.no_date', 'equipment-rentals', 'equipment_rentals', 'Field', 'age', 1, 'created_at', array['On Rent'], null, false, 31, 'r.off_rent_date is null', null, null, 'On rent for {n} with no off-rent date', null, 'info', false, false),
  ('tool_crib.due_back', 'tool-crib', 'tool_crib', 'Field', 'date', 1, 'due_back', array['Checked Out'], array[0, -1], true, null, null, null, null, 'Due back in {n}', 'Tool late by {n}', 'warning', false, false),
  ('inspections.scheduled', 'inspections', 'inspections', 'Field', 'date', 1, 'inspection_date', array['Scheduled'], array[2, 0, -1], false, null, null, null, null, 'Inspection in {n}', 'Inspection was {n} ago. Record the result.', 'warning', false, false),
  ('inspections.failed_followup', 'inspections', 'inspections', 'Field', 'age', 1, 'inspection_date', array['Failed', 'Re-inspect'], null, false, 7, 'not exists (select 1 from public.inspections n where n.company_id = r.company_id and n.id <> r.id and (n.project_id = r.project_id or n.title = r.title) and coalesce(n.inspection_date, n.created_at::date) > coalesce(r.inspection_date, r.created_at::date))', null, null, 'No re-inspection booked {n} after the result', null, 'warning', false, false),
  ('inspections.failed', 'inspections', 'inspections', 'Field', 'condition', 2, null, array['Failed'], null, false, null, null, null, null, 'Inspection failed', null, 'critical', true, true),
  ('rfis.due', 'rfis', 'rfis', 'Field', 'date', 1, 'due_date', array['Open'], array[2, 0, -1], true, null, null, null, null, 'Answer due in {n}', 'Answer overdue by {n}', 'warning', false, false),
  ('rfis.no_date', 'rfis', 'rfis', 'Field', 'age', 1, 'created_at', array['Open'], null, false, 8, 'r.due_date is null', null, null, 'Open for {n} with no response date', null, 'info', false, false),
  ('submittals.pending', 'submittals', 'submittals', 'Field', 'age', 1, 'created_at', array['Pending Review'], null, false, 14, null, null, null, 'Waiting on review for {n}', null, 'warning', false, false),
  ('punch_list.due', 'punch-list', 'punch_list', 'Field', 'date', 1, 'due_date', array['Open', 'In Progress', 'Ready for Review'], array[2, 0, -1], false, null, null, null, null, 'Punch item due in {n}', 'Punch item overdue by {n}', 'warning', false, false),
  ('punch_list.blocker', 'punch-list', 'punch_list', 'Field', 'date', 1, 'due_date', array['Open', 'In Progress', 'Ready for Review'], array[7], false, null, 'r.priority = ''Critical / Inspection Blocker'' and r.due_date > $2 + 2', null, null, 'Inspection blocker due in {n}', null, 'warning', false, false),
  ('tasks.due', 'tasks', 'tasks', 'Field', 'date', 1, 'due_date', array['To Do', 'In Progress'], array[0, -1], false, null, null, null, null, 'Task due in {n}', 'Task overdue by {n}', 'warning', false, false),
  ('maintenance.due', 'maintenance', 'maintenance', 'Field', 'date', 1, 'due_date', array['Scheduled'], array[7, 0, -1], false, null, null, null, null, 'Service due in {n}', 'Service overdue by {n}', 'warning', false, false),
  ('safety_logs.open', 'safety-logs', 'safety_logs', 'Field', 'age', 1, 'created_at', array['Open', 'Under Investigation'], null, false, 8, null, null, null, 'Incident still open after {n}', null, 'warning', false, false),
  ('safety_logs.incident', 'safety-logs', 'safety_logs', 'Field', 'condition', 2, null, null, null, false, null, '(r.severity in (''High'', ''Critical'') or r.incident_type in (''Medical Aid'', ''Lost Time'')) and (r.status in (''Open'', ''Under Investigation'') or (r.updated_at = r.created_at and $2 - public.alert_local_date(r.created_at, $7) <= 7))', null, 'concat_ws('', '', r.severity, r.incident_type) || '' incident reported.'' || case when r.status = ''Resolved'' then '' Logged as already resolved.'' else '''' end', '', null, 'critical', true, true),
  ('safety_logs.wcb_reminder', 'safety-logs', 'safety_logs', 'Field', 'age', 2, 'created_at', null, null, false, 1, 'r.incident_type in (''Medical Aid'', ''Lost Time'') and (r.status in (''Open'', ''Under Investigation'') or $2 - public.alert_local_date(r.created_at, $7) <= 7)', null, null, 'Check this has been reported to your province''s WCB. Logged {n} ago.', null, 'critical', false, false),
  ('safety_inspections.unsafe', 'safety-inspections', 'safety_inspections', 'Field', 'condition', 2, null, null, null, false, null, 'r.result = ''Unsafe: Work Stopped''', null, null, 'Safety inspection found it unsafe. Work stopped.', null, 'critical', true, true),
  ('loto_permits.open', 'loto-permits', 'loto_permits', 'Field', 'age', 1, 'created_at', array['Draft', 'Locked Out', 'Verified Zero Energy'], null, false, 8, null, null, null, 'Permit not released after {n}', null, 'warning', false, false),
  ('tailgate_logs.sign_off', 'tailgate-logs', 'tailgate_logs', 'Field', 'age', 1, 'created_at', array['Needs Sign-off'], null, false, 2, null, null, null, 'Waiting on sign-off for {n}', null, 'warning', false, false),
  ('daily_logs.draft', 'daily-logs', 'daily_logs', 'Field', 'age', 1, 'created_at', array['Draft'], null, false, 3, null, null, null, 'Still a draft after {n}', null, 'info', false, false),
  ('timecards.submitted', 'timecards', 'timecards', 'Field', 'age', 3, 'created_at', array['Submitted'], null, false, 4, null, null, null, 'Waiting on approval for {n}', null, 'warning', false, false),
  ('timecards.rejected', 'timecards', 'timecards', 'Field', 'condition', 1, null, array['Rejected'], null, false, null, null, null, 'case when btrim(coalesce(r.reject_reason, '''')) <> '''' then ''Reason: '' || r.reject_reason end', 'Timecard sent back. Fix it and save to resubmit.', null, 'warning', false, true),
  ('proposals.valid', 'proposals', 'proposals', 'Sales', 'date', 3, 'valid_until', array['Sent'], array[7, 0], false, null, null, null, null, 'Prices lapse in {n}', 'Prices lapsed {n} ago', 'warning', false, false),
  ('proposals.follow_up', 'proposals', 'proposals', 'Sales', 'age', 3, 'updated_at', array['Sent'], null, false, 14, null, null, null, 'No change in {n}. Time to follow up.', null, 'info', false, false),
  ('estimates.bid_due', 'estimates', 'estimates', 'Sales', 'date', 3, 'bid_due', array['Draft', 'Submitted'], array[3, 1], false, null, null, null, null, 'Bid due in {n}', 'Bid date passed {n} ago', 'warning', false, false),
  ('rfq.deadline', 'rfq', 'rfq', 'Sales', 'date', 2, 'deadline', array['Sent'], array[2, 0], false, null, null, null, null, 'Quote due in {n}', 'Quote late by {n}', 'warning', false, false),
  ('rfp.closing', 'rfp', 'rfp', 'Sales', 'date', 3, 'closing_date', array['Reviewing', 'Bidding'], array[7, 2], false, null, null, null, null, 'Closes in {n}', 'Closed {n} ago', 'warning', false, false),
  ('projects.overrun', 'projects', 'projects', 'Sales', 'date', 1, 'revised_end_date', array['Active'], array[-1], true, null, null, null, null, 'Ends in {n}', 'Past its end date by {n}', 'warning', false, false)
on conflict (key) do update set module = excluded.module, table_name = excluded.table_name, grp = excluded.grp, kind = excluded.kind, min_rank = excluded.min_rank, date_column = excluded.date_column, statuses = excluded.statuses, offsets = excluded.offsets, weekly = excluded.weekly, age_days = excluded.age_days, where_sql = excluded.where_sql, bucket_sql = excluded.bucket_sql, detail_sql = excluded.detail_sql, msg_soon = excluded.msg_soon, msg_past = excluded.msg_past, severity = excluded.severity, immediate = excluded.immediate, on_write = excluded.on_write;
delete from public.automation_rules where key not in ('invoices.due', 'invoices.holdback', 'receivables.overdue', 'payables.due', 'purchase_orders.required', 'progress_billing.holdback', 'sub_compliance.liability', 'sub_compliance.wcb', 'sub_compliance.missing', 'sub_compliance.safety_cert', 'vendors.insurance', 'employees.ticket', 'warranty.expiry', 'warehouse.low_stock', 'equipment_rentals.off_rent', 'equipment_rentals.no_date', 'tool_crib.due_back', 'inspections.scheduled', 'inspections.failed_followup', 'inspections.failed', 'rfis.due', 'rfis.no_date', 'submittals.pending', 'punch_list.due', 'punch_list.blocker', 'tasks.due', 'maintenance.due', 'safety_logs.open', 'safety_logs.incident', 'safety_logs.wcb_reminder', 'safety_inspections.unsafe', 'loto_permits.open', 'tailgate_logs.sign_off', 'daily_logs.draft', 'timecards.submitted', 'timecards.rejected', 'proposals.valid', 'proposals.follow_up', 'estimates.bid_due', 'rfq.deadline', 'rfp.closing', 'projects.overrun');

-- Low stock ------------------------------------------------------------------------
-- Right the moment it's saved, whatever status was sent. No quantity, no opinion.
-- Postgres sorts NaN above every number, so it would read as plenty of stock. The save is
-- refused, and any already stored are cleared here first so the update at the end can't trip on them.
-- Definer because is_finite_number isn't granted to the signed-in users who save stock.
update public.warehouse_inventory set quantity = null where not public.is_finite_number(quantity);
update public.warehouse_inventory set reorder_point = null where not public.is_finite_number(reorder_point);

create or replace function public.warehouse_stock_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (public.is_finite_number(new.quantity) and public.is_finite_number(new.reorder_point)) then
    raise exception 'Quantity and reorder point must be numbers.' using errcode = '22023';
  end if;
  if new.quantity is null then return new; end if;
  new.status := case
    when new.quantity <= 0 then 'Out of Stock'
    when new.reorder_point is not null and new.quantity <= new.reorder_point then 'Low'
    else 'In Stock'
  end;
  return new;
end $$;
drop trigger if exists warehouse_inventory_stock on public.warehouse_inventory;
create trigger warehouse_inventory_stock before insert or update on public.warehouse_inventory
  for each row execute function public.warehouse_stock_status();

-- Dates ----------------------------------------------------------------------------
-- 'infinity' is a legal date, and subtracting it is an error. In a daily run that error would
-- roll back the whole company's work, so saves refuse one and the run steps around any already stored.
-- Only when the date changes: a stored one mustn't stop the job flipping that row's status.
create or replace function public.refuse_infinite_dates() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_column text;
begin
  foreach v_column in array tg_argv loop
    if v_new ->> v_column in ('infinity', '-infinity') and (v_old is null or v_old ->> v_column is distinct from v_new ->> v_column) then
      raise exception 'Enter a real calendar date.' using errcode = '22023';
    end if;
  end loop;
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in
    select c.table_name, array_agg(quote_literal(c.column_name) order by c.column_name) as columns
    from information_schema.columns c
    where c.table_schema = 'public' and c.data_type in ('date', 'timestamp with time zone')
      and c.table_name in (select a.table_name from public.automation_rules a)
    group by c.table_name
  loop
    execute format('drop trigger if exists %I on public.%I', r.table_name || '_finite_dates', r.table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.refuse_infinite_dates(%s)',
                   r.table_name || '_finite_dates', r.table_name, array_to_string(r.columns, ', '));
  end loop;
end $$;

-- Matches provinceTimeZone in lib/provinces.ts. tests/automation.test.ts keeps them equal.
create or replace function public.company_time_zone(p_province text) returns text
language sql immutable set search_path = '' as $$
  select case p_province
    when 'AB' then 'America/Edmonton'
    when 'BC' then 'America/Vancouver'
    when 'SK' then 'America/Regina'
    when 'MB' then 'America/Winnipeg'
    when 'ON' then 'America/Toronto'
    when 'QC' then 'America/Toronto'
    when 'NB' then 'America/Moncton'
    when 'NS' then 'America/Halifax'
    when 'PE' then 'America/Halifax'
    when 'NL' then 'America/St_Johns'
    when 'YT' then 'America/Whitehorse'
    when 'NT' then 'America/Yellowknife'
    when 'NU' then 'America/Iqaluit'
    else 'America/Toronto'
  end
$$;

-- The date a moment fell on where the company is. Supabase's date is UTC, already tomorrow by
-- a Regina evening. Null for infinity, and for the extremes a time zone shift can't represent.
create or replace function public.alert_local_date(p_at timestamptz, p_zone text) returns date
language sql immutable set search_path = '' as $$
  select case when p_at >= timestamptz '0001-01-02 00:00:00+00' and p_at < timestamptz '9999-01-01 00:00:00+00'
              then (p_at at time zone p_zone)::date end
$$;

-- Buckets and wording --------------------------------------------------------------
-- The offset a record has reached: the nearest one at or above how many days are left.
-- 10 days left of [7, 0, -1] is nothing yet. 4 is d+7. -9 is d-1, or w1 on a weekly rule.
create or replace function public.alert_bucket(p_days integer, p_offsets integer[], p_weekly boolean) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_reached integer;
  v_last integer;
  v_weeks integer;
begin
  if p_days is null then return null; end if;
  select min(o) into v_reached from unnest(p_offsets) as o where o >= p_days;
  if v_reached is null then return null; end if;
  select min(o) into v_last from unnest(p_offsets) as o;
  if p_weekly and p_days < v_last then
    v_weeks := (v_last - p_days) / 7;
    if v_weeks >= 1 then return 'w' || v_weeks::text; end if;
  end if;
  return 'd' || case when v_reached > 0 then '+' else '' end || v_reached::text;
end $$;

create or replace function public.alert_message(p_soon text, p_past text, p_days integer) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_n text;
begin
  if p_days is null then return p_soon; end if;
  v_n := abs(p_days)::text || case when abs(p_days) = 1 then ' day' else ' days' end;
  if p_days < 0 then return replace(coalesce(p_past, p_soon), '{n}', v_n); end if;
  if p_days = 0 then return replace(replace(p_soon, ' in {n}', ' today'), '{n}', v_n); end if;
  return replace(p_soon, '{n}', v_n);
end $$;

-- One rule against one company, or one record. Raises, moves and clears alerts. With
-- p_resolve_only it only clears: a save can show a record no longer qualifies, but raising
-- a date alert waits for the daily run, which knows the company's own date.
-- Rules come from automation_rules, which no user can write, so the SQL in them is trusted.
-- $1 company, $2 today, $3 one record or null, $4 statuses, $5 offsets, $6 weekly, $7 the company's time zone.
-- A record with an infinite date has no days to count, so it gets no bucket and no alert.
create or replace function public.apply_alert_rule(
  p_key text, p_company uuid, p_today date, p_record uuid default null, p_resolve_only boolean default false,
  out raised integer, out changed integer, out resolved integer
) language plpgsql security definer set search_path = '' as $$
declare
  v_rule public.automation_rules;
  v_days text;
  v_bucket text;
  v_due text;
  v_sql text;
  v_row record;
  v_alert public.alerts;
  v_message text;
  v_severity text;
  v_seen uuid[] := '{}';
  v_old record;
  v_zone text;
  v_is_date boolean;
begin
  raised := 0; changed := 0; resolved := 0;
  select * into strict v_rule from public.automation_rules r where r.key = p_key;
  select public.company_time_zone(c.province) into v_zone from public.companies c where c.id = p_company;

  if v_rule.kind = 'date' then
    v_days := format('(case when isfinite(r.%I) then r.%I - $2 end)', v_rule.date_column, v_rule.date_column);
    v_bucket := format('public.alert_bucket(%s, $5, $6)', v_days);
    v_due := format('r.%I', v_rule.date_column);
  elsif v_rule.kind = 'age' then
    -- A date column is already a local date. A timestamp has to be turned into one.
    select a.atttypid = 'date'::regtype into v_is_date from pg_attribute a
    where a.attrelid = format('public.%I', v_rule.table_name)::regclass and a.attname = v_rule.date_column;
    v_days := format('($2 - coalesce(%s, public.alert_local_date(r.created_at, $7)))',
      case when v_is_date then format('case when isfinite(r.%I) then r.%I end', v_rule.date_column, v_rule.date_column)
           else format('public.alert_local_date(r.%I, $7)', v_rule.date_column) end);
    v_bucket := format('case when %s >= %s then ''age'' end', v_days, v_rule.age_days);
    v_due := 'null';
  else
    v_days := 'null';
    v_bucket := coalesce(v_rule.bucket_sql, '''open''');
    v_due := 'null';
  end if;

  v_sql := format(
    'select r.id, r.title, (%s)::integer as days, (%s)::text as bucket, (%s)::date as due, (%s)::text as detail, public.alert_local_date(r.created_at, $7) as logged from public.%I r where r.company_id = $1 and ($3::uuid is null or r.id = $3)',
    v_days, v_bucket, v_due, coalesce(v_rule.detail_sql, 'null'), v_rule.table_name);
  if v_rule.statuses is not null then v_sql := v_sql || ' and r.status = any($4)'; end if;
  if v_rule.where_sql is not null then v_sql := v_sql || ' and (' || v_rule.where_sql || ')'; end if;

  for v_row in execute v_sql using p_company, p_today, p_record, v_rule.statuses, v_rule.offsets, v_rule.weekly, v_zone loop
    continue when v_row.bucket is null;
    v_seen := v_seen || v_row.id;
    continue when p_resolve_only;

    v_message := btrim(public.alert_message(v_rule.msg_soon, v_rule.msg_past, v_row.days) || ' ' || coalesce(v_row.detail, ''));
    v_severity := case
      when v_rule.kind <> 'date' or v_row.days < 0 then v_rule.severity
      when v_row.days <= 7 then 'warning'
      else 'info'
    end;

    select * into v_alert from public.alerts a where a.company_id = p_company and a.rule_key = p_key and a.record_id = v_row.id;
    if not found then
      -- A save is news, whatever the record's age. The daily run finding an old record is not:
      -- that's the first run after an upgrade, and it shows in the app but owes nobody an email.
      insert into public.alerts (company_id, rule_key, module, record_id, title, message, severity, min_rank, bucket, due_on, immediate, no_email_reason)
      values (p_company, p_key, v_rule.module, v_row.id, v_row.title, v_message, v_severity, v_rule.min_rank, v_row.bucket, v_row.due, v_rule.immediate,
              case when v_rule.immediate and p_record is null and p_today - v_row.logged > 7 then 'old_record' end);
      insert into public.automation_events (company_id, run_date, kind, rule_key, table_name, record_id, to_value)
      values (p_company, p_today, 'alert_raised', p_key, v_rule.table_name, v_row.id, v_row.bucket);
      raised := raised + 1;
    elsif v_alert.resolved_at is not null or v_alert.bucket is distinct from v_row.bucket then
      -- Coming back from resolved starts fresh for everyone. A new bucket only ends dismissals, by not matching them.
      if v_alert.resolved_at is not null then
        delete from public.alert_member_state s where s.alert_id = v_alert.id;
      end if;
      update public.alerts a set
        title = v_row.title, message = v_message, severity = v_severity, min_rank = v_rule.min_rank, bucket = v_row.bucket, due_on = v_row.due,
        resolved_at = null, bucket_changed_at = now(), updated_at = now()
      where a.id = v_alert.id;
      insert into public.automation_events (company_id, run_date, kind, rule_key, table_name, record_id, from_value, to_value)
      values (p_company, p_today, case when v_alert.resolved_at is not null then 'alert_raised' else 'alert_changed' end,
              p_key, v_rule.table_name, v_row.id, v_alert.bucket, v_row.bucket);
      if v_alert.resolved_at is not null then raised := raised + 1; else changed := changed + 1; end if;
    elsif (v_alert.title, v_alert.message, v_alert.severity, v_alert.min_rank, v_alert.due_on)
          is distinct from (v_row.title, v_message, v_severity, v_rule.min_rank, v_row.due) then
      -- "In 3 days" becoming "in 2 days", or a renamed record. Nothing anyone needs telling about.
      update public.alerts a set
        title = v_row.title, message = v_message, severity = v_severity, min_rank = v_rule.min_rank, due_on = v_row.due, updated_at = now()
      where a.id = v_alert.id;
    end if;
  end loop;

  -- Whatever no longer qualifies clears itself, deleted records included
  for v_old in
    update public.alerts a set resolved_at = now(), updated_at = now()
    where a.company_id = p_company and a.rule_key = p_key and a.resolved_at is null
      and (p_record is null or a.record_id = p_record)
      and a.record_id <> all(v_seen)
    returning a.id, a.record_id, a.bucket
  loop
    delete from public.alert_member_state s where s.alert_id = v_old.id;
    insert into public.automation_events (company_id, run_date, kind, rule_key, table_name, record_id, from_value)
    values (p_company, p_today, 'alert_resolved', p_key, v_rule.table_name, v_old.record_id, v_old.bucket);
    resolved := resolved + 1;
  end loop;
end $$;

-- On save ---------------------------------------------------------------------------
-- Keeps alerts honest between daily runs: marking an invoice paid clears its alert now, and
-- a critical incident raises one now. It only ever writes alert tables, so the billing and
-- safety guards never see it. A failure here is logged and must not lose the record being saved.
create or replace function public.alerts_on_record_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := case when tg_op = 'DELETE' then old.id else new.id end;
  v_company uuid := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  v_rule record;
begin
  -- Cascading from a company being deleted: its alerts are going too
  if not exists (select 1 from public.companies c where c.id = v_company) then return null; end if;
  for v_rule in
    select r.key, r.on_write from public.automation_rules r
    where r.table_name = tg_table_name and (r.on_write or tg_op <> 'INSERT')
  loop
    perform public.apply_alert_rule(v_rule.key, v_company, current_date, v_id, not v_rule.on_write);
  end loop;
  return null;
exception when others then
  raise warning 'Alerts were not updated for % %: %', tg_table_name, v_id, sqlerrm;
  return null;
end $$;

do $$
declare
  r record;
begin
  for r in select table_name, bool_or(on_write) as on_write from public.automation_rules group by table_name loop
    execute format('drop trigger if exists %I on public.%I', r.table_name || '_alerts', r.table_name);
    execute format('create trigger %I after %s on public.%I for each row execute function public.alerts_on_record_change()',
                   r.table_name || '_alerts', case when r.on_write then 'insert or update or delete' else 'update or delete' end, r.table_name);
  end loop;
end $$;

-- Status flips ----------------------------------------------------------------------
-- Moves one table's rows to what p_next says, or leaves them where it says null. Logs each move.
create or replace function public.automation_flip(p_company uuid, p_today date, p_rule text, p_table text, p_next text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  execute format(
    'with x as (select r.id, r.status as prev, (%s)::text as next from public.%I r where r.company_id = $1),
          u as (update public.%I t set status = x.next from x where t.id = x.id and x.next is not null and x.next is distinct from x.prev
                returning t.id, x.prev, x.next)
     insert into public.automation_events (company_id, run_date, kind, rule_key, table_name, record_id, from_value, to_value)
     select $1, $2, ''status_flip'', %L, %L, u.id, u.prev, u.next from u',
    p_next, p_table, p_table, p_rule, p_table)
  using p_company, p_today;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

create or replace function public.automation_status_flips(p_company uuid, p_today date)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_total integer := 0;
begin
  -- Invoices first: a flip makes sync_invoice re-age the receivable, and the next step has the last word
  v_total := v_total + public.automation_flip(p_company, p_today, 'flip.invoices', 'invoices', $sql$
    case when not isfinite(r.due_date) then null
         when r.status = 'Sent' and r.due_date < $2 then 'Overdue'
         when r.status = 'Overdue' and (r.due_date is null or r.due_date >= $2) then 'Sent' end $sql$);

  -- Billing's own function, asked about the company's date. Shifting the due date by the gap
  -- between that and the server's date gives its answer for p_today, with one set of thresholds.
  -- Held inside ordinary years first, since shifting the very last date there is overflows.
  v_total := v_total + public.automation_flip(p_company, p_today, 'flip.receivables', 'receivables', $sql$
    case when r.status <> 'Collected' and isfinite(r.due_date)
         then public.receivable_age_status(least(greatest(r.due_date, date '0001-01-01'), date '9999-12-31') + (current_date - $2)) end $sql$);

  v_total := v_total + public.automation_flip(p_company, p_today, 'flip.warranty', 'warranty', $sql$
    case when r.status = 'Claimed' or r.expiry_date is null then null
         when r.expiry_date < $2 then 'Expired'
         when r.expiry_date <= $2 + 30 then 'Expiring'
         else 'Active' end $sql$);

  -- Rules in the order they were decided: a lapsed date always counts, a date coming up counts
  -- even if the other date is blank, and Compliant takes both dates. Blank with nothing coming
  -- up leaves the status alone and the sub_compliance.missing alert says why.
  v_total := v_total + public.automation_flip(p_company, p_today, 'flip.sub_compliance', 'sub_compliance', $sql$
    case when r.liability_expiry < $2 or r.wcb_clearance_expiry < $2 then 'Non-Compliant'
         when r.liability_expiry <= $2 + 30 or r.wcb_clearance_expiry <= $2 + 14 then 'Expiring'
         when r.liability_expiry is not null and r.wcb_clearance_expiry is not null then 'Compliant' end $sql$);

  v_total := v_total + public.automation_flip(p_company, p_today, 'flip.site_vault', 'site_vault', $sql$
    case when r.expiry_date < $2 then 'Expired'
         when r.status = 'Expired' and r.expiry_date >= $2 then 'Secure' end $sql$);

  v_total := v_total + public.automation_flip(p_company, p_today, 'flip.fleet', 'fleet', $sql$
    case when r.status = 'Operational' and (r.next_service_date <= $2 + 14 or r.next_service_km - r.mileage <= 500) then 'Service Due'
         when r.status = 'Service Due' and (r.next_service_date is not null or (r.next_service_km is not null and r.mileage is not null))
              and not coalesce(r.next_service_date <= $2 + 14, false) and not coalesce(r.next_service_km - r.mileage <= 500, false) then 'Operational' end $sql$);

  return v_total;
end $$;

-- The run ---------------------------------------------------------------------------
-- Same test as company_can_write, for a job that has no signed-in user
create or replace function public.company_is_active(p_company uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.companies c
    where c.id = p_company
      and (c.subscription_status in ('active', 'past_due')
           or (c.subscription_status = 'trialing' and c.trial_ends_at > now()))
  )
$$;

create or replace function public.run_company_automation(p_company uuid, p_today date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_flips integer;
  v_events_before bigint;
  v_rule record;
  v_result record;
  v_raised integer := 0;
  v_changed integer := 0;
  v_resolved integer := 0;
begin
  if p_company is null or p_today is null then
    raise exception 'A company and a date are required' using errcode = '22023';
  end if;
  -- A lapsed company is read-only for its people, and nothing changes behind their backs either
  if not public.company_is_active(p_company) then
    return jsonb_build_object('skipped', true, 'flips', 0, 'raised', 0, 'changed', 0, 'resolved', 0);
  end if;
  -- Two overlapping runs take turns, and the second finds nothing left to do
  perform pg_advisory_xact_lock(hashtextextended('automation:' || p_company::text, 0));

  v_flips := public.automation_status_flips(p_company, p_today);

  for v_rule in select r.key from public.automation_rules r order by r.key loop
    select * into v_result from public.apply_alert_rule(v_rule.key, p_company, p_today);
    v_raised := v_raised + v_result.raised;
    v_changed := v_changed + v_result.changed;
    v_resolved := v_resolved + v_result.resolved;
  end loop;

  insert into public.automation_company_state as s (company_id, last_run_date, last_run_at)
  values (p_company, p_today, now())
  on conflict (company_id) do update set last_run_date = excluded.last_run_date, last_run_at = excluded.last_run_at;

  return jsonb_build_object('skipped', false, 'flips', v_flips, 'raised', v_raised, 'changed', v_changed, 'resolved', v_resolved);
end $$;

-- Weekly. lib/automation.ts lists these periods. The privacy page has no figures for them yet.
create or replace function public.automation_housekeeping(p_today date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_invitations integer;
  v_stripe integer;
  v_ai integer;
  v_alerts integer;
  v_events integer;
  v_runs integer;
  v_digests integer;
begin
  delete from public.invitations i where i.accepted_at is null and i.expires_at < p_today - 30;
  get diagnostics v_invitations = row_count;
  delete from public.stripe_events e where e.created_at < p_today - 90;
  get diagnostics v_stripe = row_count;
  delete from public.ai_usage u where u.day < (p_today - interval '13 months')::date;
  get diagnostics v_ai = row_count;
  delete from public.alerts a where a.resolved_at < p_today - 90;
  get diagnostics v_alerts = row_count;
  delete from public.automation_events e where e.created_at < p_today - interval '24 months';
  get diagnostics v_events = row_count;
  delete from public.automation_runs r where r.created_at < p_today - interval '13 months';
  get diagnostics v_runs = row_count;
  delete from public.digest_sends d where d.digest_date < p_today - 90;
  get diagnostics v_digests = row_count;
  return jsonb_build_object('invitations', v_invitations, 'stripe_events', v_stripe, 'ai_usage', v_ai, 'alerts', v_alerts,
                            'automation_events', v_events, 'automation_runs', v_runs, 'digest_sends', v_digests);
end $$;

-- A digest is claimed before it is sent, so two runs can't both send it, and released if sending fails
create or replace function public.claim_digest_send(p_company uuid, p_user uuid, p_date date)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  insert into public.digest_sends (company_id, user_id, digest_date) values (p_company, p_user, p_date)
  on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

create or replace function public.release_digest_send(p_company uuid, p_user uuid, p_date date)
returns void language sql security definer set search_path = '' as $$
  delete from public.digest_sends d where d.company_id = p_company and d.user_id = p_user and d.digest_date = p_date
$$;

-- For signed-in users. These run as the caller, so row security decides what they see ----
create or replace function public.list_my_alerts(p_today date, p_limit integer default 100)
returns setof public.alerts language sql stable security invoker set search_path = '' as $$
  select a.* from public.alerts a
  left join public.alert_member_state s on s.alert_id = a.id and s.user_id = auth.uid()
  where a.resolved_at is null
    and s.dismissed_bucket is distinct from a.bucket
    and (s.snoozed_until is null or s.snoozed_until <= p_today)
  order by case a.severity when 'critical' then 0 when 'warning' then 1 else 2 end, a.due_on nulls last, a.created_at desc, a.id
  limit least(greatest(coalesce(p_limit, 100), 1), 500)
$$;

create or replace function public.my_alert_summary(p_today date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', count(*),
    'critical', count(*) filter (where a.severity = 'critical'),
    'warning', count(*) filter (where a.severity = 'warning'),
    'info', count(*) filter (where a.severity = 'info'),
    'last_checked', (select st.last_run_at from public.automation_company_state st where st.company_id = public.user_company_id())
  )
  from public.alerts a
  left join public.alert_member_state s on s.alert_id = a.id and s.user_id = auth.uid()
  where a.resolved_at is null
    and s.dismissed_bucket is distinct from a.bucket
    and (s.snoozed_until is null or s.snoozed_until <= p_today)
$$;

create or replace function public.snooze_alert(p_alert uuid, p_until date)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from public.alerts a where a.id = p_alert) then
    raise exception 'Alert not found' using errcode = 'P0002';
  end if;
  insert into public.alert_member_state as s (alert_id, user_id, snoozed_until)
  values (p_alert, auth.uid(), p_until)
  on conflict (alert_id, user_id) do update set snoozed_until = excluded.snoozed_until, updated_at = now();
end $$;

create or replace function public.dismiss_alert(p_alert uuid)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_bucket text;
begin
  select a.bucket into v_bucket from public.alerts a where a.id = p_alert;
  if not found then raise exception 'Alert not found' using errcode = 'P0002'; end if;
  insert into public.alert_member_state as s (alert_id, user_id, dismissed_bucket)
  values (p_alert, auth.uid(), v_bucket)
  on conflict (alert_id, user_id) do update set dismissed_bucket = excluded.dismissed_bucket, updated_at = now();
end $$;

-- Who can run what ------------------------------------------------------------------
revoke execute on function public.refuse_infinite_dates(), public.company_time_zone(text), public.alert_local_date(timestamptz, text),
  public.warehouse_stock_status(), public.alert_bucket(integer, integer[], boolean), public.alert_message(text, text, integer),
  public.apply_alert_rule(text, uuid, date, uuid, boolean), public.alerts_on_record_change(), public.automation_flip(uuid, date, text, text, text),
  public.automation_status_flips(uuid, date), public.company_is_active(uuid), public.run_company_automation(uuid, date),
  public.automation_housekeeping(date), public.claim_digest_send(uuid, uuid, date), public.release_digest_send(uuid, uuid, date)
  from public, anon, authenticated;
grant execute on function public.alert_bucket(integer, integer[], boolean), public.company_is_active(uuid), public.run_company_automation(uuid, date),
  public.automation_housekeeping(date), public.claim_digest_send(uuid, uuid, date), public.release_digest_send(uuid, uuid, date)
  to service_role;
revoke execute on function public.list_my_alerts(date, integer), public.my_alert_summary(date), public.snooze_alert(uuid, date), public.dismiss_alert(uuid)
  from public, anon;
grant execute on function public.list_my_alerts(date, integer), public.my_alert_summary(date), public.snooze_alert(uuid, date), public.dismiss_alert(uuid)
  to authenticated;

-- Existing stock lines get a real status, through the trigger above
update public.warehouse_inventory set quantity = quantity where quantity is not null;
