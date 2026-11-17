-- Permite que una delegación cree su propio plan directamente como ENVIADO.
-- Evita guardar un BORRADOR primero y depender de un segundo PATCH para enviarlo.
-- No habilita acceso a otras delegaciones ni permite reabrir planes enviados.
begin;

drop policy if exists sat_monthly_delegate_insert on public.sat_monthly_plans;
create policy sat_monthly_delegate_insert on public.sat_monthly_plans for insert to authenticated
 with check (
  delegation=(select public.sat_current_delegation())
  and status in ('BORRADOR','ENVIADO')
 );

drop policy if exists sat_november_delegate_insert on public.sat_november_2026_plans;
create policy sat_november_delegate_insert on public.sat_november_2026_plans for insert to authenticated
 with check (
  delegation=(select public.sat_current_delegation())
  and status in ('BORRADOR','ENVIADO')
 );

commit;
