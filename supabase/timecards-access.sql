-- TradeQuote PRO: timecard access. Owners, admins, project managers and foremen enter, edit, approve and
-- delete the crew's hours; other members only their own, and only until approved. Safe to run more than once.

drop policy if exists v1_tc_insert on public.timecards;
drop policy if exists v1_tc_update_own on public.timecards;
drop policy if exists tc_insert on public.timecards;
drop policy if exists tc_update on public.timecards;
drop policy if exists tc_delete on public.timecards;

create policy tc_insert on public.timecards for insert to authenticated
  with check (company_id = public.current_company_id()
    and (public.has_company_role(array['owner','admin','project_manager','foreman']) or (user_id = auth.uid() and approved_by is null)));

create policy tc_update on public.timecards for update to authenticated
  using (company_id = public.current_company_id()
    and (public.has_company_role(array['owner','admin','project_manager','foreman']) or (user_id = auth.uid() and approved_by is null)))
  with check (company_id = public.current_company_id()
    and (public.has_company_role(array['owner','admin','project_manager','foreman']) or (user_id = auth.uid() and approved_by is null)));

create policy tc_delete on public.timecards for delete to authenticated
  using (company_id = public.current_company_id()
    and (public.has_company_role(array['owner','admin','project_manager','foreman']) or (user_id = auth.uid() and approved_by is null)));

grant select, insert, update, delete on public.timecards to authenticated;
