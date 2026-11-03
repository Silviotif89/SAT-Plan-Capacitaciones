-- SAT Capacitaciones. Apply in project ajfpbugjnlplrqlzlpyo.
-- A separate table preserves the original November records.
begin;

create table if not exists public.sat_plan_edit_permissions (
  period date not null check (extract(day from period) = 1),
  delegation text not null references sat_private.delegation_accounts (delegation),
  enabled boolean not null default false,
  primary key (period, delegation)
);

alter table public.sat_plan_edit_permissions enable row level security;
revoke all on public.sat_plan_edit_permissions from anon, authenticated;
grant select, insert, update on public.sat_plan_edit_permissions to authenticated;

drop policy if exists sat_plan_edit_permissions_admin on public.sat_plan_edit_permissions;
create policy sat_plan_edit_permissions_admin
  on public.sat_plan_edit_permissions
  for all to authenticated
  using ((select auth.jwt()->>'email') = 'ddt36@intur.local')
  with check ((select auth.jwt()->>'email') = 'ddt36@intur.local');

commit;

-- Resolve delegation from Auth, never from browser input.
begin;
alter table sat_private.delegation_accounts
  add column if not exists auth_user_id uuid unique references auth.users(id),
  add column if not exists enabled boolean not null default false;

create or replace function public.sat_current_delegation()
returns text language sql stable security definer set search_path = ''
as $$
  select delegation from sat_private.delegation_accounts
  where auth_user_id = auth.uid() and enabled and not must_change_password
$$;
revoke all on function public.sat_current_delegation() from public, anon;
grant execute on function public.sat_current_delegation() to authenticated;

create or replace function public.sat_plan_edit_enabled(plan_period date, plan_delegation text)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select enabled from public.sat_plan_edit_permissions
    where period = plan_period and delegation = plan_delegation
      and plan_delegation = public.sat_current_delegation()
  ), false)
$$;
revoke all on function public.sat_plan_edit_enabled(date,text) from public, anon;
grant execute on function public.sat_plan_edit_enabled(date,text) to authenticated;

drop policy if exists sat_monthly_delegate_read on public.sat_monthly_plans;
create policy sat_monthly_delegate_read on public.sat_monthly_plans
  for select to authenticated using (delegation = (select public.sat_current_delegation()));

drop policy if exists sat_monthly_delegate_insert on public.sat_monthly_plans;
create policy sat_monthly_delegate_insert on public.sat_monthly_plans
  for insert to authenticated with check (delegation = (select public.sat_current_delegation()) and status = 'BORRADOR');

drop policy if exists sat_monthly_delegate_update on public.sat_monthly_plans;
create policy sat_monthly_delegate_update on public.sat_monthly_plans
  for update to authenticated
  using (delegation = (select public.sat_current_delegation()) and
    (status = 'BORRADOR' or public.sat_plan_edit_enabled(period, delegation)))
  with check (delegation = (select public.sat_current_delegation()));

create or replace function public.sat_guard_monthly_delegate_update()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if public.sat_current_delegation() is not null and (
    new.period is distinct from old.period or new.delegation is distinct from old.delegation
    or new.region is distinct from old.region or new.id is distinct from old.id
    or (old.status = 'ENVIADO' and new.status is distinct from old.status)
  ) then
    raise exception 'No se permite cambiar la identidad ni reabrir el plan' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists sat_guard_monthly_delegate_update on public.sat_monthly_plans;
create trigger sat_guard_monthly_delegate_update before update on public.sat_monthly_plans
  for each row execute function public.sat_guard_monthly_delegate_update();
commit;
