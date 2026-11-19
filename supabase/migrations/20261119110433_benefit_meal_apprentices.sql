alter table public.benefit_meal_rows
  drop constraint benefit_meal_v2_consistency,
  add constraint benefit_meal_v2_consistency check (
    calculation_version is distinct from 2 or coalesce(case
      when rate_group='APRENDIZ' then
        job_title collate "C" ~* '\mAPRENDIZ(ES)?\M'
        and rate_version_id is null and calculation_status='READY'
        and planned_work_days is null and payable_days=0 and daily_value=0 and amount_due=0
      else
        (rate_version_id is null and daily_value is null and planned_work_days is null and payable_days is null and amount_due is null and calculation_status='PENDING')
        or (rate_version_id is not null and daily_value is not null and daily_value>=0
          and (planned_work_days is null or planned_work_days between 1 and 31)
          and ((calculation_status='PENDING' and payable_days is null and amount_due is null)
            or (calculation_status='READY' and employment_status='ATIVO' and absence_days is not null and medical_days is not null and overlap_days=0 and deduction_days is not null
              and planned_work_days is not null and payable_days is not null and amount_due is not null
              and payable_days=greatest(0,planned_work_days-deduction_days) and amount_due=round(payable_days*daily_value,2)
              and jsonb_array_length(issues)=0 and jsonb_array_length(calculation_notes)=0)))
    end,false)
  );

create or replace function public.complete_benefit_meal_versioned_run(p_run_id uuid,p_actor uuid,p_rows jsonb,p_events jsonb,p_coverage jsonb,p_warnings jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare target public.benefit_meal_runs; result uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor and status='ATIVO' and role in('RH','ADMINISTRADOR')) then raise exception 'Acesso negado'; end if;
  select * into target from public.benefit_meal_runs where id=p_run_id for update;
  if target.id is null or target.status<>'RUNNING' or target.triggered_by is distinct from p_actor or target.rate_version_ids is null then raise exception 'Atualização inválida ou já concluída'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Funcionários inválidos'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where x->>'calculation_version' is distinct from '2' or coalesce(x->>'calculation_status','') not in('READY','PENDING') or jsonb_typeof(x->'calculation_notes') is distinct from 'array') then raise exception 'Versão de cálculo inválida'; end if;

  -- A função também recebe cálculos de versões anteriores da Edge Function.
  select coalesce(jsonb_agg(case
    when (x->>'job_title') collate "C" ~* '\mAPRENDIZ(ES)?\M' then x ||
      '{"rate_group":"APRENDIZ","planned_work_days":null,"payable_days":0,"daily_value":0,"amount_due":0,"calculation_status":"READY","calculation_notes":[],"rate_version_id":null}'::jsonb
    else x end), '[]'::jsonb)
  into p_rows from jsonb_array_elements(p_rows) x;

  if target.queried_through<target.period_end and exists(
    select 1 from jsonb_array_elements(p_rows) x where x->>'calculation_status'='READY' and x->>'rate_group' is distinct from 'APRENDIZ'
  ) then raise exception 'Período aberto: valor final ainda não pode ser calculado'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_rows) x left join public.benefit_meal_rate_versions v on v.id=nullif(x->>'rate_version_id','')::uuid
    where nullif(x->>'rate_version_id','') is not null and (v.id is null or not(v.id=any(target.rate_version_ids)) or v.effective_month>target.benefit_month
      or v.rate_group is distinct from x->>'rate_group'
      or v.city is distinct from replace(regexp_replace(btrim(translate(upper(x->>'city'),'ÁÀÂÃÉÊÍÓÔÕÚÇ','AAAAEEIOOOUC')),'\s+',' ','g'),'PANAMIRIM','PARNAMIRIM')
      or v.daily_value is distinct from (x->>'daily_value')::numeric or v.fixed_days is distinct from (x->>'planned_work_days')::numeric)
  ) then raise exception 'Valores não correspondem à configuração registrada para esta consulta'; end if;
  select public.complete_benefit_meal_run(p_run_id,p_actor,p_rows,p_events,p_coverage,p_warnings) into result;
  update public.benefit_meal_rows r set daily_value=(x->>'daily_value')::numeric,planned_work_days=(x->>'planned_work_days')::numeric,payable_days=(x->>'payable_days')::numeric,amount_due=(x->>'amount_due')::numeric,
    calculation_version=2,calculation_status=x->>'calculation_status',calculation_notes=x->'calculation_notes',rate_version_id=nullif(x->>'rate_version_id','')::uuid
  from jsonb_array_elements(p_rows) x where r.run_id=p_run_id and r.snapshot_employee_id=(x->>'employee_id')::uuid;
  return result;
end $$;
revoke all on function public.complete_benefit_meal_versioned_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.complete_benefit_meal_versioned_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
