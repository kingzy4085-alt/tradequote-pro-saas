do $$ begin if to_regclass('public.automation_rules') is not null then -- An in-app alert when a client answers a shared proposal. The contractor is emailed at once
-- (lib/portal-notify.ts); this keeps the answer on the Attention panel for a week, for project
-- managers and up, linking to the proposal. The daily run raises it and clears it when the week
-- is over, like every other rule (20261104000210_automation.sql).
-- The bucket is the answered link, so a proposal shared again and answered again is raised anew.
-- Matches 'proposals.answered' in AUTOMATION_RULES, lib/alerts.ts. tests/automation.test.ts keeps them equal.
-- Safe to run more than once.
insert into public.automation_rules (key, module, table_name, grp, kind, min_rank, date_column, statuses, offsets, weekly, age_days, where_sql, bucket_sql, detail_sql, msg_soon, msg_past, severity, immediate, on_write) values
  ('proposals.answered', 'proposals', 'proposals', 'Sales', 'condition', 3, null, null, null, false, null,
   $q$exists (select 1 from public.proposal_shares s where s.proposal_id = r.id and s.company_id = r.company_id and s.decided_at is not null and $2 - public.alert_local_date(s.decided_at, $7) between 0 and 6)$q$,
   $q$(select s.id::text from public.proposal_shares s where s.proposal_id = r.id and s.company_id = r.company_id and s.decided_at is not null order by s.decided_at desc, s.id limit 1)$q$,
   $q$(select case s.decision when 'accepted' then 'Accepted' || coalesce(' and signed by ' || s.signer_name, '') || '.' else 'Declined.' || coalesce(' Reason: ' || left(s.decline_reason, 200), '') end from public.proposal_shares s where s.proposal_id = r.id and s.company_id = r.company_id and s.decided_at is not null order by s.decided_at desc, s.id limit 1)$q$,
   'The client answered through the shared link.', null, 'info', false, false)
on conflict (key) do update set module = excluded.module, table_name = excluded.table_name, grp = excluded.grp, kind = excluded.kind, min_rank = excluded.min_rank, date_column = excluded.date_column, statuses = excluded.statuses, offsets = excluded.offsets, weekly = excluded.weekly, age_days = excluded.age_days, where_sql = excluded.where_sql, bucket_sql = excluded.bucket_sql, detail_sql = excluded.detail_sql, msg_soon = excluded.msg_soon, msg_past = excluded.msg_past, severity = excluded.severity, immediate = excluded.immediate, on_write = excluded.on_write;
 end if; end $$;
