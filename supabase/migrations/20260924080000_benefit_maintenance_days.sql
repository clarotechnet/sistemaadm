begin;

alter table public.benefit_aggregation_monthly
  add column if not exists maintenance_vehicle_days integer not null default 0
  check (maintenance_vehicle_days >= 0 and maintenance_vehicle_days <= 30);

create table if not exists public.benefit_aggregation_monthly_overrides (
  id uuid primary key default gen_random_uuid(),
  competence date not null,
  aggregation_id uuid not null references public.benefit_aggregation_base(id) on delete cascade,
  maintenance_vehicle_days integer not null default 0 check (maintenance_vehicle_days >= 0 and maintenance_vehicle_days <= 30),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (competence, aggregation_id)
);

alter table public.benefit_aggregation_monthly_overrides enable row level security;
revoke all on public.benefit_aggregation_monthly_overrides from anon, authenticated;
grant select on public.benefit_aggregation_monthly_overrides to authenticated;

drop policy if exists benefit_aggregation_monthly_overrides_select on public.benefit_aggregation_monthly_overrides;
create policy benefit_aggregation_monthly_overrides_select
on public.benefit_aggregation_monthly_overrides for select to authenticated
using ((select public.is_rh_or_admin()));

create or replace function public.recalculate_benefit_aggregation_monthly()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  override_days integer;
  total_occurrence_days numeric;
  discount_days numeric;
  daily_value numeric;
begin
  if tg_op = 'INSERT' then
    select o.maintenance_vehicle_days
      into override_days
      from public.benefit_aggregation_monthly_overrides o
     where o.competence = new.competence
       and o.aggregation_id = new.aggregation_id
     limit 1;
    new.maintenance_vehicle_days := coalesce(override_days, new.maintenance_vehicle_days, 0);
  end if;

  new.maintenance_vehicle_days := greatest(0, least(30, coalesce(new.maintenance_vehicle_days,0)));

  total_occurrence_days :=
      coalesce(new.absence_days,0)
    + coalesce(new.medical_days,0)
    + coalesce(new.vacation_days,0)
    + coalesce(new.maintenance_vehicle_days,0);

  discount_days := case when total_occurrence_days > 3 then total_occurrence_days else 0 end;
  new.payable_days := greatest(0::numeric, coalesce(new.employment_days,30) - discount_days);
  daily_value := round(coalesce(new.base_value,0) / 30::numeric, 2);

  if coalesce(new.employment_days,30) < 30 or discount_days > 0 then
    new.amount_due := round(daily_value * new.payable_days, 2);
  else
    new.amount_due := coalesce(new.base_value,0);
  end if;

  new.calculation_note := case
    when coalesce(new.employment_days,30) < 30 and total_occurrence_days > 3 then
      'Proporcional por admissão/desligamento; faltas + atestados + férias + manutenção de veículo ultrapassaram 3 dias e foram descontados integralmente.'
    when coalesce(new.employment_days,30) < 30 then
      'Proporcional por admissão/desligamento; ocorrências somam até 3 dias e não geram desconto.'
    when total_occurrence_days > 3 then
      'Faltas + atestados + férias + manutenção de veículo ultrapassaram 3 dias; desconto aplicado sobre todos os dias acumulados.'
    when total_occurrence_days > 0 then
      'Faltas + atestados + férias + manutenção de veículo somam até 3 dias; sem desconto conforme a regra do benefício.'
    else
      'Valor base integral.'
  end;

  return new;
end;
$$;

revoke all on function public.recalculate_benefit_aggregation_monthly() from public, anon, authenticated;

drop trigger if exists benefit_aggregation_monthly_recalculate on public.benefit_aggregation_monthly;
create trigger benefit_aggregation_monthly_recalculate
before insert or update of base_value, employment_days, absence_days, medical_days, vacation_days, maintenance_vehicle_days
on public.benefit_aggregation_monthly
for each row execute function public.recalculate_benefit_aggregation_monthly();

create or replace function public.set_benefit_aggregation_maintenance(
  p_competence date,
  p_aggregation_id uuid,
  p_days integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  normalized_competence date := date_trunc('month', p_competence)::date;
  affected integer := 0;
begin
  if p_days is null or p_days < 0 or p_days > 30 then
    raise exception 'Dias de manutenção devem estar entre 0 e 30';
  end if;

  select * into actor
    from public.profiles
   where id = (select auth.uid())
     and status = 'ATIVO';

  if actor.id is null or actor.role not in ('ADMINISTRADOR','RH') then
    raise exception 'Acesso negado';
  end if;

  if not exists (select 1 from public.benefit_aggregation_base b where b.id = p_aggregation_id) then
    raise exception 'Agregado não encontrado';
  end if;

  insert into public.benefit_aggregation_monthly_overrides(
    competence, aggregation_id, maintenance_vehicle_days, updated_by, updated_at
  ) values (
    normalized_competence, p_aggregation_id, p_days, actor.id, now()
  )
  on conflict (competence, aggregation_id)
  do update set
    maintenance_vehicle_days = excluded.maintenance_vehicle_days,
    updated_by = excluded.updated_by,
    updated_at = now();

  update public.benefit_aggregation_monthly
     set maintenance_vehicle_days = p_days
   where competence = normalized_competence
     and aggregation_id = p_aggregation_id;

  get diagnostics affected = row_count;

  return jsonb_build_object('ok',true,'rows',affected,'maintenanceVehicleDays',p_days);
end;
$$;

revoke all on function public.set_benefit_aggregation_maintenance(date,uuid,integer) from public, anon;
grant execute on function public.set_benefit_aggregation_maintenance(date,uuid,integer) to authenticated;

-- Recalcula competências existentes usando a nova regra. Até 3 dias combinados não descontam.
update public.benefit_aggregation_monthly
   set maintenance_vehicle_days = maintenance_vehicle_days;

comment on column public.benefit_aggregation_monthly.maintenance_vehicle_days
  is 'Dias informados manualmente de manutenção de veículo; entram na soma do limite de 3 dias.';
comment on table public.benefit_aggregation_monthly_overrides
  is 'Ajustes manuais mensais persistentes do Agregamento, preservados em novas sincronizações do QuarkRH.';
comment on function public.set_benefit_aggregation_maintenance(date,uuid,integer)
  is 'Salva manutenção de veículo mensal e recalcula o valor a receber. A soma de faltas, atestados, férias e manutenção só desconta quando ultrapassa 3 dias.';

commit;
