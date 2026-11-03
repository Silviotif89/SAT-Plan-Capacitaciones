begin;
drop trigger if exists sat_record_password_change on auth.users;
drop function if exists sat_private.sat_record_password_change();
alter table sat_private.delegation_accounts
  add column if not exists auth_user_id uuid unique references auth.users(id),
  add column if not exists enabled boolean not null default false,
  add column if not exists must_change_password boolean not null default true;

create table if not exists public.sat_plan_edit_permissions (
  period date not null check (extract(day from period) = 1),
  delegation text not null references sat_private.delegation_accounts(delegation),
  enabled boolean not null default false,
  primary key (period, delegation)
);
alter table public.sat_monthly_plans add column if not exists period date;
create unique index if not exists sat_monthly_period_delegation_uq on public.sat_monthly_plans(period,delegation);
alter table public.sat_monthly_plans enable row level security;
grant select,insert,update on public.sat_monthly_plans to authenticated;

create or replace function sat_private.sat_session_is_current(account_id uuid, cutoff timestamptz)
returns boolean language sql stable security definer set search_path=''
as $sat$
 select exists(select 1 from auth.sessions s
 where s.id::text=auth.jwt()->>'session_id' and s.user_id=account_id and s.created_at>=cutoff)
$sat$;
revoke all on function sat_private.sat_session_is_current(uuid,timestamptz) from public,anon,authenticated;

create or replace function public.sat_current_delegation()
returns text language sql stable security definer set search_path=''
as $sat$
 select delegation from sat_private.delegation_accounts
 where auth_user_id=auth.uid() and enabled and not must_change_password
 and sat_private.sat_session_is_current(auth_user_id,updated_at)
$sat$;
revoke all on function public.sat_current_delegation() from public,anon;
grant execute on function public.sat_current_delegation() to authenticated;

create or replace function public.sat_plan_edit_enabled(p date, d text)
returns boolean language sql stable security definer set search_path=''
as $sat$
 select coalesce((select enabled from public.sat_plan_edit_permissions
 where period=p and delegation=d
 and d=public.sat_current_delegation()),false)
$sat$;
revoke all on function public.sat_plan_edit_enabled(date,text) from public,anon;
grant execute on function public.sat_plan_edit_enabled(date,text) to authenticated;

drop policy if exists sat_monthly_delegate_read on public.sat_monthly_plans;
create policy sat_monthly_delegate_read on public.sat_monthly_plans for select to authenticated
 using(delegation=(select public.sat_current_delegation()));
drop policy if exists sat_monthly_delegate_insert on public.sat_monthly_plans;
create policy sat_monthly_delegate_insert on public.sat_monthly_plans for insert to authenticated
 with check(delegation=(select public.sat_current_delegation()) and status='BORRADOR');
drop policy if exists sat_monthly_delegate_update on public.sat_monthly_plans;
create policy sat_monthly_delegate_update on public.sat_monthly_plans for update to authenticated
 using(delegation=(select public.sat_current_delegation()) and
 (status='BORRADOR' or public.sat_plan_edit_enabled(period,delegation)))
 with check(delegation=(select public.sat_current_delegation()));
drop policy if exists sat_monthly_admin on public.sat_monthly_plans;
create policy sat_monthly_admin on public.sat_monthly_plans for all to authenticated
 using((select auth.jwt()->>'email')='ddt36@intur.local')
 with check((select auth.jwt()->>'email')='ddt36@intur.local');

-- El plan legado de noviembre conserva sus filas y permite consulta autenticada
-- por delegación. Su edición sigue sujeta al permiso mensual de la DDT.
grant select,insert,update on public.sat_november_2026_plans to authenticated;
drop policy if exists sat_november_delegate_read on public.sat_november_2026_plans;
create policy sat_november_delegate_read on public.sat_november_2026_plans for select to authenticated
 using(delegation=(select public.sat_current_delegation()));
