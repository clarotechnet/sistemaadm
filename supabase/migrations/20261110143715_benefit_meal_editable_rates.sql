-- Append-only, shared RH rates. No existing query or employee is recalculated.
create table public.benefit_meal_rate_versions (
  id uuid primary key default gen_random_uuid(), revision bigint generated always as identity unique,
  city text not null, rate_group text not null,
  effective_month date not null check(extract(day from effective_month)=1 and effective_month>='1900-01-01'),
  daily_value numeric(14,2) not null check(daily_value between 0 and 9999999999.99),
  fixed_days integer,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null, note text not null default '' check(length(note)<=500),
  constraint benefit_meal_rate_scope check (
    (city in('NATAL','MOSSORO','PARNAMIRIM','FORTALEZA') and rate_group in('TECNICO','GERAL'))
    or (city='RECIFE' and rate_group in('RECIFE_VENDAS','RECIFE_ESTOQUE_RH','RECIFE_TECNICO'))
    or (city in('JOAO PESSOA','MACEIO') and rate_group='VENDAS')
  ),
  constraint benefit_meal_rate_days check (
    (rate_group='RECIFE_ESTOQUE_RH' and fixed_days is not null and fixed_days between 1 and 31)
    or (rate_group<>'RECIFE_ESTOQUE_RH' and fixed_days is null)
  )
);
create index benefit_meal_rate_lookup on public.benefit_meal_rate_versions(city,rate_group,effective_month desc,revision desc);
create index benefit_meal_rate_actor on public.benefit_meal_rate_versions(created_by);
alter table public.benefit_meal_rate_versions enable row level security;
create policy benefit_meal_rates_read on public.benefit_meal_rate_versions for select to authenticated using ((select public.is_rh_or_admin()));
revoke all on public.benefit_meal_rate_versions from public,anon,authenticated,service_role;
grant select on public.benefit_meal_rate_versions to authenticated;
grant select,insert on public.benefit_meal_rate_versions to service_role;
grant usage,select on sequence public.benefit_meal_rate_versions_revision_seq to service_role;
insert into public.benefit_meal_rate_versions(city,rate_group,effective_month,daily_value,fixed_days,created_by_name,note)
select city,rate_group,'2026-11-01'::date,daily_value,fixed_days,'Valores iniciais do RH','Configuração inicial informada pelo RH em 10/11/2026.' from (values
 ('NATAL','TECNICO',25::numeric,null::integer),('NATAL','GERAL',20,null),
 ('MOSSORO','TECNICO',25,null),('MOSSORO','GERAL',20,null),
 ('PARNAMIRIM','TECNICO',25,null),('PARNAMIRIM','GERAL',20,null),
 ('FORTALEZA','TECNICO',25,null),('FORTALEZA','GERAL',20,null),
 ('RECIFE','RECIFE_VENDAS',20,null),('RECIFE','RECIFE_ESTOQUE_RH',23,22),('RECIFE','RECIFE_TECNICO',28.58,null),
 ('JOAO PESSOA','VENDAS',20,null),('MACEIO','VENDAS',20,null)
) seed(city,rate_group,daily_value,fixed_days);

create function public.get_benefit_meal_rates(p_month date) returns setof public.benefit_meal_rate_versions language sql stable security invoker set search_path='' as $$
  select distinct on(city,rate_group) v.* from public.benefit_meal_rate_versions v
  where effective_month<=p_month order by city,rate_group,effective_month desc,revision desc;
$$;
revoke all on function public.get_benefit_meal_rates(date) from public,anon,authenticated;
grant execute on function public.get_benefit_meal_rates(date) to authenticated,service_role;

