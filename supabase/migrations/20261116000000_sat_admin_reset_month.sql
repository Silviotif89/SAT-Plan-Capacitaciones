begin;

create or replace function public.sat_admin_reset_month(target_period date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $sat$
declare
  legacy_plans_deleted integer := 0;
  monthly_plans_deleted integer := 0;
begin
  if (select auth.role()) is distinct from 'authenticated'
     or (select auth.jwt()->>'email') is distinct from 'ddt36@intur.local' then
    raise exception 'Solo la administración DDT puede reiniciar un mes'
      using errcode = '42501';
  end if;

  if target_period is null or extract(day from target_period) is distinct from 1 then
    raise exception 'El período debe ser el primer día del mes'
      using errcode = '22023';
  end if;

  if target_period = date '2026-11-01' then
    delete from public.sat_november_2026_plans;
    get diagnostics legacy_plans_deleted = row_count;
  end if;

  delete from public.sat_monthly_plans
    where period = target_period;
  get diagnostics monthly_plans_deleted = row_count;

  return jsonb_build_object(
    'plans_deleted', legacy_plans_deleted + monthly_plans_deleted
  );
end;
$sat$;

revoke all on function public.sat_admin_reset_month(date) from public, anon;
grant execute on function public.sat_admin_reset_month(date) to authenticated;

commit;