drop policy if exists sat_november_delegate_insert on public.sat_november_2026_plans;
create policy sat_november_delegate_insert on public.sat_november_2026_plans for insert to authenticated
 with check(delegation=(select public.sat_current_delegation()) and status='BORRADOR');
drop policy if exists sat_november_delegate_update on public.sat_november_2026_plans;
create policy sat_november_delegate_update on public.sat_november_2026_plans for update to authenticated
 using(delegation=(select public.sat_current_delegation()) and
  (status='BORRADOR' or public.sat_plan_edit_enabled(date '2026-11-01',delegation)))
 with check(delegation=(select public.sat_current_delegation()));

create or replace function public.sat_guard_november_delegate_update()
returns trigger language plpgsql set search_path=''
as $sat$
begin
 if (select auth.jwt()->>'email') = 'ddt36@intur.local' then return new; end if;
 if public.sat_current_delegation() is not null and (
  new.id is distinct from old.id or new.delegation is distinct from old.delegation
  or new.region is distinct from old.region or new.edit_token is distinct from old.edit_token
  or (old.status='ENVIADO' and new.status is distinct from old.status)
 ) then raise exception 'No se permite cambiar la identidad ni reabrir el plan' using errcode='42501'; end if;
 return new;
end;
$sat$;
drop trigger if exists sat_guard_november_delegate_update on public.sat_november_2026_plans;
create trigger sat_guard_november_delegate_update before update on public.sat_november_2026_plans
 for each row execute function public.sat_guard_november_delegate_update();

alter table public.sat_plan_edit_permissions enable row level security;
grant select,insert,update on public.sat_plan_edit_permissions to authenticated;
drop policy if exists sat_permission_admin on public.sat_plan_edit_permissions;
drop policy if exists sat_edit_permission_admin on public.sat_plan_edit_permissions;
create policy sat_permission_admin on public.sat_plan_edit_permissions for all to authenticated
 using((select auth.jwt()->>'email')='ddt36@intur.local')
 with check((select auth.jwt()->>'email')='ddt36@intur.local');
drop policy if exists sat_permission_delegate_read on public.sat_plan_edit_permissions;
drop policy if exists sat_edit_permission_delegate_read on public.sat_plan_edit_permissions;
create policy sat_permission_delegate_read on public.sat_plan_edit_permissions for select to authenticated
 using(delegation=(select public.sat_current_delegation()));

create or replace function public.sat_my_account()
returns table(delegation text,must_change_password boolean)
language sql stable security definer set search_path=''
as $sat$
 select a.delegation,a.must_change_password from sat_private.delegation_accounts a
 where a.auth_user_id=auth.uid() and a.enabled
 and sat_private.sat_session_is_current(a.auth_user_id,a.updated_at)
$sat$;
create or replace function public.sat_my_november_plan()
returns jsonb language sql stable security definer set search_path=''
as $sat$
 select to_jsonb(p)-'edit_token' from public.sat_november_2026_plans p
 join sat_private.delegation_accounts a on a.delegation=p.delegation
 where a.auth_user_id=auth.uid() and a.enabled and not a.must_change_password
 and sat_private.sat_session_is_current(a.auth_user_id,a.updated_at)
$sat$;

create or replace function public.sat_complete_password_change()
returns void language plpgsql security definer set search_path=''
as $sat$
begin
 update sat_private.delegation_accounts a set must_change_password=false
 from auth.users u where u.id=auth.uid() and a.auth_user_id=u.id and a.enabled
 and a.must_change_password and u.updated_at>a.updated_at;
end;
$sat$;

create or replace function public.sat_admin_accounts()
returns table(delegation text,enabled boolean,provisioned boolean,last_sign_in_at timestamptz)
language sql stable security definer set search_path=''
as $sat$
 select a.delegation,a.enabled,u.id is not null,u.last_sign_in_at
 from sat_private.delegation_accounts a left join auth.users u on u.id=a.auth_user_id
 where auth.jwt()->>'email'='ddt36@intur.local' order by a.delegation