create function public.save_benefit_meal_rates(p_actor uuid,p_city text,p_month date,p_changes jsonb,p_note text default '')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor_name text; item jsonb; previous public.benefit_meal_rate_versions; amount numeric; days integer; saved integer:=0; new_id uuid;
begin
  select full_name into actor_name from public.profiles where id=p_actor and status='ATIVO' and role in('RH','ADMINISTRADOR');
  if not found then raise exception 'Acesso negado'; end if;
  if p_city is null or p_city not in('NATAL','MOSSORO','PARNAMIRIM','FORTALEZA','RECIFE','JOAO PESSOA','MACEIO') then raise exception 'Cidade inválida'; end if;
  if p_month is null or extract(day from p_month)<>1 or p_month<'1900-01-01' then raise exception 'Competência inválida'; end if;
  if length(coalesce(p_note,''))>500 then raise exception 'Observação excede 500 caracteres'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) not between 1 and 3 then raise exception 'Valores inválidos'; end if;
  if (select count(distinct x->>'group') from jsonb_array_elements(p_changes) x)<>jsonb_array_length(p_changes) then raise exception 'Grupo repetido'; end if;
  perform pg_advisory_xact_lock(hashtext('benefit_meal_rate:'||p_city));
  for item in select value from jsonb_array_elements(p_changes) loop
    if coalesce(item->>'group','') not in('TECNICO','GERAL','VENDAS','RECIFE_VENDAS','RECIFE_ESTOQUE_RH','RECIFE_TECNICO') then raise exception 'Grupo inválido'; end if;
    if jsonb_typeof(item->'dailyCents') is distinct from 'number' or coalesce(item->>'dailyCents','') !~ '^[0-9]+$' then raise exception 'Valor diário inválido'; end if;
    amount:=(item->>'dailyCents')::numeric/100;
    if amount not between 0 and 9999999999.99 then raise exception 'Valor diário fora do limite'; end if;
    if item->>'group'='RECIFE_ESTOQUE_RH' then
      if jsonb_typeof(item->'fixedDays') is distinct from 'number' or coalesce(item->>'fixedDays','') !~ '^[0-9]+$' then raise exception 'Base fixa inválida'; end if;
      days:=(item->>'fixedDays')::integer;
      if days not between 1 and 31 then raise exception 'Base fixa deve ser de 1 a 31 dias'; end if;
    else
      if coalesce(jsonb_typeof(item->'fixedDays'),'null')<>'null' then raise exception 'Dias dos demais grupos ainda não estão definidos'; end if;
      days:=null;
    end if;
    select * into previous from public.benefit_meal_rate_versions where city=p_city and rate_group=item->>'group' and effective_month<=p_month order by effective_month desc,revision desc limit 1;
    if previous.id is distinct from nullif(item->>'expectedId','')::uuid then raise exception 'Os valores mudaram durante a edição. Recarregue antes de salvar'; end if;
    if previous.id is not null and previous.daily_value=amount and previous.fixed_days is not distinct from days then continue; end if;
    insert into public.benefit_meal_rate_versions(city,rate_group,effective_month,daily_value,fixed_days,created_by,created_by_name,note)
    values(p_city,item->>'group',p_month,amount,days,p_actor,actor_name,btrim(coalesce(p_note,''))) returning id into new_id;
    saved:=saved+1;
  end loop;
  return jsonb_build_object('saved',saved,'effectiveMonth',p_month);
end $$;
revoke all on function public.save_benefit_meal_rates(uuid,text,date,jsonb,text) from public,anon,authenticated;
grant execute on function public.save_benefit_meal_rates(uuid,text,date,jsonb,text) to service_role;

