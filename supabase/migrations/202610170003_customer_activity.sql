-- Matches the existing customer activate/deactivate payload.
-- Additive only: preserve records, existing activity values, grants and policies.
begin;
alter table public.customers add column if not exists active boolean not null default true;
notify pgrst, 'reload schema';
commit;
