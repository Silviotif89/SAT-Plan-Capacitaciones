-- SAT INTUR · Plan de capacitaciones de noviembre 2026
-- Ejecutar una sola vez en Supabase: SQL Editor > New query > Run.
-- La clave secreta (service_role) nunca se usa en este proyecto.

create extension if not exists pgcrypto;

create table if not exists public.sat_november_2026_plans (
  id uuid primary key default gen_random_uuid(),
  region text not null check (region in ('Pacífico', 'Norte', 'Centro y Sureste', 'Costa Caribe')),
  delegation text not null unique check (delegation in (
    'Boaco', 'Carazo', 'Chinandega', 'Chontales', 'Estelí', 'Granada', 'Jinotega',
    'León', 'Managua', 'Masaya', 'Rivas', 'Matagalpa', 'Nueva Segovia', 'Madriz',
    'Río San Juan', 'RACCN', 'RACCS'
  )),
  registrant_name text not null,
  registrant_role text not null,
  registrant_email text not null,
  registrant_phone text not null,
  activities jsonb not null default '[]'::jsonb check (jsonb_typeof(activities) = 'array'),
  status text not null default 'BORRADOR' check (status in ('BORRADOR', 'ENVIADO')),
  edit_token uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_sat_november_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sat_november_updated_at on public.sat_november_2026_plans;
create trigger sat_november_updated_at
before update on public.sat_november_2026_plans
for each row execute procedure public.set_sat_november_updated_at();

alter table public.sat_november_2026_plans enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on public.sat_november_2026_plans to anon, authenticated;

-- Cada delegación solo puede consultar o editar el registro cuyo token de edición
-- conserva su propio navegador. Este token no permite ver otras delegaciones.
create or replace function public.sat_request_edit_token()
returns text
language sql
stable
as $$
  select coalesce(current_setting('request.headers', true)::json ->> 'x-edit-token', '');
$$;

drop policy if exists "Delegation inserts November plan" on public.sat_november_2026_plans;
create policy "Delegation inserts November plan"
on public.sat_november_2026_plans
for insert to anon
with check (edit_token::text = public.sat_request_edit_token());

drop policy if exists "Delegation reads own November plan" on public.sat_november_2026_plans;
create policy "Delegation reads own November plan"
on public.sat_november_2026_plans
for select to anon
using (edit_token::text = public.sat_request_edit_token());

drop policy if exists "Delegation updates own November plan" on public.sat_november_2026_plans;
create policy "Delegation updates own November plan"
on public.sat_november_2026_plans
for update to anon
using (edit_token::text = public.sat_request_edit_token())
with check (edit_token::text = public.sat_request_edit_token());

-- La consola administrativa solo se habilita para la cuenta Auth configurada abajo.
-- Cambiá el correo aquí y en config.js si preferís usar otro correo administrativo.
drop policy if exists "Admin manages all November plans" on public.sat_november_2026_plans;
create policy "Admin manages all November plans"
on public.sat_november_2026_plans
for all to authenticated
using ((auth.jwt() ->> 'email') = 'ddt36@intur.local')
with check ((auth.jwt() ->> 'email') = 'ddt36@intur.local');
