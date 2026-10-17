-- Additive shared salon branding; no changes to sales/service/invoice structures.
-- Uses the inherited anon-compatible access model, like the category migration.
-- The authentication/RLS production prerequisite in DEPLOYMENT.md still applies.
begin;
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  salon_name text not null default 'Vista Saloon' check (length(btrim(salon_name)) between 1 and 80),
  address text not null default '' check (length(address) <= 300),
  phone text not null default '' check (length(phone) <= 40),
  theme_color text not null default '#245b49' check (theme_color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_data_url text check (logo_data_url is null or (length(logo_data_url) <= 360000 and logo_data_url ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$')),
  version bigint not null default 1 check (version > 0)
);
insert into public.app_settings(id) values(true) on conflict do nothing;
alter table public.app_settings enable row level security;
revoke all on public.app_settings from public, anon, authenticated;
grant select on public.app_settings to anon, authenticated;
grant all on public.app_settings to service_role;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to anon, authenticated using(true);

create or replace function public.get_app_settings(p_known_version bigint default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select case when p_known_version = s.version then jsonb_build_object('unchanged', true, 'version', s.version)
    else jsonb_build_object('salonName', s.salon_name, 'address', s.address, 'phone', s.phone, 'themeColor', s.theme_color, 'logoDataUrl', s.logo_data_url, 'version', s.version) end
  from public.app_settings s where s.id = true;
$$;
create or replace function public.save_app_settings(p_settings jsonb, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_version bigint;
begin
  if jsonb_typeof(p_settings) is distinct from 'object' or not (p_settings ?& array['salonName','address','phone','themeColor','logoDataUrl']) then
    raise exception 'All app setting fields are required' using errcode = '22023';
  end if;
  select version into current_version from public.app_settings where id = true for update;
  if not found then raise exception 'App settings are missing' using errcode = 'P0002'; end if;
  if p_expected_version is null or current_version <> p_expected_version then
    raise exception 'App settings changed on another device' using errcode = '40001';
  end if;
  update public.app_settings set salon_name = btrim(p_settings->>'salonName'), address = p_settings->>'address', phone = p_settings->>'phone', theme_color = lower(p_settings->>'themeColor'), logo_data_url = p_settings->>'logoDataUrl', version = version + 1 where id = true;
  return public.get_app_settings();
end;
$$;
revoke all on function public.get_app_settings(bigint) from public;
revoke all on function public.save_app_settings(jsonb,bigint) from public;
grant execute on function public.get_app_settings(bigint), public.save_app_settings(jsonb,bigint) to anon, authenticated;
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_settings') then
    alter publication supabase_realtime add table public.app_settings;
  end if;
end $$;
commit;
