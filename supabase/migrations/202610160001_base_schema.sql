-- Fresh-project baseline. Original billing definitions are preserved below.
-- Existing installations must follow DEPLOYMENT.md instead of replaying the seed.
begin;
set local search_path = public, extensions;
do $$ begin
  if exists(select 1 from pg_catalog.pg_tables where schemaname='public' and tablename in ('app_users','barbers','services','customers','invoices','invoice_items','service_packages','service_package_items')) then
    raise exception 'Baseline is for an empty project only. Follow DEPLOYMENT.md for an existing installation.' using errcode='55000';
  end if;
end $$;

-- Run this in your Supabase SQL Editor (fresh setup; no existing tables assumed)
create extension if not exists "pgcrypto";

-- App users (simple table for app-level login)
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password text not null, -- store hashed in production; kept plain here to match the app defaults
  role text not null default 'admin',
  active boolean not null default true,
  pin text not null default '9999',
  "createdAt" timestamptz not null default now()
);

-- Seed a default admin if none exists (matches frontend defaults)
insert into app_users (email, password, role, active)
select 'admin@vistasaloon.local', 'VistaLocal123!', 'admin', true
where not exists (
  select 1 from app_users where email = 'admin@vistasaloon.local'
);

-- Barbers
create table if not exists barbers (
  id text primary key,
  name text not null,
  active boolean not null default true,
  "commissionRate" numeric not null default 0,
  "createdAt" timestamptz not null default now()
);

-- Services
create table if not exists services (
  id text primary key,
  name text not null,
  price numeric not null,
  duration integer,
  active boolean not null default true,
  "createdAt" timestamptz not null default now()
);

-- Customers
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  email text,
  notes text,
  "createdAt" timestamptz not null default now()
);

-- Invoices (camelCase column names to match the app payload)
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  date timestamptz not null default now(),
  "customerId" uuid references customers(id) on delete set null,
  "customerName" text not null,
  items jsonb not null default '[]'::jsonb, -- kept for quick reads/exports; authoritative rows live in invoice_items
  subtotal numeric not null default 0,
  discount numeric not null default 0,
  "discountType" text not null default 'amount' check ("discountType" in ('amount','percent')),
  "discountValue" numeric not null default 0,
  total numeric not null default 0,
  status text not null default 'paid' check (status in ('paid','pending','cancelled')),
  "paymentMode" text not null default 'cash' check ("paymentMode" in ('cash','online')),
  "createdAt" timestamptz not null default now()
);

-- Invoice line items (authoritative item records)
create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  "invoiceId" uuid not null references invoices(id) on delete cascade,
  "serviceId" text references services(id),
  "serviceName" text not null,
  price numeric not null,
  "barberId" text references barbers(id),
  "barberName" text not null,
  position integer,
  "createdAt" timestamptz not null default now()
);

-- Helpful indexes
create index if not exists idx_invoices_date on invoices (date);
create index if not exists idx_invoices_customer on invoices ("customerId", "customerName");
create index if not exists idx_invoices_status on invoices (status);
create index if not exists idx_invoices_payment_mode on invoices ("paymentMode");
create index if not exists idx_invoice_items_invoice on invoice_items ("invoiceId");
create index if not exists idx_invoice_items_barber on invoice_items ("barberId");
create index if not exists idx_invoice_items_service on invoice_items ("serviceId");
create index if not exists idx_app_users_email on app_users (email);

-- Optional: Enable RLS with open policies (adjust to your auth model). Comment out policies if you will add proper auth later.
alter table app_users enable row level security;
alter table barbers enable row level security;
alter table services enable row level security;
alter table customers enable row level security;
alter table invoices enable row level security;
alter table invoice_items enable row level security;

do $$
begin
  -- app_users
  if not exists (select 1 from pg_policies where tablename = 'app_users' and policyname = 'app_users_read_all') then
    create policy app_users_read_all on app_users for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'app_users' and policyname = 'app_users_write_all') then
    create policy app_users_write_all on app_users for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'app_users' and policyname = 'app_users_update_all') then
    create policy app_users_update_all on app_users for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'app_users' and policyname = 'app_users_delete_all') then
    create policy app_users_delete_all on app_users for delete using (true);
  end if;

  -- backfill pin column if missing
  begin
    alter table app_users add column if not exists pin text not null default '9999';
  exception when duplicate_column then null; end;

  -- barbers
  if not exists (select 1 from pg_policies where tablename = 'barbers' and policyname = 'barbers_read_all') then
    create policy barbers_read_all on barbers for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'barbers' and policyname = 'barbers_write_all') then
    create policy barbers_write_all on barbers for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'barbers' and policyname = 'barbers_update_all') then
    create policy barbers_update_all on barbers for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'barbers' and policyname = 'barbers_delete_all') then
    create policy barbers_delete_all on barbers for delete using (true);
  end if;

  -- services
  if not exists (select 1 from pg_policies where tablename = 'services' and policyname = 'services_read_all') then
    create policy services_read_all on services for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'services' and policyname = 'services_write_all') then
    create policy services_write_all on services for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'services' and policyname = 'services_update_all') then
    create policy services_update_all on services for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'services' and policyname = 'services_delete_all') then
    create policy services_delete_all on services for delete using (true);
  end if;

  -- customers
  if not exists (select 1 from pg_policies where tablename = 'customers' and policyname = 'customers_read_all') then
    create policy customers_read_all on customers for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'customers' and policyname = 'customers_write_all') then
    create policy customers_write_all on customers for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'customers' and policyname = 'customers_update_all') then
    create policy customers_update_all on customers for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'customers' and policyname = 'customers_delete_all') then
    create policy customers_delete_all on customers for delete using (true);
  end if;

  -- invoices
  if not exists (select 1 from pg_policies where tablename = 'invoices' and policyname = 'invoices_read_all') then
    create policy invoices_read_all on invoices for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'invoices' and policyname = 'invoices_write_all') then
    create policy invoices_write_all on invoices for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'invoices' and policyname = 'invoices_update_all') then
    create policy invoices_update_all on invoices for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'invoices' and policyname = 'invoices_delete_all') then
    create policy invoices_delete_all on invoices for delete using (true);
  end if;

  -- invoice_items
  if not exists (select 1 from pg_policies where tablename = 'invoice_items' and policyname = 'invoice_items_read_all') then
    create policy invoice_items_read_all on invoice_items for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'invoice_items' and policyname = 'invoice_items_write_all') then
    create policy invoice_items_write_all on invoice_items for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'invoice_items' and policyname = 'invoice_items_update_all') then
    create policy invoice_items_update_all on invoice_items for update using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'invoice_items' and policyname = 'invoice_items_delete_all') then
    create policy invoice_items_delete_all on invoice_items for delete using (true);
  end if;
end$$;


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

commit;
