-- Production security and integrity upgrade. Back up an existing installation first.
-- One salon per Supabase project. Provision users through Supabase Auth, then
-- explicitly allow their auth.users UUID in private.pos_members (see DEPLOYMENT.md).
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
revoke create on schema public from public, anon, authenticated;
create table if not exists private.pos_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true
);
create or replace function public.pos_is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists(select 1 from private.pos_members where user_id=auth.uid() and active)
$$;
revoke all on function public.pos_is_member() from public, anon;
grant execute on function public.pos_is_member() to authenticated;
create or replace function private.require_member() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
 if not public.pos_is_member() then raise exception 'This account is not authorized for this salon.' using errcode='42501'; end if;
end $$;

-- Convert legacy label IDs without losing relational or invoice JSON references.
-- Keep the mapping permanently for recovery/export reconciliation.
create table if not exists private.legacy_ids (entity text not null, old_id text not null, new_id uuid not null unique default gen_random_uuid(), primary key(entity,old_id));
insert into private.legacy_ids(entity,old_id)
select 'barbers',id from public.barbers where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
union all select 'services',id from public.services where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
union all select 'service_packages',id from public.service_packages where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
union all select 'service_categories',id from public.service_categories where id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
on conflict(entity,old_id) do nothing;
-- Make all affected FKs cascade ID corrections, retaining their delete behavior.
do $$ declare r record; definition text;
begin
 for r in select c.conname,c.conrelid::regclass rel,pg_get_constraintdef(c.oid) def from pg_constraint c
  where c.contype='f' and c.confrelid in ('public.barbers'::regclass,'public.services'::regclass,'public.service_packages'::regclass,'public.service_categories'::regclass)
 loop
  definition:=regexp_replace(r.def,' ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)','');
  definition:=regexp_replace(definition,' REFERENCES ([^ ]+)\(([^)]+)\)', ' REFERENCES \1(\2) ON UPDATE CASCADE');
  execute format('alter table %s drop constraint %I',r.rel,r.conname);
  execute format('alter table %s add constraint %I %s',r.rel,r.conname,definition);
 end loop;
end $$;
update public.barbers t set id=m.new_id::text from private.legacy_ids m where m.entity='barbers' and t.id=m.old_id;
update public.services t set id=m.new_id::text from private.legacy_ids m where m.entity='services' and t.id=m.old_id;
update public.service_packages t set id=m.new_id::text from private.legacy_ids m where m.entity='service_packages' and t.id=m.old_id;
update public.service_categories t set id=m.new_id::text from private.legacy_ids m where m.entity='service_categories' and t.id=m.old_id;
update public.invoices inv set items=(select coalesce(jsonb_agg(
 item || jsonb_build_object('serviceId',coalesce((select m.new_id::text from private.legacy_ids m where m.old_id=item->>'serviceId' and m.entity=case when item->>'serviceName' like 'Package:%' then 'service_packages' else 'services' end),(select min(m.new_id::text) from private.legacy_ids m where m.old_id=item->>'serviceId' and m.entity in('services','service_packages') having count(*)=1),item->>'serviceId'),
 'barberId',coalesce((select m.new_id::text from private.legacy_ids m where m.entity='barbers' and m.old_id=item->>'barberId'),item->>'barberId')) order by ord),'[]'::jsonb)
 from jsonb_array_elements(inv.items) with ordinality as x(item,ord))
where exists(select 1 from jsonb_array_elements(inv.items) x join private.legacy_ids m on m.old_id in(x->>'serviceId',x->>'barberId'));

-- Registry entries survive deletion. UUIDs cannot be reassigned, even between entities.
create table if not exists private.entity_ids (id uuid primary key, entity text not null, registered_at timestamptz not null default now());
create table if not exists private.pos_clock (id boolean primary key default true check(id), revision bigint not null default 0);
insert into private.pos_clock(id) values(true) on conflict do nothing;
create table if not exists private.pos_audit (id uuid primary key default gen_random_uuid(), actor uuid, entity text not null, entity_id text not null, operation text not null, before_record jsonb, after_record jsonb, occurred_at timestamptz not null default now());
create table if not exists private.pos_requests (id uuid primary key, actor uuid not null, request jsonb not null, response jsonb not null, created_at timestamptz not null default now());
create table if not exists private.invoice_security (id boolean primary key default true check(id), pin_hash text);
insert into private.invoice_security(id) values(true) on conflict do nothing;
create table if not exists private.pin_attempts (actor uuid primary key, failures integer not null default 0, locked_until timestamptz);
create table if not exists private.invoice_approvals (token uuid primary key default gen_random_uuid(), actor uuid not null, invoice_id uuid not null, action text not null check(action in('update','delete')), expires_at timestamptz not null default now()+interval '15 minutes');

