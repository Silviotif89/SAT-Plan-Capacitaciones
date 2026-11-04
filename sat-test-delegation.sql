-- Cuenta desechable para validar el flujo de León sin modificar sus filas.
-- Aplicar en el SQL Editor del proyecto SAT ajfpbugjnlplrqlzlpyo.
begin;

do $sat$
declare
  official_accounts integer;
  official_november_plans integer;
begin
  select count(*) into official_accounts
  from sat_private.delegation_accounts
  where delegation <> 'Prueba';
  select count(*) into official_november_plans
  from public.sat_november_2026_plans
  where delegation <> 'Prueba';

  if official_accounts <> 17 then
    raise exception 'Se esperaban 17 delegaciones originales; se encontraron %.', official_accounts;
  end if;
  if official_november_plans <> 15 then
    raise exception 'Se esperaban 15 planes originales de noviembre; se encontraron %.', official_november_plans;
  end if;
  if not exists (select 1 from public.sat_november_2026_plans where delegation = 'León') then
    raise exception 'No existe el plan de León que se utilizará como modelo.';
  end if;
end;
$sat$;

alter table public.sat_november_2026_plans
  drop constraint if exists sat_november_2026_plans_delegation_check;
alter table public.sat_november_2026_plans
  add constraint sat_november_2026_plans_delegation_check
  check (delegation in (
    'Boaco', 'Carazo', 'Chinandega', 'Chontales', 'Estelí', 'Granada', 'Jinotega',
    'León', 'Managua', 'Masaya', 'Rivas', 'Matagalpa', 'Nueva Segovia', 'Madriz',
    'Río San Juan', 'RACCN', 'RACCS', 'Prueba'
  ));

alter table public.sat_monthly_plans
  drop constraint if exists sat_november_2026_plans_delegation_check;
alter table public.sat_monthly_plans
  add constraint sat_november_2026_plans_delegation_check
  check (delegation in (
    'Boaco', 'Carazo', 'Chinandega', 'Chontales', 'Estelí', 'Granada', 'Jinotega',
    'León', 'Managua', 'Masaya', 'Rivas', 'Matagalpa', 'Nueva Segovia', 'Madriz',
    'Río San Juan', 'RACCN', 'RACCS', 'Prueba'
  ));

insert into sat_private.delegation_accounts
  (delegation, password_hash, must_change_password, enabled)
values ('Prueba', null, true, false)
on conflict (delegation) do nothing;

insert into public.sat_november_2026_plans
  (id, region, delegation, registrant_name, registrant_role, registrant_email,
   registrant_phone, activities, status, edit_token, created_at, updated_at)
select gen_random_uuid(), region, 'Prueba', '', '', '', '', activities,
       'BORRADOR', gen_random_uuid(), now(), now()
from public.sat_november_2026_plans
where delegation = 'León'
on conflict (delegation) do nothing;

create or replace function public.sat_service_delete_test(target text)
returns void
language plpgsql
security definer
set search_path = ''
as $sat$
begin
  if target is distinct from 'Prueba' then
    raise exception 'Solo se puede eliminar la delegación temporal Prueba';
  end if;
  if exists (
    select 1 from sat_private.delegation_accounts
    where delegation = 'Prueba' and auth_user_id is not null
  ) then
    raise exception 'La cuenta de autenticación debe desvincularse antes de limpiar la prueba';
  end if;

  delete from public.sat_plan_edit_permissions where delegation = 'Prueba';
  delete from public.sat_monthly_plans where delegation = 'Prueba';
  delete from public.sat_november_2026_plans where delegation = 'Prueba';
  delete from sat_private.delegation_accounts where delegation = 'Prueba';

  alter table public.sat_november_2026_plans
    drop constraint if exists sat_november_2026_plans_delegation_check;
  alter table public.sat_november_2026_plans
    add constraint sat_november_2026_plans_delegation_check
    check (delegation in (
      'Boaco', 'Carazo', 'Chinandega', 'Chontales', 'Estelí', 'Granada', 'Jinotega',
      'León', 'Managua', 'Masaya', 'Rivas', 'Matagalpa', 'Nueva Segovia', 'Madriz',
      'Río San Juan', 'RACCN', 'RACCS'
    ));
  alter table public.sat_monthly_plans
    drop constraint if exists sat_november_2026_plans_delegation_check;
  alter table public.sat_monthly_plans
    add constraint sat_november_2026_plans_delegation_check
    check (delegation in (
      'Boaco', 'Carazo', 'Chinandega', 'Chontales', 'Estelí', 'Granada', 'Jinotega',
      'León', 'Managua', 'Masaya', 'Rivas', 'Matagalpa', 'Nueva Segovia', 'Madriz',
      'Río San Juan', 'RACCN', 'RACCS'
    ));
end;
$sat$;

revoke all on function public.sat_service_delete_test(text) from public, anon, authenticated;
grant execute on function public.sat_service_delete_test(text) to service_role;

do $sat$
declare
  official_accounts integer;
  official_november_plans integer;
  total_november_plans integer;
begin
  select count(*) into official_accounts
  from sat_private.delegation_accounts where delegation <> 'Prueba';
  select count(*) into official_november_plans
  from public.sat_november_2026_plans where delegation <> 'Prueba';
  select count(*) into total_november_plans
  from public.sat_november_2026_plans;
  if official_accounts <> 17 or official_november_plans <> 15 or total_november_plans <> 16 then
    raise exception 'La comprobación de la cuenta de prueba no coincide con los datos esperados.';
  end if;
  if not exists (
    select 1 from public.sat_november_2026_plans
    where delegation = 'Prueba' and status = 'BORRADOR'
      and jsonb_array_length(activities) = (
        select jsonb_array_length(activities)
        from public.sat_november_2026_plans where delegation = 'León'
      )
  ) then
    raise exception 'No se pudo validar la copia independiente del plan de León.';
  end if;
end;
$sat$;

commit;