$sat$;
create or replace function public.sat_admin_enable_account(target text,active boolean)
returns void language plpgsql security definer set search_path=''
as $sat$
begin
 if (auth.jwt()->>'email') is distinct from 'ddt36@intur.local' then raise exception 'Acceso denegado' using errcode='42501'; end if;
 update sat_private.delegation_accounts set enabled=active,updated_at=clock_timestamp() where delegation=target and auth_user_id is not null;
 if not found then raise exception 'Cuenta sin configurar'; end if;
end;
$sat$;

create or replace function public.sat_service_account(target text)
returns jsonb language sql stable security definer set search_path=''
as $sat$
 select jsonb_build_object('auth_user_id',auth_user_id,'enabled',enabled)
 from sat_private.delegation_accounts where delegation=target
$sat$;
create or replace function public.sat_service_link(target text,account_id uuid)
returns void language plpgsql security definer set search_path=''
as $sat$
begin
 update sat_private.delegation_accounts set auth_user_id=account_id,enabled=true,must_change_password=true,updated_at=clock_timestamp()
 where delegation=target and auth_user_id is null;
 if not found then raise exception 'Delegación ya vinculada o inexistente'; end if;
end;
$sat$;
create or replace function public.sat_service_unlink(target text,account_id uuid)
returns void language plpgsql security definer set search_path=''
as $sat$
begin
 update sat_private.delegation_accounts
 set auth_user_id=null,enabled=false,must_change_password=true,updated_at=clock_timestamp()
 where delegation=target and auth_user_id=account_id;
 if not found then raise exception 'No se pudo revertir el vínculo de la cuenta'; end if;
end;
$sat$;
create or replace function public.sat_service_prepare_reset(target text)
returns void language plpgsql security definer set search_path=''
as $sat$
begin
 update sat_private.delegation_accounts set must_change_password=true,updated_at=clock_timestamp()
 where delegation=target and auth_user_id is not null;
 if not found then raise exception 'Cuenta sin configurar'; end if;
end;
$sat$;
revoke all on function public.sat_service_account(text),public.sat_service_link(text,uuid),public.sat_service_unlink(text,uuid),public.sat_service_prepare_reset(text) from authenticated;
revoke all on function public.sat_my_account(),public.sat_my_november_plan(),public.sat_complete_password_change(),
 public.sat_admin_accounts(),public.sat_admin_enable_account(text,boolean),
 public.sat_service_account(text),public.sat_service_link(text,uuid),public.sat_service_unlink(text,uuid),
 public.sat_service_prepare_reset(text)
 from public,anon;
grant execute on function public.sat_my_account(),public.sat_my_november_plan(),public.sat_complete_password_change(),
 public.sat_admin_accounts(),public.sat_admin_enable_account(text,boolean)
 to authenticated;
grant execute on function public.sat_service_account(text),public.sat_service_link(text,uuid),
 public.sat_service_unlink(text,uuid),public.sat_service_prepare_reset(text)
 to service_role;

create or replace function public.sat_guard_monthly_delegate_update()
returns trigger language plpgsql set search_path=''
as $sat$
begin
 if public.sat_current_delegation() is not null and (
  new.period is distinct from old.period or new.delegation is distinct from old.delegation
  or new.region is distinct from old.region or new.id is distinct from old.id
  or new.edit_token is distinct from old.edit_token
  or (old.status='ENVIADO' and new.status is distinct from old.status)
 ) then raise exception 'No se permite cambiar la identidad ni reabrir el plan' using errcode='42501'; end if;
 return new;
end;
$sat$;
drop trigger if exists sat_guard_monthly_delegate_update on public.sat_monthly_plans;
create trigger sat_guard_monthly_delegate_update before update on public.sat_monthly_plans
 for each row execute function public.sat_guard_monthly_delegate_update();
commit;
