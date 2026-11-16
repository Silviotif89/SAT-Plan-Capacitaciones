begin;

create table if not exists sat_private.delegation_contact_book (
  delegation text primary key,
  contact_name text not null default '',
  phone text not null default '',
  source_period date,
  updated_at timestamptz not null default clock_timestamp(),
  updated_by uuid references auth.users(id),
  constraint sat_delegation_contact_name_length check (char_length(contact_name) <= 160),
  constraint sat_delegation_contact_phone_length check (char_length(phone) <= 40)
);

alter table sat_private.delegation_contact_book enable row level security;
revoke all on table sat_private.delegation_contact_book from public, anon, authenticated;

with expected(delegation) as (
  values
    ('Boaco'), ('Carazo'), ('Chinandega'), ('Chontales'), ('Estelí'),
    ('Granada'), ('Jinotega'), ('León'), ('Madriz'), ('Managua'),
    ('Masaya'), ('Matagalpa'), ('Nueva Segovia'), ('RACCN'), ('RACCS'),
    ('Río San Juan'), ('Rivas')
),
november_plans as (
  select delegation, registrant_name, registrant_phone, updated_at, date '2026-11-01' as source_period
  from public.sat_november_2026_plans
  union all
  select delegation, registrant_name, registrant_phone, updated_at, period
  from public.sat_monthly_plans
  where period = date '2026-11-01'
),
latest as (
  select distinct on (delegation)
    delegation, registrant_name, registrant_phone, source_period
  from november_plans
  order by delegation, updated_at desc nulls last, source_period desc
)
insert into sat_private.delegation_contact_book (
  delegation, contact_name, phone, source_period
)
select
  expected.delegation,
  coalesce(nullif(btrim(latest.registrant_name), ''), ''),
  coalesce(nullif(btrim(latest.registrant_phone), ''), ''),
  latest.source_period
from expected
left join latest on latest.delegation = expected.delegation
on conflict (delegation) do nothing;

create or replace function public.sat_admin_contact_book()
returns table(
  delegation text,
  contact_name text,
  phone text,
  source_period date,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $sat$
begin
  if (select auth.role()) is distinct from 'authenticated'
     or (select auth.jwt()->>'email') is distinct from 'ddt36@intur.local' then
    raise exception 'Solo la administración DDT puede consultar estos contactos'
      using errcode = '42501';
  end if;

  return query
  select c.delegation, c.contact_name, c.phone, c.source_period, c.updated_at
  from sat_private.delegation_contact_book c
  order by c.delegation;
end;
$sat$;

create or replace function public.sat_admin_update_contact(
  target_delegation text,
  target_name text,
  target_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $sat$
begin
  if (select auth.role()) is distinct from 'authenticated'
     or (select auth.jwt()->>'email') is distinct from 'ddt36@intur.local' then
    raise exception 'Solo la administración DDT puede actualizar estos contactos'
      using errcode = '42501';
  end if;

  if target_name is null or btrim(target_name) = ''
     or target_phone is null or btrim(target_phone) = '' then
    raise exception 'El nombre y el teléfono son obligatorios'
      using errcode = '22023';
  end if;

  if char_length(btrim(target_name)) > 160 or char_length(btrim(target_phone)) > 40 then
    raise exception 'El nombre o teléfono excede el límite permitido'
      using errcode = '22023';
  end if;

  update sat_private.delegation_contact_book
  set contact_name = btrim(target_name),
      phone = btrim(target_phone),
      source_period = null,
      updated_at = clock_timestamp(),
      updated_by = auth.uid()
  where delegation = target_delegation;

  if not found then
    raise exception 'Delegación no encontrada'
      using errcode = '22023';
  end if;
end;
$sat$;

revoke all on function public.sat_admin_contact_book() from public, anon;
revoke all on function public.sat_admin_update_contact(text, text, text) from public, anon;
grant execute on function public.sat_admin_contact_book() to authenticated;
grant execute on function public.sat_admin_update_contact(text, text, text) to authenticated;

commit;