create or replace function private.track_entity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 if TG_OP='INSERT' then
  insert into private.entity_ids(id,entity) values(new.id::uuid,TG_TABLE_NAME);
 elsif TG_OP='UPDATE' then
  if new.id is distinct from old.id then raise exception 'Entity IDs are immutable.' using errcode='23514'; end if;
  if TG_TABLE_NAME in ('barbers','services','customers','service_packages','invoices') then new.version:=old.version+1; end if;
 end if;
 update private.pos_clock set revision=revision+1 where id;
 insert into private.pos_audit(actor,entity,entity_id,operation,before_record,after_record)
 values(auth.uid(),TG_TABLE_NAME,coalesce(new.id::text,old.id::text),TG_OP,case when TG_OP<>'INSERT' then to_jsonb(old) end,case when TG_OP<>'DELETE' then to_jsonb(new) end);
 if TG_OP='DELETE' then return old; end if; return new;
end $$;

do $$ declare t text; collision_count bigint;
begin
 foreach t in array array['barbers','services','customers','service_packages','invoices'] loop
  execute format('alter table public.%I add column if not exists version bigint not null default 1',t);
  execute format('alter table public.%I add column if not exists deleted_at timestamptz',t);
 end loop;
 foreach t in array array['barbers','services','service_packages','service_categories'] loop
  execute format('alter table public.%I alter column id set default gen_random_uuid()::text',t);
  if not exists(select 1 from pg_constraint where conname=t||'_uuid_id') then
   execute format('alter table public.%I add constraint %I check(id::uuid::text=lower(id))',t,t||'_uuid_id');
  end if;
 end loop;
 foreach t in array array['barbers','services','customers','service_packages','invoices','invoice_items','service_package_items','service_categories'] loop
  -- Refuse pre-existing cross-entity ID collisions instead of silently renumbering history.
  execute format('insert into private.entity_ids(id,entity) select id::uuid,%L from public.%I on conflict(id) do update set entity=excluded.entity where private.entity_ids.entity=excluded.entity',t,t);
  execute format('select count(*) from public.%I s join private.entity_ids r on r.id=s.id::uuid where r.entity<>%L',t,t) into collision_count;
  if collision_count>0 then raise exception 'Cross-entity UUID collision; review legacy IDs before upgrading.' using errcode='23505'; end if;
  execute format('drop trigger if exists pos_track_entity on public.%I',t);
  execute format('create trigger pos_track_entity before insert or update or delete on public.%I for each row execute function private.track_entity()',t);
 end loop;
end $$;

-- Remove inherited anonymous policies and direct writes; only allowlisted Auth users can read.
do $$ declare t text; p record;
begin
 foreach t in array array['app_users','barbers','services','customers','invoices','invoice_items','service_packages','service_package_items','service_categories','service_category_memberships','app_settings'] loop
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t); end loop;
  execute format('revoke all on public.%I from public, anon, authenticated',t);
  if t<>'app_users' then
   execute format('grant select on public.%I to authenticated',t);
   execute format('create policy pos_member_read on public.%I for select to authenticated using(public.pos_is_member())',t);
  end if;
 end loop;
end $$;

-- Retire browser-comparison credentials; hosted users must use Supabase Auth.
update public.app_users set active=false,password='[disabled: Supabase Auth required]',pin='[disabled]';

-- Wrap existing category/branding RPCs with the SAME authorization as billing.
-- Private implementations preserve their existing validation/version semantics.
do $$ begin
 if to_regprocedure('private.mutate_service_category_catalog(text,text,text,text,boolean,bigint)') is null then
  alter function public.mutate_service_category_catalog(text,text,text,text,boolean,bigint) set schema private;
  alter function public.import_service_category_catalog(jsonb,jsonb) set schema private;
  alter function public.save_app_settings(jsonb,bigint) set schema private;
 end if;
