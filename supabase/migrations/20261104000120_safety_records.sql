-- ============================================================================
-- TradeQuote PRO: the safety record engine for LOTO permits, tailgate meetings
-- and safety inspections. Hand-written and safe to run repeatedly. The columns
-- come from the registry; this file holds the rules.
--
--   signatures  An ordered list. It only grows by one valid entry at a time, in
--               slot order: LOTO lock_on > verified > lock_off; tailgate
--               attendee(s) > supervisor; inspection inspector.
--   status      Always worked out from the signatures. Never set by hand.
--   required    Each slot's fields must be filled in before it can be signed.
--   attested    Once a slot is signed, the fields it required stay as signed until
--               that sign-off is reopened. Other fields stay open until the lock.
--   lock        The last slot locks the record against every write, even one that
--               changes nothing, because that would still move updated_at.
--   reopen      Project manager or above, with a reason. Steps back one slot and
--               keeps a history of what was removed.
--   delete      A record that was ever signed stays on file.
--   ranks       A slot can name the lowest rank that may sign it (minRank).
--   options     Checklists and selects only take values from their lists. A value
--               already on an old row stays until someone changes it.
-- ============================================================================

-- The rules for each record type. lib/records.ts holds the same rules for the
-- screens, and tests/safety.test.ts checks that the two agree.
create or replace function public.safety_record_rules(p_module text) returns jsonb
language sql immutable set search_path = '' as $$
  select case p_module
    when 'loto-permits' then $json${
      "table": "loto_permits",
      "start": "Draft",
      "checklists": ["energy_sources", "ppe"],
      "options": {
        "energy_sources": ["Electrical", "Mechanical", "Hydraulic", "Pneumatic", "Thermal", "Chemical", "Gravity", "Stored / capacitive"],
        "ppe": ["Hard hat", "Safety glasses", "Gloves", "Arc-flash PPE", "Fall protection", "Hearing protection", "Hi-vis", "Safety boots", "Respirator"]
      },
      "selects": {},
      "slots": [
        {"key": "lock_on", "label": "Lock-on", "status": "Locked Out", "multiple": false, "required": [
          {"key": "equipment_isolated", "label": "Equipment isolated"},
          {"key": "authorized_person", "label": "Authorized person"},
          {"key": "lock_number", "label": "Lock #"},
          {"key": "record_date", "label": "Date"},
          {"key": "isolation_points", "label": "Isolation points"},
          {"key": "energy_sources", "label": "Energy sources"}
        ]},
        {"key": "verified", "label": "Zero energy verification", "status": "Verified Zero Energy", "multiple": false, "required": [
          {"key": "verification_method", "label": "How zero energy was verified"}
        ]},
        {"key": "lock_off", "label": "Lock-off", "status": "Released", "multiple": false, "required": [
          {"key": "release_notes", "label": "Release notes"}
        ]}
      ]
    }$json$::jsonb
    when 'tailgate-logs' then $json${
      "table": "tailgate_logs",
      "start": "Needs Sign-off",
      "checklists": ["ppe"],
      "options": {
        "ppe": ["Hard hat", "Safety glasses", "Gloves", "Arc-flash PPE", "Fall protection", "Hearing protection", "Hi-vis", "Safety boots", "Respirator"]
      },
      "selects": {},
      "slots": [
        {"key": "attendee", "label": "Attendee sign-in", "status": "Needs Sign-off", "multiple": true, "required": [
          {"key": "topic", "label": "Topic"},
          {"key": "meeting_date", "label": "Date"},
          {"key": "hazards", "label": "Hazards discussed"},
          {"key": "controls", "label": "Controls / procedures"}
        ]},
        {"key": "supervisor", "label": "Supervisor sign-off", "status": "Completed", "multiple": false, "minRank": 2, "required": []}
      ]
    }$json$::jsonb
    when 'safety-inspections' then $json${
      "table": "safety_inspections",
      "start": "Draft",
      "checklists": ["inspection_items", "ppe"],
      "options": {
        "inspection_items": ["Housekeeping", "Access and exits clear", "Fire extinguishers", "First aid kit", "Electrical panels accessible", "GFCI and cords", "Ladders and scaffold", "Fall protection", "Barricades and signage", "Tools and guards", "Emergency plan posted"],
        "ppe": ["Hard hat", "Safety glasses", "Gloves", "Arc-flash PPE", "Fall protection", "Hearing protection", "Hi-vis", "Safety boots", "Respirator"]
      },
      "selects": {
        "inspection_type": ["Site Walk", "Equipment", "Vehicle", "Scaffold / Ladder", "Fire Safety", "Other"],
        "result": ["Satisfactory", "Corrective Action Needed", "Unsafe: Work Stopped"]
      },
      "slots": [
        {"key": "inspector", "label": "Inspector sign-off", "status": "Signed Off", "multiple": false, "required": [
          {"key": "inspection_type", "label": "Type"},
          {"key": "record_date", "label": "Date"},
          {"key": "location", "label": "Area / location"},
          {"key": "result", "label": "Overall result"},
          {"key": "findings", "label": "Findings"},
          {"key": "corrective_actions", "label": "Corrective actions", "unless": {"key": "result", "value": "Satisfactory"}}
        ]}
      ]
    }$json$::jsonb
  end
