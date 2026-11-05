begin;

-- Add an audit trail for password resets. It deliberately contains no password,
-- password hash, recovery token, or request body.
create table if not exists sat_private.sat_password_reset_audit (
  id uuid primary key default gen_random_uuid(),
  delegation text not null references sat_private.delegation_accounts(delegation) on delete restrict,
  admin_user_id uuid references auth.users(id) on delete set null,
  admin_email text not null,
  outcome text not null default 'INICIADO'
    check (outcome in ('INICIADO', 'EXITOSO', 'FALLIDO')),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);

create index if not exists sat_password_reset_audit_recent_idx
  on sat_private.sat_password_reset_audit (created_at desc);
create index if not exists sat_password_reset_audit_delegation_recent_idx
  on sat_private.sat_password_reset_audit (delegation, created_at desc);

alter table sat_private.sat_password_reset_audit enable row level security;
revoke all on table sat_private.sat_password_reset_audit from public, anon, authenticated;
grant select, insert, update on table sat_private.sat_password_reset_audit to service_role;

create or replace function public.sat_service_start_password_reset(
  p_delegation text,
  p_admin_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $sat$
declare
  v_admin_email text;
  v_event_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;

  select u.email into v_admin_email
  from auth.users u
  where u.id = p_admin_id;
  if v_admin_email is distinct from 'ddt36@intur.local' then
    raise exception 'Administrador inválido' using errcode = '42501';
  end if;

  if not exists (
    select 1 from sat_private.delegation_accounts a
    where a.delegation = p_delegation and a.auth_user_id is not null
  ) then
    raise exception 'Cuenta sin configurar' using errcode = 'P0002';
  end if;

  insert into sat_private.sat_password_reset_audit (
    delegation, admin_user_id, admin_email, outcome
  ) values (
    p_delegation, p_admin_id, v_admin_email, 'INICIADO'
  ) returning id into v_event_id;

  return v_event_id;
end;
$sat$;

create or replace function public.sat_service_finish_password_reset(
  p_event_id uuid,
  p_admin_id uuid,
  p_outcome text
)
returns void
language plpgsql
security definer
set search_path = ''
as $sat$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;
  if p_outcome not in ('EXITOSO', 'FALLIDO') then
    raise exception 'Resultado inválido' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = p_admin_id and u.email = 'ddt36@intur.local'
  ) then
    raise exception 'Administrador inválido' using errcode = '42501';
  end if;

  update sat_private.sat_password_reset_audit a
  set outcome = p_outcome, completed_at = clock_timestamp()
  where a.id = p_event_id
    and a.admin_user_id = p_admin_id
    and a.outcome = 'INICIADO';
  if not found then
    raise exception 'Evento de restablecimiento no encontrado' using errcode = 'P0002';
  end if;
end;
$sat$;

create or replace function public.sat_admin_password_reset_history(p_delegation text default null)
returns table(delegation text, created_at timestamptz, admin_email text, outcome text)
language plpgsql
stable
security definer
set search_path = ''
as $sat$
begin
  if (select auth.jwt() ->> 'email') is distinct from 'ddt36@intur.local' then
    raise exception 'Acceso denegado' using errcode = '42501';
  end if;

  return query
  select a.delegation, a.created_at, a.admin_email, a.outcome
  from sat_private.sat_password_reset_audit a
  where p_delegation is null or a.delegation = p_delegation
  order by a.created_at desc
  limit 250;
end;
$sat$;

revoke all on function public.sat_service_start_password_reset(text, uuid) from public, anon, authenticated;
revoke all on function public.sat_service_finish_password_reset(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sat_admin_password_reset_history(text) from public, anon;
grant execute on function public.sat_service_start_password_reset(text, uuid) to service_role;
grant execute on function public.sat_service_finish_password_reset(uuid, uuid, text) to service_role;
grant execute on function public.sat_admin_password_reset_history(text) to authenticated;

commit;