end $$;
create or replace function public.mutate_service_category_catalog(p_action text,p_category_id text,p_name text default null,p_service_id text default null,p_included boolean default null,p_expected_version bigint default null)
returns jsonb language plpgsql security definer set search_path='' as $$ begin perform private.require_member(); return private.mutate_service_category_catalog(p_action,p_category_id,p_name,p_service_id,p_included,p_expected_version); end $$;
create or replace function public.import_service_category_catalog(p_categories jsonb,p_memberships jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$ begin perform private.require_member(); return private.import_service_category_catalog(p_categories,p_memberships); end $$;
create or replace function public.save_app_settings(p_settings jsonb,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$ begin perform private.require_member(); return private.save_app_settings(p_settings,p_expected_version); end $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.get_app_settings(bigint),public.get_service_category_catalog(),public.mutate_service_category_catalog(text,text,text,text,boolean,bigint),public.import_service_category_catalog(jsonb,jsonb),public.save_app_settings(jsonb,bigint) from public,anon;
grant execute on function public.get_app_settings(bigint),public.get_service_category_catalog(),public.mutate_service_category_catalog(text,text,text,text,boolean,bigint),public.import_service_category_catalog(jsonb,jsonb),public.save_app_settings(jsonb,bigint) to authenticated;

-- One MVCC snapshot, including ALL records (no PostgREST row cap), never seeds on read.
create or replace function public.pos_snapshot() returns jsonb
language plpgsql stable security definer set search_path='' as $$ declare result jsonb;
begin
 perform private.require_member();
 select jsonb_build_object('revision',c.revision,
  'barbers',(select coalesce(jsonb_agg(to_jsonb(t) order by t."createdAt",t.id),'[]'::jsonb) from public.barbers t where deleted_at is null),
  'services',(select coalesce(jsonb_agg(to_jsonb(t) order by t."createdAt",t.id),'[]'::jsonb) from public.services t where deleted_at is null),
  'customers',(select coalesce(jsonb_agg(to_jsonb(t) order by t."createdAt",t.id),'[]'::jsonb) from public.customers t where deleted_at is null),
  'packages',(select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object('services',(select coalesce(jsonb_agg(i."serviceName" order by i.position,i.id),'[]'::jsonb) from public.service_package_items i where i."packageId"=t.id)) order by t."createdAt",t.id),'[]'::jsonb) from public.service_packages t where deleted_at is null),
  'invoices',(select coalesce(jsonb_agg(to_jsonb(t) order by t."createdAt" desc,t.id),'[]'::jsonb) from public.invoices t where deleted_at is null)) into result from private.pos_clock c where c.id;
 return result;
end $$;

-- PIN is salted bcrypt, checked on the server and never returned to the browser.
create or replace function private.check_pin(p_pin text) returns boolean
language plpgsql security definer set search_path=pg_catalog,extensions,public as $$ declare h text; attempt private.pin_attempts; begin
 insert into private.pin_attempts(actor) values(auth.uid()) on conflict do nothing;
 select * into attempt from private.pin_attempts where actor=auth.uid() for update;
 if attempt.locked_until>now() then return false; end if;
 select pin_hash into h from private.invoice_security where id;
 if h is null or crypt(coalesce(p_pin,''),h)<>h then
  update private.pin_attempts set failures=case when failures>=4 then 0 else failures+1 end,locked_until=case when failures>=4 then now()+interval '15 minutes' else null end where actor=auth.uid(); return false;
 end if;
 update private.pin_attempts set failures=0,locked_until=null where actor=auth.uid(); return true;
end $$;
create or replace function public.pos_set_pin(p_current text,p_next text) returns boolean
language plpgsql security definer set search_path=pg_catalog,extensions,public as $$ declare h text; begin
 perform private.require_member();
 if coalesce(p_next,'') !~ '^[0-9]{4,12}$' then raise exception 'Use a PIN of 4 to 12 digits.' using errcode='22023'; end if;
 select pin_hash into h from private.invoice_security where id for update;
 if h is not null and not private.check_pin(p_current) then return false; end if;
 update private.invoice_security set pin_hash=crypt(p_next,gen_salt('bf',10)) where id;
 delete from private.invoice_approvals;
 return true;
end $$;
create or replace function public.pos_authorize_invoice(p_id uuid,p_action text,p_pin text) returns uuid
language plpgsql security definer set search_path='' as $$ declare result uuid; begin
 perform private.require_member();
 if p_action not in('update','delete') then raise exception 'Invalid invoice action.'; end if;
 -- Hold the PIN row through approval issuance so a concurrent PIN change
 -- revokes every approval issued under the previous PIN.
 perform 1 from private.invoice_security where id for share;
 if not private.check_pin(p_pin) then return null; end if;
 delete from private.invoice_approvals where expires_at<now();
 insert into private.invoice_approvals(actor,invoice_id,action) values(auth.uid(),p_id,p_action) returning token into result;
 return result;
