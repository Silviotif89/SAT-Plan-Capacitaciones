begin;
create or replace function public.sat_my_account()
returns table (delegation text, must_change_password boolean)
language sql stable security definer set search_path = ''
as $$
  select a.delegation, a.must_change_password from sat_private.delegation_accounts a
  where a.auth_user_id = auth.uid() and a.enabled
$$;

create or replace function public.sat_my_november_plan()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select to_jsonb(p) - 'edit_token' from public.sat_november_2026_plans p
  join sat_private.delegation_accounts a on a.delegation = p.delegation
  where a.auth_user_id = auth.uid() and a.enabled and not a.must_change_password
$$;

create or replace function sat_private.sat_record_password_change()
returns trigger language plpgsql security definer set search_path = ''
as $
begin
  if old.encrypted_password is distinct from new.encrypted_password
    and auth.uid() = new.id then
    update sat_private.delegation_accounts
    set must_change_password = false
    where auth_user_id = new.id and enabled;
  end if;
  return new;
end;
$;
drop trigger if exists sat_record_password_change on auth.users;
create trigger sat_record_password_change after update of encrypted_password on auth.users
for each row execute function sat_private.sat_record_password_change();

create or replace function public.sat_admin_accounts()
returns table (delegation text, enabled boolean, provisioned boolean, last_sign_in_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select a.delegation, a.enabled, u.id is not null, u.last_sign_in_at
  from sat_private.delegation_accounts a left join auth.users u on u.id = a.auth_user_id
  where auth.jwt()->>'email' = 'ddt36@intur.local'
  order by a.delegation
$$;

create or replace function public.sat_admin_enable_account(target text, active boolean)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if (auth.jwt()->>'email') is distinct from 'ddt36@intur.local' then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;
  update sat_private.delegation_accounts set enabled = active
  where delegation = target and auth_user_id is not null;
  if not found then raise exception 'Cuenta sin configurar'; end if;
end;
$$;

revoke all on function public.sat_my_account(), public.sat_my_november_plan(),
  public.sat_admin_accounts(),
  public.sat_admin_enable_account(text,boolean) from public, anon;
grant execute on function public.sat_my_account(), public.sat_my_november_plan(),
  public.sat_admin_accounts(),
  public.sat_admin_enable_account(text,boolean) to authenticated;
commit;
