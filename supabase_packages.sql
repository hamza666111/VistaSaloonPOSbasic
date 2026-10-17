-- Package tables for discounted combos
create extension if not exists "pgcrypto";

-- Service packages (bundle definitions)
create table if not exists service_packages (
  id text primary key,
  name text not null,
  price numeric not null,
  active boolean not null default true,
  "createdAt" timestamptz not null default now()
);

-- Items inside each package (stored as human-readable service names)
create table if not exists service_package_items (
  id uuid primary key default gen_random_uuid(),
  "packageId" text not null references service_packages(id) on delete cascade,
  "serviceName" text not null,
  position integer,
  "createdAt" timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_service_package_items_package on service_package_items ("packageId");
create index if not exists idx_service_package_items_position on service_package_items ("packageId", position);

-- Enable RLS
alter table service_packages enable row level security;
alter table service_package_items enable row level security;

-- Open policies (adjust to your auth model)
do $$
begin
  -- service_packages
  if not exists (select 1 from pg_policies where tablename = 'service_packages' and policyname = 'service_packages_read_all') then
    create policy service_packages_read_all on service_packages for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'service_packages' and policyname = 'service_packages_write_all') then
    create policy service_packages_write_all on service_packages for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'service_packages' and policyname = 'service_packages_update_all') then
    create policy service_packages_update_all on service_packages for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'service_packages' and policyname = 'service_packages_delete_all') then
    create policy service_packages_delete_all on service_packages for delete using (true);
  end if;

  -- service_package_items
  if not exists (select 1 from pg_policies where tablename = 'service_package_items' and policyname = 'service_package_items_read_all') then
    create policy service_package_items_read_all on service_package_items for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'service_package_items' and policyname = 'service_package_items_write_all') then
    create policy service_package_items_write_all on service_package_items for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'service_package_items' and policyname = 'service_package_items_update_all') then
    create policy service_package_items_update_all on service_package_items for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'service_package_items' and policyname = 'service_package_items_delete_all') then
    create policy service_package_items_delete_all on service_package_items for delete using (true);
  end if;
end$$;