end $$;

-- Atomic, idempotent core mutations. No optimistic success or blind upserts.
create or replace function public.pos_mutate(p_request_id uuid,p_entity text,p_operation text,p_record jsonb,p_expected_version bigint default null,p_pin_token uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request jsonb; cached private.pos_requests; t text; old_row jsonb; row_data jsonb; result jsonb; entity_id uuid; line jsonb; pos integer:=0; calculated_subtotal numeric; disc numeric; calculated_total numeric; value numeric; kind text; phone_key text;
begin
 perform private.require_member();
 if p_entity not in('barbers','services','customers','packages','invoices') or p_operation not in('add','update','remove','status') then raise exception 'Invalid operation.' using errcode='22023'; end if;
 -- Serialize mutations and retries; snapshots remain nonblocking MVCC reads.
 perform 1 from private.pos_clock where id for update;
 request:=jsonb_build_object('entity',p_entity,'operation',p_operation,'record',p_record,'version',p_expected_version);
 select * into cached from private.pos_requests where id=p_request_id;
 if found then
  if cached.actor<>auth.uid() or cached.request<>request then raise exception 'Request ID reused with a different operation.' using errcode='23505'; end if;
  return cached.response;
 end if;
 entity_id:=(p_record->>'id')::uuid;
 if entity_id is null then raise exception 'Missing UUID.' using errcode='22023'; end if;
 t:=case p_entity when 'packages' then 'service_packages' else p_entity end;
 execute format('select to_jsonb(t) from public.%I t where id::text=$1',t) into old_row using entity_id::text;
 if p_operation='add' then
  if old_row is not null then
   -- Invoice UUID is a second idempotency fence even if the client loses its request journal.
   if p_entity='invoices' and old_row->>'deleted_at' is null and (old_row->'items')=(p_record->'items') and (old_row->>'total')::numeric=(p_record->>'total')::numeric and (old_row->>'subtotal')::numeric=(p_record->>'subtotal')::numeric and (old_row->>'discount')::numeric=(p_record->>'discount')::numeric and old_row->>'discountType'=coalesce(p_record->>'discountType','amount') and (old_row->>'discountValue')::numeric=coalesce((p_record->>'discountValue')::numeric,(p_record->>'discount')::numeric,0) and old_row->>'customerName'=p_record->>'customerName' and old_row->>'customerId' is not distinct from p_record->>'customerId' and old_row->>'status'=p_record->>'status' and old_row->>'paymentMode'=p_record->>'paymentMode' and (old_row->>'date')::timestamptz=(p_record->>'date')::timestamptz then
    return jsonb_build_object('record',old_row,'revision',(select revision from private.pos_clock where id));
   end if;
   raise exception 'This UUID is already registered. Refresh before retrying.' using errcode='23505';
  end if;
 else
  if old_row is null or old_row->>'deleted_at' is not null then raise exception 'This record was removed on another device.' using errcode='P0002'; end if;
  if p_expected_version is null or (old_row->>'version')::bigint<>p_expected_version then raise exception 'This record changed on another device. Refresh and review before retrying.' using errcode='40001'; end if;
 end if;
 if p_entity='invoices' and p_operation in('update','remove') then
  delete from private.invoice_approvals where token=p_pin_token and actor=auth.uid() and invoice_id=entity_id and action=case p_operation when 'remove' then 'delete' else 'update' end and expires_at>now();
  if not found then raise exception 'Enter the invoice PIN again to authorize this action.' using errcode='42501'; end if;
 end if;
 if p_operation='remove' then
  if p_entity in('invoices','packages') then execute format('update public.%I set deleted_at=now() where id::text=$1 returning to_jsonb(%I.*)',t,t) into row_data using entity_id::text;
  else execute format('update public.%I set active=false where id::text=$1 returning to_jsonb(%I.*)',t,t) into row_data using entity_id::text; end if;
 elsif p_operation='status' then
  if p_entity<>'invoices' then raise exception 'Invalid status operation.'; end if;
  update public.invoices set status=p_record->>'status' where id=entity_id returning to_jsonb(invoices.*) into row_data;
 else
  if p_entity<>'invoices' and (length(trim(coalesce(p_record->>'name','')))=0 or length(p_record->>'name')>200) then raise exception 'Enter a name of 1 to 200 characters.' using errcode='22023'; end if;
  if p_entity in('services','packages') and ((p_record->>'price')::numeric is null or (p_record->>'price')::numeric<0 or (p_record->>'price')::numeric>100000000) then raise exception 'Invalid price.' using errcode='22023'; end if;
  if p_entity='barbers' then
   if coalesce((p_record->>'commissionRate')::numeric,0) not between 0 and 100 then raise exception 'Invalid commission.' using errcode='22023'; end if;
   if p_operation='add' then insert into public.barbers(id,name,active,"commissionRate") values(entity_id::text,trim(p_record->>'name'),coalesce((p_record->>'active')::boolean,true),coalesce((p_record->>'commissionRate')::numeric,0)) returning to_jsonb(barbers.*) into row_data;
   else update public.barbers set name=trim(p_record->>'name'),active=coalesce((p_record->>'active')::boolean,true),"commissionRate"=coalesce((p_record->>'commissionRate')::numeric,0) where id=entity_id::text returning to_jsonb(barbers.*) into row_data; end if;
  elsif p_entity='services' then
   if coalesce((p_record->>'duration')::integer,0)<0 then raise exception 'Invalid duration.'; end if;
   if p_operation='add' then insert into public.services(id,name,price,duration,active) values(entity_id::text,trim(p_record->>'name'),(p_record->>'price')::numeric,(p_record->>'duration')::integer,coalesce((p_record->>'active')::boolean,true)) returning to_jsonb(services.*) into row_data;
   else update public.services set name=trim(p_record->>'name'),price=(p_record->>'price')::numeric,duration=(p_record->>'duration')::integer,active=coalesce((p_record->>'active')::boolean,true) where id=entity_id::text returning to_jsonb(services.*) into row_data; end if;
  elsif p_entity='customers' then
   phone_key:=right(regexp_replace(coalesce(p_record->>'phone',''),'[^0-9]','','g'),11);
   if length(regexp_replace(coalesce(p_record->>'phone',''),'[^0-9]','','g')) not between 7 and 15 or phone_key ~ '^0+$' then raise exception 'Enter a valid customer phone.' using errcode='22023'; end if;
   if length(coalesce(p_record->>'email',''))>254 or length(coalesce(p_record->>'notes',''))>1000 then raise exception 'Customer email or notes are too long.' using errcode='22023'; end if;
   if exists(select 1 from public.customers where id<>entity_id and right(regexp_replace(phone,'[^0-9]','','g'),11)=phone_key) then raise exception 'A customer with this phone already exists.' using errcode='23505'; end if;
   if p_operation='add' then insert into public.customers(id,name,phone,email,notes,active) values(entity_id,trim(p_record->>'name'),p_record->>'phone',p_record->>'email',p_record->>'notes',coalesce((p_record->>'active')::boolean,true)) returning to_jsonb(customers.*) into row_data;
   else update public.customers set name=trim(p_record->>'name'),phone=p_record->>'phone',email=p_record->>'email',notes=p_record->>'notes',active=coalesce((p_record->>'active')::boolean,true) where id=entity_id returning to_jsonb(customers.*) into row_data; end if;
  elsif p_entity='packages' then
   if jsonb_typeof(p_record->'services') is distinct from 'array' or jsonb_array_length(p_record->'services') not between 1 and 100 then raise exception 'A deal needs 1 to 100 service names.' using errcode='22023'; end if;
   if p_operation='add' then insert into public.service_packages(id,name,price,active) values(entity_id::text,trim(p_record->>'name'),(p_record->>'price')::numeric,coalesce((p_record->>'active')::boolean,true)) returning to_jsonb(service_packages.*) into row_data;
   else update public.service_packages set name=trim(p_record->>'name'),price=(p_record->>'price')::numeric,active=coalesce((p_record->>'active')::boolean,true) where id=entity_id::text returning to_jsonb(service_packages.*) into row_data; end if;
   delete from public.service_package_items where "packageId"=entity_id::text;
   for line in select * from jsonb_array_elements(p_record->'services') loop
    if jsonb_typeof(line)<>'string' or length(trim(line#>>'{}'))=0 then raise exception 'Invalid deal service name.' using errcode='22023'; end if;
    insert into public.service_package_items("packageId","serviceName",position) values(entity_id::text,line#>>'{}',pos); pos:=pos+1;
   end loop;
   row_data:=row_data||jsonb_build_object('services',p_record->'services');
  elsif p_entity='invoices' then
   if jsonb_typeof(p_record->'items') is distinct from 'array' or jsonb_array_length(p_record->'items') not between 1 and 500 then raise exception 'An invoice needs 1 to 500 items.' using errcode='22023'; end if;
   calculated_subtotal:=0;
   for line in select * from jsonb_array_elements(p_record->'items') loop
    if length(trim(coalesce(line->>'serviceName','')))=0 or (line->>'price')::numeric is null or (line->>'price')::numeric<0 or (line->>'price')::numeric>100000000 then raise exception 'Invalid invoice item.' using errcode='22023'; end if;
    if not exists(select 1 from public.barbers where id=line->>'barberId' and (p_operation='update' or active)) then raise exception 'A selected team member is unavailable. Review the bill.' using errcode='23503'; end if;
    if not exists(select 1 from public.services where id=line->>'serviceId' and (p_operation='update' or active)) and not exists(select 1 from public.service_packages where id=line->>'serviceId' and (p_operation='update' or (active and deleted_at is null))) then raise exception 'A selected service/deal is unavailable. Review the bill.' using errcode='23503'; end if;
    calculated_subtotal:=calculated_subtotal+round((line->>'price')::numeric,2);
   end loop;
   kind:=coalesce(p_record->>'discountType','amount'); value:=coalesce((p_record->>'discountValue')::numeric,(p_record->>'discount')::numeric,0);
   if kind not in('amount','percent') or value<0 or (kind='percent' and value>100) then raise exception 'Invalid discount.' using errcode='22023'; end if;
   disc:=round(least(calculated_subtotal,case kind when 'percent' then calculated_subtotal*value/100 else value end),2); calculated_total:=calculated_subtotal-disc;
   if p_record->>'subtotal' is null or p_record->>'total' is null or p_record->>'discount' is null then raise exception 'Missing invoice totals.' using errcode='22023'; end if;
   if abs(calculated_subtotal-(p_record->>'subtotal')::numeric)>0.011 or abs(disc-(p_record->>'discount')::numeric)>0.011 or abs(calculated_total-(p_record->>'total')::numeric)>0.011 then raise exception 'Invoice totals do not match the items. Review the bill.' using errcode='23514'; end if;
   if p_operation='add' then
    if nullif(p_record->>'customerId','') is not null and not exists(select 1 from public.customers where id=(p_record->>'customerId')::uuid and active) then raise exception 'This customer is no longer active.' using errcode='23503'; end if;
    insert into public.invoices(id,date,"customerId","customerName",items,subtotal,discount,"discountType","discountValue",total,status,"paymentMode") values(entity_id,(p_record->>'date')::timestamptz,nullif(p_record->>'customerId','')::uuid,p_record->>'customerName',p_record->'items',calculated_subtotal,disc,kind,value,calculated_total,p_record->>'status',coalesce(p_record->>'paymentMode','cash')) returning to_jsonb(invoices.*) into row_data;
   else
    update public.invoices set "customerName"=p_record->>'customerName',items=p_record->'items',subtotal=calculated_subtotal,discount=disc,"discountType"=kind,"discountValue"=value,total=calculated_total,status=p_record->>'status',"paymentMode"=coalesce(p_record->>'paymentMode','cash') where id=entity_id returning to_jsonb(invoices.*) into row_data;
    delete from public.invoice_items where "invoiceId"=entity_id;
   end if;
   for line in select * from jsonb_array_elements(p_record->'items') loop
    insert into public.invoice_items("invoiceId","serviceId","serviceName",price,"barberId","barberName",position) values(entity_id,(select id from public.services where id=line->>'serviceId'),line->>'serviceName',round((line->>'price')::numeric,2),line->>'barberId',line->>'barberName',pos); pos:=pos+1;
   end loop;
  end if;
 end if;
 result:=jsonb_build_object('record',row_data,'revision',(select revision from private.pos_clock where id));
 insert into private.pos_requests(id,actor,request,response) values(p_request_id,auth.uid(),request,result);
 return result;
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.pos_snapshot(),public.pos_mutate(uuid,text,text,jsonb,bigint,uuid),public.pos_set_pin(text,text),public.pos_authorize_invoice(uuid,text,text) from public,anon;
grant execute on function public.pos_snapshot(),public.pos_mutate(uuid,text,text,jsonb,bigint,uuid),public.pos_set_pin(text,text),public.pos_authorize_invoice(uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
