-- Rates supplied by RH on 10/11/2026. Existing snapshots are not recalculated.
do $$
declare pending_constraint text; matches integer;
begin
  select min(conname),count(*) into pending_constraint,matches
  from pg_constraint
  where conrelid='public.benefit_meal_rows'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%planned_work_days IS NULL%'
    and pg_get_constraintdef(oid) like '%daily_value IS NULL%';
  if matches<>1 then raise exception 'Restrição financeira anterior não reconhecida; nenhuma alteração aplicada'; end if;
  execute format('alter table public.benefit_meal_rows drop constraint %I',pending_constraint);
end $$;

alter table public.benefit_meal_rows
  add column calculation_version integer,
  add column calculation_status text,
  add column calculation_notes jsonb not null default '[]'::jsonb check(jsonb_typeof(calculation_notes)='array'),
  add constraint benefit_meal_calculation_shape check (
    (calculation_version is null and calculation_status is null and planned_work_days is null and payable_days is null and daily_value is null and amount_due is null)
    or (calculation_version is not null and calculation_version=1 and calculation_status is not null and calculation_status in('READY','PENDING'))
  ),
  add constraint benefit_meal_approved_rates check (calculation_version is null or (
    daily_value is not distinct from case rate_group
      when 'TECNICO' then 25::numeric when 'GERAL' then 20::numeric when 'VENDAS' then 20::numeric
      when 'RECIFE_VENDAS' then 20::numeric when 'RECIFE_TECNICO' then 28.58::numeric when 'RECIFE_ESTOQUE_RH' then 23::numeric
      else null::numeric end
    and planned_work_days is not distinct from case when rate_group='RECIFE_ESTOQUE_RH' then 22::numeric else null::numeric end
  )),
  add constraint benefit_meal_amount_consistency check (calculation_version is null or (
    (calculation_status='PENDING' and payable_days is null and amount_due is null)
    or (calculation_status='READY' and rate_group='RECIFE_ESTOQUE_RH' and employment_status='ATIVO'
      and absence_days is not null and medical_days is not null and overlap_days is not null and overlap_days=0 and deduction_days is not null
      and planned_work_days=22 and daily_value=23 and payable_days is not null and amount_due is not null
      and payable_days=greatest(0,planned_work_days-deduction_days)
      and amount_due=round(payable_days*daily_value,2)
      and jsonb_array_length(issues)=0 and jsonb_array_length(calculation_notes)=0)
  ));

create function public.complete_benefit_meal_calculated_run(p_run_id uuid,p_actor uuid,p_rows jsonb,p_events jsonb,p_coverage jsonb,p_warnings jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare target public.benefit_meal_runs; result uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor and status='ATIVO' and role in('ADMINISTRADOR','RH')) then raise exception 'Acesso negado'; end if;
  select * into target from public.benefit_meal_runs where id=p_run_id for update;
  if target.id is null or target.status<>'RUNNING' or target.triggered_by is distinct from p_actor then raise exception 'Atualização inválida ou já concluída'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Funcionários inválidos'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where (x->>'calculation_version') is distinct from '1'
    or coalesce(x->>'calculation_status','') not in('READY','PENDING') or jsonb_typeof(x->'calculation_notes') is distinct from 'array')
    then raise exception 'Versão de cálculo inválida'; end if;
  if target.queried_through<target.period_end and exists(select 1 from jsonb_array_elements(p_rows) x where x->>'calculation_status'='READY')
    then raise exception 'Período aberto: valor final ainda não pode ser calculado'; end if;

  -- Reuse the original atomic source/coverage validation. The subsequent update
  -- belongs to the same transaction: invalid money rolls back rows and run status.
  select public.complete_benefit_meal_run(p_run_id,p_actor,p_rows,p_events,p_coverage,p_warnings) into result;
  update public.benefit_meal_rows r set
    daily_value=(x->>'daily_value')::numeric,planned_work_days=(x->>'planned_work_days')::numeric,
    payable_days=(x->>'payable_days')::numeric,amount_due=(x->>'amount_due')::numeric,
    calculation_version=1,calculation_status=x->>'calculation_status',calculation_notes=x->'calculation_notes'
  from jsonb_array_elements(p_rows) x
  where r.run_id=p_run_id and r.snapshot_employee_id=(x->>'employee_id')::uuid;
  return result;
end $$;
revoke all on function public.complete_benefit_meal_calculated_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.complete_benefit_meal_calculated_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
comment on column public.benefit_meal_rows.calculation_version is '1: valores aprovados em 10/11/2026; Recife usa temporariamente faltas + atestados. NULL preserva consultas anteriores.';
comment on column public.benefit_meal_rows.planned_work_days is 'Nesta versão somente estoque/RH Recife possui base fixa de 22 dias. Outros dias previstos ainda serão definidos pelo RH.';
notify pgrst,'reload schema';