$$;

-- Where a slot sits in the order, or null if it isn't one.
create or replace function public.safety_slot_index(p_rules jsonb, p_slot text) returns integer
language sql immutable set search_path = '' as $$
  select (t.ord - 1)::integer
  from jsonb_array_elements(p_rules -> 'slots') with ordinality as t(slot, ord)
  where t.slot ->> 'key' = p_slot
$$;

-- True once the last slot has been signed.
create or replace function public.safety_record_locked(p_module text, p_signatures jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_rules jsonb := public.safety_record_rules(p_module);
begin
  return public.safety_slot_index(v_rules, p_signatures -> -1 ->> 'slot') = jsonb_array_length(v_rules -> 'slots') - 1;
end $$;

-- Text as a person reads it. Characters that print as nothing (controls, zero-width and
-- direction marks, soft hyphens, blank fillers) are removed, then every kind of whitespace
-- is collapsed and the ends trimmed. So none of them count as content or make a name look
-- different. cleanText in lib/records.ts is the same rule; tests/safety.test.ts compares them.
create or replace function public.safety_clean_text(p_text text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(
    regexp_replace(coalesce(p_text, ''),
      '[\u0001-\u0008\u000E-\u001F\u007F-\u0084\u0086-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u2800\u3164\uFE00-\uFE0F\uFEFF\uFFA0\uFFF9-\uFFFB\U0001D173-\U0001D17A\U000E0000-\U000E0FFF]',
      '', 'g'),
    '[[:space:]\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+', ' ', 'g'), ' ')
$$;

create or replace function public.guard_safety_record() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_module text := tg_argv[0];
  v_rules jsonb := public.safety_record_rules(v_module);
  v_slots jsonb := v_rules -> 'slots';
  v_row jsonb;
  v_old_row jsonb := '{}';
  v_old_sigs jsonb := '[]';
  v_old_idx integer;
  v_clean jsonb;
  v_entry jsonb;
  v_idx integer;
  v_last integer;
  v_name text;
  v_reason text;
  v_removed jsonb;
  v_prefix text;
  v_file text;
  v_item jsonb;
  v_key text;
  v_slot jsonb;
  v_req jsonb;
  v_value jsonb;
  v_missing text[] := '{}';
  v_changed boolean := true;
  v_fixed text[] := array['signatures', 'reopen_log', 'status', 'attendees_count', 'updated_at'];
begin
  if tg_op = 'DELETE' then
    -- auth.uid() is null for the service role, which lets a whole company cascade
    if auth.uid() is not null and (jsonb_array_length(old.signatures) > 0 or jsonb_array_length(old.reopen_log) > 0) then
      raise exception 'This record has been signed, so it stays on file and cannot be deleted.' using errcode = 'P0001';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    -- A new record starts unsigned, whatever was sent
    new.signatures := '[]';
    new.reopen_log := '[]';
    -- Its age starts now too, because the overdue LOTO alert reads created_at. The service
    -- role (no user) can still bring in a record with its real date.
    if auth.uid() is not null then
      new.created_at := now();
    end if;
  else
    new.reopen_log := old.reopen_log;
    v_old_row := to_jsonb(old);
    v_old_sigs := old.signatures;
    v_old_idx := public.safety_slot_index(v_rules, old.signatures -> -1 ->> 'slot');
    if jsonb_typeof(new.signatures) is distinct from 'array' then
      raise exception 'Signatures cannot be changed that way.' using errcode = 'P0001';
    end if;
    v_changed := new.signatures is distinct from old.signatures;

    if not v_changed then
      -- Plain edit: a locked record takes no writes at all, since even one that changes
      -- nothing would move updated_at. The one exception is the database itself clearing
      -- created_by because that person was deleted from auth: the foreign key's update runs
      -- inside a trigger, which a direct update can't do.
      if public.safety_record_locked(v_module, old.signatures)
         and not (new.created_by is null and old.created_by is not null and pg_trigger_depth() > 1
                  and (to_jsonb(new) - (v_fixed || 'created_by'::text)) is not distinct from (to_jsonb(old) - (v_fixed || 'created_by'::text))) then
        raise exception 'This record is signed off and locked. A project manager can reopen it.' using errcode = 'P0001';
      end if;

    elsif jsonb_array_length(new.signatures) < jsonb_array_length(old.signatures) then
      -- Reopen: removes the latest slot's signatures and nothing else
      if public.user_rank() < 3 then
        raise exception 'Only a project manager or above can reopen a signed record.' using errcode = 'P0001';
      end if;
      select coalesce(jsonb_agg(t.sig order by t.ord) filter (where t.sig ->> 'slot' <> old.signatures -> -1 ->> 'slot'), '[]'),
             coalesce(jsonb_agg(jsonb_build_object('slot', t.sig ->> 'slot', 'name', t.sig ->> 'name', 'signed_at', t.sig ->> 'signed_at') order by t.ord)
                        filter (where t.sig ->> 'slot' = old.signatures -> -1 ->> 'slot'), '[]')
        into v_entry, v_removed
        from jsonb_array_elements(old.signatures) with ordinality as t(sig, ord);
      if new.signatures is distinct from v_entry or (to_jsonb(new) - v_fixed) is distinct from (to_jsonb(old) - v_fixed) then
        raise exception 'A reopen steps back one sign-off and changes nothing else.' using errcode = 'P0001';
      end if;
      v_reason := nullif(public.safety_clean_text(current_setting('tradequote.reopen_reason', true)), '');
      if v_reason is null then
        raise exception 'Enter a reason for reopening this record.' using errcode = 'P0001';
      end if;
      new.reopen_log := old.reopen_log || jsonb_build_array(jsonb_build_object(
        'at', now(),
        'by', auth.uid(),
        'by_name', (select coalesce(u.full_name, u.email) from public.company_users u where u.user_id = auth.uid()),
        'reason', left(v_reason, 1000),
        'removed', v_removed));

    elsif jsonb_array_length(new.signatures) = jsonb_array_length(old.signatures) + 1
          and (new.signatures - jsonb_array_length(old.signatures)) = old.signatures then
      -- Sign: one new entry on the end, checked against the slot order
      v_entry := new.signatures -> -1;
      v_last := coalesce(public.safety_slot_index(v_rules, old.signatures -> -1 ->> 'slot'), -1);
      v_idx := public.safety_slot_index(v_rules, v_entry ->> 'slot');
      if v_last = jsonb_array_length(v_slots) - 1 then
        raise exception 'This record is signed off and locked. A project manager can reopen it.' using errcode = 'P0001';
      end if;
      if v_idx is null then
        raise exception 'That is not a sign-off on this record.' using errcode = 'P0001';
      end if;
      if v_idx > v_last + 1 then
        raise exception '% has to be signed before %.', v_slots -> (v_last + 1) ->> 'label', v_slots -> v_idx ->> 'label' using errcode = 'P0001';
      end if;
      if v_idx < v_last or (v_idx = v_last and not (v_slots -> v_idx ->> 'multiple')::boolean) then
        raise exception '% has already been signed.', v_slots -> v_idx ->> 'label' using errcode = 'P0001';
      end if;
      if (v_slots -> v_idx -> 'minRank') is not null and auth.uid() is not null
         and coalesce(public.user_rank(), 0) < (v_slots -> v_idx ->> 'minRank')::integer then
        raise exception 'Only % or above can sign %.',
          case (v_slots -> v_idx ->> 'minRank')::integer when 2 then 'a foreman' when 3 then 'a project manager' else 'an admin' end,
          v_slots -> v_idx ->> 'label' using errcode = 'P0001';
      end if;
      v_name := public.safety_clean_text(v_entry ->> 'name');
      if jsonb_typeof(v_entry -> 'name') is distinct from 'string' or v_name = '' or char_length(v_name) > 200 then
        raise exception 'Enter the name of the person signing.' using errcode = 'P0001';
      end if;
      if char_length(v_entry ->> 'signature') > 300000 or coalesce(v_entry ->> 'signature', '') !~ '^data:image/png;base64,[A-Za-z0-9+/]+={0,2}$' then
        raise exception 'Draw a signature first.' using errcode = 'P0001';
      end if;
      -- The cap is on how many can sign a many-signer slot, so the slot after it can still be signed
      if (v_slots -> v_idx ->> 'multiple')::boolean
         and (select count(*) from jsonb_array_elements(old.signatures) as s(sig) where s.sig ->> 'slot' = v_entry ->> 'slot') >= 100 then
        raise exception 'A record can have up to 100 signatures.' using errcode = 'P0001';
      end if;
      if exists (select 1 from jsonb_array_elements(old.signatures) as s(sig)
                 where s.sig ->> 'slot' = v_entry ->> 'slot' and lower(public.safety_clean_text(s.sig ->> 'name')) = lower(v_name)) then
        raise exception '% has already signed in.', v_name using errcode = 'P0001';
      end if;
      -- Who and when come from the session, never from the request
      new.signatures := old.signatures || jsonb_build_array(jsonb_build_object(
        'slot', v_entry ->> 'slot',
        'name', v_name,
        'signature', v_entry ->> 'signature',
        'signed_at', now(),
        'user_id', auth.uid()));

    else
      raise exception 'Signatures cannot be changed that way.' using errcode = 'P0001';
    end if;
  end if;

  -- A record's identity and age don't change, signed or not. The overdue LOTO alert reads created_at.
  if tg_op = 'UPDATE' and (new.id is distinct from old.id or new.created_at is distinct from old.created_at) then
    raise exception 'A record''s id and created date cannot be changed.' using errcode = 'P0001';
  end if;

  -- Status follows the signatures. A record with none that isn't changing them keeps the
  -- status it has: new ones start at the first status, and a permit marked Locked Out by
  -- hand before this engine keeps saying so through an edit, because the equipment may be.
  v_idx := public.safety_slot_index(v_rules, new.signatures -> -1 ->> 'slot');
  if tg_op = 'UPDATE' and not v_changed and jsonb_array_length(new.signatures) = 0 then
    new.status := old.status;
  else
    new.status := coalesce(v_slots -> v_idx ->> 'status', v_rules ->> 'start');
  end if;

  -- A tailgate's head count is who signed in. A record that has no signatures and
  -- whose signatures didn't change keeps any count typed before sign-in existed.
  if v_module = 'tailgate-logs' then
    if tg_op = 'UPDATE' and not v_changed and jsonb_array_length(new.signatures) = 0 then
      new.attendees_count := old.attendees_count;
    else
      new.attendees_count := (select count(*) from jsonb_array_elements(new.signatures) as s(sig) where s.sig ->> 'slot' = 'attendee');
    end if;
  end if;

  -- Photos must be files directly in this record's own folder: the same shape
  -- safety_photo_open lets into storage, so the record can't carry a photo that can't exist
  v_prefix := new.company_id::text || '/' || v_module || '/' || new.id::text || '/';
  if jsonb_typeof(new.photos) is distinct from 'array' or jsonb_array_length(new.photos) > 50 then
    raise exception 'A record can have up to 50 photos.' using errcode = 'P0001';
  end if;
  for v_item in select * from jsonb_array_elements(new.photos) loop
    v_file := substr(v_item #>> '{}', length(v_prefix) + 1);
    if jsonb_typeof(v_item) <> 'string' or left(v_item #>> '{}', length(v_prefix)) <> v_prefix
       or v_file = '' or position('/' in v_file) > 0
       or position('..' in v_item #>> '{}') > 0 or char_length(v_item #>> '{}') > 300 then
      raise exception 'Invalid photo.' using errcode = 'P0001';
    end if;
  end loop;

  -- Crew can take off a photo they added, same as the storage rule. Otherwise the file
  -- stays but the record, its screen and its printout lose it. A foreman or above can
  -- take off any photo, and the service role (no user) isn't limited.
  if tg_op = 'UPDATE' and auth.uid() is not null and coalesce(public.user_rank(), 0) < 2
     and exists (select 1 from jsonb_array_elements_text(old.photos) as p(name)
                 join storage.objects o on o.bucket_id = 'job-photos' and o.name = p.name
                 where not (new.photos ? p.name) and o.owner_id is distinct from auth.uid()::text) then
    raise exception 'Only a foreman or above, or whoever added it, can remove this photo.' using errcode = 'P0001';
  end if;

  -- Checklists only take items from their list. Blank entries are dropped, so they can't
  -- satisfy a required checklist. An item already on an old row can stay.
  v_row := to_jsonb(new);
  for v_key in select * from jsonb_array_elements_text(v_rules -> 'checklists') loop
    if jsonb_typeof(v_row -> v_key) is distinct from 'array' or jsonb_array_length(v_row -> v_key) > 50 then
      raise exception 'Invalid checklist.' using errcode = 'P0001';
    end if;
    v_clean := '[]';
    for v_item in select * from jsonb_array_elements(v_row -> v_key) loop
      if jsonb_typeof(v_item) <> 'string' or char_length(v_item #>> '{}') > 100 then
        raise exception 'Invalid checklist.' using errcode = 'P0001';
      end if;
      v_name := public.safety_clean_text(v_item #>> '{}');
      continue when v_name = '';
      if not (v_rules -> 'options' -> v_key ? v_name) and not coalesce(v_old_row -> v_key ? v_name, false) then
        raise exception 'Invalid checklist.' using errcode = 'P0001';
      end if;
      v_clean := v_clean || to_jsonb(v_name);
    end loop;
    if v_clean is distinct from v_row -> v_key then
      new := jsonb_populate_record(new, jsonb_build_object(v_key, v_clean));
    end if;
  end loop;
  v_row := to_jsonb(new);

  -- Select fields only take values from their list, whichever way they were written
  for v_key, v_value in select * from jsonb_each(v_rules -> 'selects') loop
    if public.safety_clean_text(v_row ->> v_key) <> '' and v_row -> v_key is distinct from v_old_row -> v_key
       and not (v_value ? (v_row ->> v_key)) then
      raise exception 'That is not one of the choices for %.', replace(v_key, '_', ' ') using errcode = 'P0001';
    end if;
  end loop;

  -- What a signer attested to stays as signed until their sign-off is reopened
  if tg_op = 'UPDATE' and jsonb_array_length(new.signatures) >= jsonb_array_length(v_old_sigs) and v_old_idx is not null then
    for v_slot in select t.slot from jsonb_array_elements(v_slots) with ordinality as t(slot, ord) where t.ord - 1 <= v_old_idx order by t.ord loop
      for v_req in select * from jsonb_array_elements(v_slot -> 'required') loop
        if v_row -> (v_req ->> 'key') is distinct from v_old_row -> (v_req ->> 'key') then
          v_missing := v_missing || (v_req ->> 'label');
        end if;
      end loop;
    end loop;
    if array_length(v_missing, 1) > 0 then
      raise exception '% was signed for and cannot change. A project manager can reopen the sign-off.', array_to_string(v_missing, ', ') using errcode = 'P0001';
    end if;
  end if;

  -- Everything a signed slot depends on has to be there, now and after later edits.
  -- A reopen changes no fields, so an old record can always be stepped back.
  if tg_op = 'UPDATE' and jsonb_array_length(new.signatures) >= jsonb_array_length(v_old_sigs) then
    for v_slot in select t.slot from jsonb_array_elements(v_slots) with ordinality as t(slot, ord) where t.ord - 1 <= coalesce(v_idx, -1) order by t.ord loop
      for v_req in select * from jsonb_array_elements(v_slot -> 'required') loop
        if v_req ? 'unless' and v_row ->> (v_req #>> '{unless,key}') = v_req #>> '{unless,value}' then
          continue;
        end if;
        v_value := v_row -> (v_req ->> 'key');
        if v_value is null or jsonb_typeof(v_value) = 'null'
           or (jsonb_typeof(v_value) = 'string' and public.safety_clean_text(v_value #>> '{}') = '')
           or (jsonb_typeof(v_value) = 'array' and jsonb_array_length(v_value) = 0) then
          v_missing := v_missing || (v_req ->> 'label');
        end if;
      end loop;
    end loop;
    if array_length(v_missing, 1) > 0 then
      raise exception 'Fill these in for the sign-off: %.', array_to_string(v_missing, ', ') using errcode = 'P0001';
    end if;
  end if;

  return new;
end $$;

-- set_updated_at keeps created_by as it was, which leaves a deleted person's id behind
-- when the foreign key tries to clear it. This runs after that trigger and clears it for
-- real, only when the update comes from inside a trigger and that person is truly gone.
create or replace function public.safety_clear_deleted_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() > 1 and old.created_by is not null
     and not exists (select 1 from auth.users u where u.id = old.created_by) then
    new.created_by := null;
  end if;
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in select * from (values ('loto_permits', 'loto-permits'), ('tailgate_logs', 'tailgate-logs'), ('safety_inspections', 'safety-inspections')) as v(tbl, module) loop
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_guard', r.tbl);
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function public.guard_safety_record(%L)',
                   r.tbl || '_guard', r.tbl, r.module);
    -- The name sorts after <table>_updated, and triggers fire in name order
    execute format('drop trigger if exists %I on public.%I', r.tbl || '_updated_creator', r.tbl);
    execute format('create trigger %I before update on public.%I for each row execute function public.safety_clear_deleted_creator()',
                   r.tbl || '_updated_creator', r.tbl);
    -- TRUNCATE fires no row trigger, so it would go around the delete rule
    execute format('revoke truncate on table public.%I from authenticated, service_role', r.tbl);
  end loop;
end $$;

-- Signed daily logs have the same problem when their author's login is deleted
drop trigger if exists daily_logs_updated_creator on public.daily_logs;
create trigger daily_logs_updated_creator before update on public.daily_logs
  for each row execute function public.safety_clear_deleted_creator();

-- Adds one signature. The update is one statement, so two people signing at the same
-- moment both land. Runs as the caller: row security and the trigger above apply.
create or replace function public.sign_safety_record(p_module text, p_id uuid, p_slot text, p_name text, p_signature text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_table text := public.safety_record_rules(p_module) ->> 'table';
  v_row jsonb;
begin
  if v_table is null then raise exception 'Unknown record type' using errcode = '22023'; end if;
  execute format('update public.%I t set signatures = t.signatures || $1 where t.id = $2 returning to_jsonb(t)', v_table)
    into v_row
    using jsonb_build_array(jsonb_build_object('slot', p_slot, 'name', p_name, 'signature', p_signature)), p_id;
  if v_row is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  return v_row;
end $$;

-- Steps a record back one sign-off, with a reason the trigger keeps in the history.
-- p_expected_slot says which sign-off the caller meant: a retry or a second tab finds it
-- already gone and changes nothing. A caller that doesn't send it is protected by the
-- same person repeating the same reason within five minutes counting as the same reopen,
-- unless someone has signed since that reopen: then there is a new sign-off to step back.
drop function if exists public.reopen_safety_record(text, uuid, text);
create or replace function public.reopen_safety_record(p_module text, p_id uuid, p_reason text, p_expected_slot text default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_table text := public.safety_record_rules(p_module) ->> 'table';
  v_signatures jsonb;
  v_last_reopen jsonb;
  v_row jsonb;
begin
  if v_table is null then raise exception 'Unknown record type' using errcode = '22023'; end if;
  execute format('select t.signatures, t.reopen_log -> -1, to_jsonb(t) from public.%I t where t.id = $1 for update', v_table)
    into v_signatures, v_last_reopen, v_row using p_id;
  if v_signatures is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  if p_expected_slot is not null and v_signatures -> -1 ->> 'slot' is distinct from p_expected_slot then
    raise exception 'That sign-off has already changed. Refresh the page to see the latest.' using errcode = 'P0001';
  end if;
  if p_expected_slot is null and v_last_reopen ->> 'by' = auth.uid()::text
     and v_last_reopen ->> 'reason' = left(public.safety_clean_text(p_reason), 1000)
     and (v_last_reopen ->> 'at')::timestamptz > now() - interval '5 minutes'
     and coalesce((v_signatures -> -1 ->> 'signed_at')::timestamptz < (v_last_reopen ->> 'at')::timestamptz, true) then
    return v_row;
  end if;
  if jsonb_array_length(v_signatures) = 0 then
    raise exception 'This record has no sign-offs to reopen.' using errcode = 'P0001';
  end if;
  perform set_config('tradequote.reopen_reason', coalesce(p_reason, ''), true);
  execute format('update public.%I t set signatures = $1 where t.id = $2 returning to_jsonb(t)', v_table)
    into v_row
    using (select coalesce(jsonb_agg(s.sig order by s.ord), '[]'::jsonb)
           from jsonb_array_elements(v_signatures) with ordinality as s(sig, ord)
           where s.sig ->> 'slot' <> v_signatures -> -1 ->> 'slot'), p_id;
  if v_row is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  return v_row;
end $$;

-- Photos ----------------------------------------------------------------------
-- True when a path is <caller's company>/<record module>/<existing record>/<file>
-- and that record isn't locked.
create or replace function public.safety_photo_open(p_name text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_company uuid := public.user_company_id();
  v_table text;
  v_signatures jsonb;
begin
  if v_company is null or array_length(v_parts, 1) is distinct from 4 then return false; end if;
  v_table := public.safety_record_rules(v_parts[2]) ->> 'table';
  if v_table is null or v_parts[1] <> v_company::text then return false; end if;
  if v_parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if v_parts[4] = '' or position('..' in p_name) > 0 then return false; end if;
  execute format('select t.signatures from public.%I t where t.id = $1 and t.company_id = $2', v_table)
    into v_signatures using v_parts[3]::uuid, v_company;
  if v_signatures is null then return false; end if;
  return not coalesce(public.safety_record_locked(v_parts[2], v_signatures), false);
end $$;

-- Reading is covered by job_photos_select. These sit beside the daily-log policies,
-- which only match their own folder.
drop policy if exists safety_photos_insert on storage.objects;
create policy safety_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.company_can_write() and public.safety_photo_open(name));

drop policy if exists safety_photos_delete on storage.objects;
create policy safety_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos' and public.company_can_write() and public.safety_photo_open(name)
         and (public.user_rank() >= 2 or owner_id = auth.uid()::text));

revoke execute on function public.safety_record_rules(text), public.safety_slot_index(jsonb, text),
  public.safety_record_locked(text, jsonb), public.safety_clean_text(text), public.guard_safety_record(),
  public.safety_clear_deleted_creator(),
  public.sign_safety_record(text, uuid, text, text, text), public.reopen_safety_record(text, uuid, text, text),
  public.safety_photo_open(text) from public, anon;
revoke execute on function public.safety_clear_deleted_creator() from authenticated, service_role;
grant execute on function public.safety_record_rules(text), public.safety_slot_index(jsonb, text),
  public.safety_record_locked(text, jsonb), public.safety_clean_text(text),
  public.sign_safety_record(text, uuid, text, text, text), public.reopen_safety_record(text, uuid, text, text),
  public.safety_photo_open(text) to authenticated;