alter table public.benefit_meal_runs add column rate_version_ids uuid[];
alter table public.benefit_meal_rows add column rate_version_id uuid references public.benefit_meal_rate_versions(id) on delete restrict;
create index benefit_meal_rows_rate_version on public.benefit_meal_rows(rate_version_id);
alter table public.benefit_meal_rows drop constraint benefit_meal_calculation_shape,drop constraint benefit_meal_approved_rates,drop constraint benefit_meal_amount_consistency;
alter table public.benefit_meal_rows
  add constraint benefit_meal_calculation_shape check (
    (calculation_version is null and calculation_status is null and planned_work_days is null and payable_days is null and daily_value is null and amount_due is null and rate_version_id is null)
    or (calculation_version is not null and calculation_version in(1,2) and calculation_status is not null and calculation_status in('READY','PENDING'))
  ),
  add constraint benefit_meal_approved_rates check (calculation_version is null or calculation_version=2 or (
    daily_value is not distinct from case rate_group when 'TECNICO' then 25::numeric when 'GERAL' then 20::numeric when 'VENDAS' then 20::numeric when 'RECIFE_VENDAS' then 20::numeric when 'RECIFE_TECNICO' then 28.58::numeric when 'RECIFE_ESTOQUE_RH' then 23::numeric else null::numeric end
    and planned_work_days is not distinct from case when rate_group='RECIFE_ESTOQUE_RH' then 22::numeric else null::numeric end
  )),
  add constraint benefit_meal_amount_consistency check (calculation_version is null or calculation_version=2 or (
    (calculation_status='PENDING' and payable_days is null and amount_due is null)
    or (calculation_status='READY' and rate_group='RECIFE_ESTOQUE_RH' and employment_status='ATIVO'
      and absence_days is not null and medical_days is not null and overlap_days is not null and overlap_days=0 and deduction_days is not null
      and planned_work_days=22 and daily_value=23 and payable_days is not null and amount_due is not null
      and payable_days=greatest(0,planned_work_days-deduction_days) and amount_due=round(payable_days*daily_value,2)
      and jsonb_array_length(issues)=0 and jsonb_array_length(calculation_notes)=0)
  )),
  add constraint benefit_meal_v2_consistency check (calculation_version is distinct from 2 or coalesce((
    (rate_version_id is null and daily_value is null and planned_work_days is null and payable_days is null and amount_due is null and calculation_status='PENDING')
    or (rate_version_id is not null and daily_value is not null and daily_value>=0
      and (planned_work_days is null or planned_work_days between 1 and 31)
      and ((calculation_status='PENDING' and payable_days is null and amount_due is null)
        or (calculation_status='READY' and employment_status='ATIVO' and absence_days is not null and medical_days is not null and overlap_days=0 and deduction_days is not null
          and planned_work_days is not null and payable_days is not null and amount_due is not null
          and payable_days=greatest(0,planned_work_days-deduction_days) and amount_due=round(payable_days*daily_value,2)
          and jsonb_array_length(issues)=0 and jsonb_array_length(calculation_notes)=0)))
  ),false));

-- Old Edge deployments must not save hardcoded rates after editable rules exist.
create function public.reject_outdated_meal_calculation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.calculation_version=1 and (tg_op='INSERT' or old.calculation_version is distinct from 1 or
    (new.daily_value,new.planned_work_days,new.payable_days,new.amount_due) is distinct from (old.daily_value,old.planned_work_days,old.payable_days,old.amount_due))
    then raise exception 'Atualize a função sync-benefit-meal para usar os valores editáveis'; end if;
  return new;
end $$;
revoke all on function public.reject_outdated_meal_calculation() from public,anon,authenticated;
create trigger benefit_meal_reject_outdated before insert or update of calculation_version,daily_value,planned_work_days,payable_days,amount_due on public.benefit_meal_rows for each row execute function public.reject_outdated_meal_calculation();

create function public.complete_benefit_meal_versioned_run(p_run_id uuid,p_actor uuid,p_rows jsonb,p_events jsonb,p_coverage jsonb,p_warnings jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare target public.benefit_meal_runs; result uuid;
begin
  if not exists(select 1 from public.profiles where id=p_actor and status='ATIVO' and role in('RH','ADMINISTRADOR')) then raise exception 'Acesso negado'; end if;
  select * into target from public.benefit_meal_runs where id=p_run_id for update;
  if target.id is null or target.status<>'RUNNING' or target.triggered_by is distinct from p_actor or target.rate_version_ids is null then raise exception 'Atualização inválida ou já concluída'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Funcionários inválidos'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where x->>'calculation_version' is distinct from '2' or coalesce(x->>'calculation_status','') not in('READY','PENDING') or jsonb_typeof(x->'calculation_notes') is distinct from 'array') then raise exception 'Versão de cálculo inválida'; end if;
  if target.queried_through<target.period_end and exists(select 1 from jsonb_array_elements(p_rows) x where x->>'calculation_status'='READY') then raise exception 'Período aberto: valor final ainda não pode ser calculado'; end if;
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
comment on table public.benefit_meal_rate_versions is 'Histórico compartilhado de diárias por cidade/grupo e mês do benefício. Somente novas versões; nenhuma consulta anterior é recalculada.';
notify pgrst,'reload schema';
