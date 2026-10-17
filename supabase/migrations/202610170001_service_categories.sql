-- Additive migration: existing services, invoices, policies, and billing functions are untouched.
-- Single salon per Supabase project, matching the inherited app's access model.
-- IMPORTANT: the inherited browser login is not Supabase Auth. These RPCs intentionally
-- remain available to anon for compatibility. Harden authentication/RLS before public launch.
begin;

create table if not exists public.service_categories (
  id text primary key check (length(id) between 1 and 100),
  name text not null check (name = btrim(name) and length(name) between 1 and 50 and lower(name) not in ('all services', 'uncategorized')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists service_categories_unique_name on public.service_categories (lower(btrim(name)));
create table if not exists public.service_category_memberships (
  service_id text not null references public.services(id) on delete cascade,
  category_id text not null references public.service_categories(id) on delete cascade,
  primary key (service_id, category_id)
);
create index if not exists service_category_memberships_category on public.service_category_memberships(category_id);

alter table public.service_categories enable row level security;
alter table public.service_category_memberships enable row level security;
revoke all on public.service_categories, public.service_category_memberships from public, anon, authenticated;
grant select on public.service_categories, public.service_category_memberships to anon, authenticated;
grant all on public.service_categories, public.service_category_memberships to service_role;
drop policy if exists category_catalog_read on public.service_categories;
create policy category_catalog_read on public.service_categories for select to anon, authenticated using (true);
drop policy if exists category_memberships_read on public.service_category_memberships;
create policy category_memberships_read on public.service_category_memberships for select to anon, authenticated using (true);

-- A single statement returns a consistent snapshot without the REST 1,000-row page limit.
create or replace function public.get_service_category_catalog()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'version', c.version) order by lower(c.name), c.id) from public.service_categories c), '[]'::jsonb),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('service_id', m.service_id, 'category_id', m.category_id) order by m.service_id, m.category_id) from public.service_category_memberships m), '[]'::jsonb)
  );
$$;

-- All mutations are atomic and return the committed catalog. A version prevents
-- one browser from renaming/deleting a category changed by another browser.
create or replace function public.mutate_service_category_catalog(
  p_action text,
  p_category_id text,
  p_name text default null,
  p_service_id text default null,
  p_included boolean default null,
  p_expected_version bigint default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_version bigint;
begin
  if p_action = 'add' then
    insert into public.service_categories(id, name) values (p_category_id, btrim(p_name));
  elsif p_action in ('rename', 'remove', 'membership') then
    select version into current_version from public.service_categories where id = p_category_id for update;
    if not found then raise exception 'Category no longer exists' using errcode = 'P0002'; end if;
    if p_action in ('rename', 'remove') and (p_expected_version is null or p_expected_version <> current_version) then
      raise exception 'Category changed on another device' using errcode = '40001';
    end if;
    if p_action = 'rename' then
      update public.service_categories set name = btrim(p_name), version = version + 1 where id = p_category_id;
    elsif p_action = 'remove' then
      delete from public.service_categories where id = p_category_id;
    elsif p_included is null or p_service_id is null then
      raise exception 'Service and membership state are required' using errcode = '22023';
    elsif p_included then
      insert into public.service_category_memberships(service_id, category_id) values (p_service_id, p_category_id) on conflict do nothing;
    else
      delete from public.service_category_memberships where service_id = p_service_id and category_id = p_category_id;
    end if;
  else
    raise exception 'Unknown category action' using errcode = '22023';
  end if;
  return public.get_service_category_catalog();
end;
$$;

-- Explicit, transactional import of genuine browser-local categories. Existing
-- shared names are reused; memberships are merged, never replaced. Demo data is
-- never imported automatically. Unknown service IDs are skipped and reported.
create or replace function public.import_service_category_catalog(p_categories jsonb, p_memberships jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare category_row record; membership_row record; shared_id text; id_map jsonb := '{}'::jsonb; skipped integer := 0;
begin
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_typeof(p_memberships) is distinct from 'array' then
    raise exception 'Import requires arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(p_categories) > 1000 or jsonb_array_length(p_memberships) > 100000 then
    raise exception 'Import is too large' using errcode = '22023';
  end if;
  for category_row in select * from jsonb_to_recordset(p_categories) as x(id text, name text) loop
    if category_row.id is null or category_row.id = '' or id_map ? category_row.id then
      raise exception 'Import category IDs must be present and unique' using errcode = '22023';
    end if;
    insert into public.service_categories(id, name) values (gen_random_uuid()::text, btrim(category_row.name)) on conflict (lower(btrim(name))) do nothing;
    select id into shared_id from public.service_categories where lower(name) = lower(btrim(category_row.name));
    id_map := id_map || jsonb_build_object(category_row.id, shared_id);
  end loop;
  for membership_row in select * from jsonb_to_recordset(p_memberships) as x(service_id text, category_id text) loop
    shared_id := id_map ->> membership_row.category_id;
    if shared_id is null or membership_row.service_id is null or not exists (select 1 from public.services where id = membership_row.service_id) then
      skipped := skipped + 1;
    else
      insert into public.service_category_memberships(service_id, category_id) values (membership_row.service_id, shared_id) on conflict do nothing;
    end if;
  end loop;
  return public.get_service_category_catalog() || jsonb_build_object('skipped_memberships', skipped);
end;
$$;

revoke all on function public.get_service_category_catalog() from public;
revoke all on function public.mutate_service_category_catalog(text, text, text, text, boolean, bigint) from public;
revoke all on function public.import_service_category_catalog(jsonb, jsonb) from public;
grant execute on function public.get_service_category_catalog() to anon, authenticated;
grant execute on function public.mutate_service_category_catalog(text, text, text, text, boolean, bigint) to anon, authenticated;
grant execute on function public.import_service_category_catalog(jsonb, jsonb) to anon, authenticated;

-- Enable change notifications when the standard Supabase publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_categories') then
      alter publication supabase_realtime add table public.service_categories;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_category_memberships') then
      alter publication supabase_realtime add table public.service_category_memberships;
    end if;
  end if;
end $$;
commit;
