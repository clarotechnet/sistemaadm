begin;

begin;

create table if not exists public.benefit_aggregation_base (
  id uuid primary key default gen_random_uuid(),
  source_label text not null default '',
  company text not null default '',
  city text not null default '',
  employee_name text not null,
  cpf text not null,
  bank text not null default '',
  base_value numeric(12,2) not null default 0 check (base_value >= 0),
  notes text not null default '',
  employee_id uuid references public.employees(id) on delete set null,
  source text not null default 'MANUAL' check (source in ('ARQUIVO','MANUAL')),
  active_override boolean,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benefit_aggregation_base_cpf_check check (cpf ~ '^[0-9]{11}$')
);

create unique index if not exists uq_benefit_aggregation_base_cpf on public.benefit_aggregation_base(cpf);
create index if not exists idx_benefit_aggregation_base_company_city on public.benefit_aggregation_base(company, city);
create index if not exists idx_benefit_aggregation_base_employee on public.benefit_aggregation_base(employee_id);

create table if not exists public.benefit_aggregation_events (
  id uuid primary key default gen_random_uuid(),
  competence date not null,
  aggregation_id uuid not null references public.benefit_aggregation_base(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  cpf text not null,
  event_type text not null check (event_type in ('FALTA','ATESTADO','FERIAS')),
  source text not null default 'QUARK',
  source_event_id text,
  start_date date not null,
  end_date date not null,
  days numeric(8,2) not null default 0 check (days >= 0),
  hours numeric(8,2) not null default 0 check (hours >= 0),
  description text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_benefit_aggregation_events_competence on public.benefit_aggregation_events(competence);
create index if not exists idx_benefit_aggregation_events_cpf on public.benefit_aggregation_events(cpf);
create index if not exists idx_benefit_aggregation_events_aggregation on public.benefit_aggregation_events(aggregation_id, competence);

create table if not exists public.benefit_aggregation_monthly (
  id uuid primary key default gen_random_uuid(),
  competence date not null,
  aggregation_id uuid not null references public.benefit_aggregation_base(id) on delete cascade,
  employee_id uuid references public.employees(id) on delete set null,
  cpf text not null,
  employee_name text not null,
  company text not null default '',
  city text not null default '',
  base_value numeric(12,2) not null default 0,
  employment_status text not null default 'NAO_LOCALIZADO' check (employment_status in ('ATIVO','DESLIGADO','NAO_LOCALIZADO')),
  admission_date date,
  termination_date date,
  absence_days numeric(8,2) not null default 0,
  medical_days numeric(8,2) not null default 0,
  vacation_days numeric(8,2) not null default 0,
  employment_days numeric(8,2) not null default 30,
  payable_days numeric(8,2) not null default 30,
  amount_due numeric(12,2) not null default 0,
  calculation_note text not null default '',
  synced_at timestamptz not null default now()
);

create unique index if not exists uq_benefit_aggregation_monthly_competence on public.benefit_aggregation_monthly(competence, aggregation_id);
create index if not exists idx_benefit_aggregation_monthly_cpf on public.benefit_aggregation_monthly(cpf);
create index if not exists idx_benefit_aggregation_monthly_competence on public.benefit_aggregation_monthly(competence);

create table if not exists public.benefit_aggregation_sync_runs (
  id uuid primary key default gen_random_uuid(),
  competence date not null,
  status text not null check (status in ('RUNNING','SUCCESS','ERROR')),
  triggered_by uuid not null references public.profiles(id) on delete restrict,
  triggered_by_name text not null,
  processed_count integer not null default 0,
  absence_events integer not null default 0,
  medical_events integer not null default 0,
  vacation_events integer not null default 0,
  warning_message text,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_benefit_aggregation_sync_runs_started on public.benefit_aggregation_sync_runs(started_at desc);

create or replace function public.set_benefit_aggregation_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.cpf := regexp_replace(coalesce(new.cpf,''), '[^0-9]', '', 'g');
  if length(new.cpf) <> 11 then raise exception 'CPF inválido'; end if;
  select e.id into new.employee_id from public.employees e where e.cpf = new.cpf limit 1;
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce((select auth.uid()), new.updated_by, old.updated_by, new.created_by);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_benefit_aggregation_audit_fields() from public, anon, authenticated;
drop trigger if exists benefit_aggregation_base_set_audit on public.benefit_aggregation_base;
create trigger benefit_aggregation_base_set_audit
before insert or update on public.benefit_aggregation_base
for each row execute function public.set_benefit_aggregation_audit_fields();

alter table public.benefit_aggregation_base enable row level security;
alter table public.benefit_aggregation_events enable row level security;
alter table public.benefit_aggregation_monthly enable row level security;
alter table public.benefit_aggregation_sync_runs enable row level security;

revoke all on public.benefit_aggregation_base from anon, authenticated;
revoke all on public.benefit_aggregation_events from anon, authenticated;
revoke all on public.benefit_aggregation_monthly from anon, authenticated;
revoke all on public.benefit_aggregation_sync_runs from anon, authenticated;
grant select, insert, update on public.benefit_aggregation_base to authenticated;
grant select on public.benefit_aggregation_events, public.benefit_aggregation_monthly, public.benefit_aggregation_sync_runs to authenticated;

drop policy if exists benefit_aggregation_base_select on public.benefit_aggregation_base;
create policy benefit_aggregation_base_select on public.benefit_aggregation_base for select to authenticated using ((select public.is_rh_or_admin()));
drop policy if exists benefit_aggregation_base_insert on public.benefit_aggregation_base;
create policy benefit_aggregation_base_insert on public.benefit_aggregation_base for insert to authenticated with check ((select public.is_rh_or_admin()));
drop policy if exists benefit_aggregation_base_update on public.benefit_aggregation_base;
create policy benefit_aggregation_base_update on public.benefit_aggregation_base for update to authenticated using ((select public.is_rh_or_admin())) with check ((select public.is_rh_or_admin()));

drop policy if exists benefit_aggregation_events_select on public.benefit_aggregation_events;
create policy benefit_aggregation_events_select on public.benefit_aggregation_events for select to authenticated using ((select public.is_rh_or_admin()));
drop policy if exists benefit_aggregation_monthly_select on public.benefit_aggregation_monthly;
create policy benefit_aggregation_monthly_select on public.benefit_aggregation_monthly for select to authenticated using ((select public.is_rh_or_admin()));
drop policy if exists benefit_aggregation_sync_runs_select on public.benefit_aggregation_sync_runs;
create policy benefit_aggregation_sync_runs_select on public.benefit_aggregation_sync_runs for select to authenticated using ((select public.is_rh_or_admin()));

create or replace function public.save_benefit_aggregation_month(
  p_actor uuid,
  p_competence date,
  p_events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  month_start date := date_trunc('month', p_competence)::date;
  month_end date := (date_trunc('month', p_competence) + interval '1 month - 1 day')::date;
  item jsonb;
  base_row public.benefit_aggregation_base;
  event_type_value text;
  cpf_value text;
  start_value date;
  end_value date;
  days_value numeric;
  hours_value numeric;
  inserted_events integer := 0;
  monthly_count integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' then raise exception 'Eventos inválidos'; end if;
  select * into actor from public.profiles where id = p_actor and status = 'ATIVO';
  if actor.id is null or actor.role not in ('ADMINISTRADOR','RH') then raise exception 'Acesso negado'; end if;
  update public.benefit_aggregation_base b
     set employee_id = e.id, updated_at = now()
    from public.employees e
   where b.employee_id is null and b.cpf = e.cpf;

  delete from public.benefit_aggregation_events where competence = month_start;
  delete from public.benefit_aggregation_monthly where competence = month_start;

  for item in select value from jsonb_array_elements(p_events)
  loop
    cpf_value := regexp_replace(coalesce(item->>'cpf',''), '[^0-9]', '', 'g');
    event_type_value := upper(btrim(coalesce(item->>'event_type','')));
    if length(cpf_value) <> 11 or event_type_value not in ('FALTA','ATESTADO','FERIAS') then continue; end if;

    select * into base_row
      from public.benefit_aggregation_base
     where cpf = cpf_value
     limit 1;
    if base_row.id is null then continue; end if;

    start_value := case when coalesce(item->>'start_date','') ~ '^\d{4}-\d{2}-\d{2}$'
                        then (item->>'start_date')::date else month_start end;
    end_value := case when coalesce(item->>'end_date','') ~ '^\d{4}-\d{2}-\d{2}$'
                      then (item->>'end_date')::date else start_value end;
    start_value := greatest(start_value, month_start);
    end_value := least(end_value, month_end);
    if end_value < start_value then continue; end if;

    days_value := greatest(
      0,
      coalesce(
        nullif(item->>'days','')::numeric,
        (end_value - start_value + 1)::numeric
      )
    );
    hours_value := greatest(0, coalesce(nullif(item->>'hours','')::numeric, 0));

    insert into public.benefit_aggregation_events(
      competence, aggregation_id, employee_id, cpf, event_type, source, source_event_id,
      start_date, end_date, days, hours, description
    ) values (
      month_start, base_row.id, base_row.employee_id, cpf_value, event_type_value, 'QUARK',
      nullif(btrim(item->>'source_event_id'),''),
      start_value, end_value, least(days_value, 30), hours_value, btrim(coalesce(item->>'description',''))
    );

    inserted_events := inserted_events + 1;
  end loop;

  with event_totals as (
    select aggregation_id,
      least(30::numeric, coalesce(sum(days) filter (where event_type='FALTA'),0)) as absence_days,
      least(30::numeric, coalesce(sum(days) filter (where event_type='ATESTADO'),0)) as medical_days,
      least(30::numeric, coalesce(sum(days) filter (where event_type='FERIAS'),0)) as vacation_days
    from public.benefit_aggregation_events
    where competence = month_start
    group by aggregation_id
  ),
  prepared as (
    select
      b.id as aggregation_id,
      b.employee_id,
      b.cpf,
      b.employee_name,
      b.company,
      b.city,
      b.base_value,
      e.status,
      e.admission_date,
      e.termination_date,
      coalesce(t.absence_days,0) as absence_days,
      coalesce(t.medical_days,0) as medical_days,
      coalesce(t.vacation_days,0) as vacation_days,
      case
        when e.admission_date is not null and e.admission_date > month_end then 0::numeric
        when e.termination_date is not null and e.termination_date < month_start then 0::numeric
        when b.employee_id is null then 30::numeric
        else greatest(
          0::numeric,
          30::numeric
          - case
              when e.admission_date between month_start and month_end
              then least(30, greatest(0, extract(day from e.admission_date)::integer - 1))
              else 0
            end
          - case
              when e.termination_date between month_start and month_end
              then greatest(0, 30 - least(30, extract(day from e.termination_date)::integer))
              else 0
            end
        )
      end as employment_days
    from public.benefit_aggregation_base b
    left join public.employees e on e.id = b.employee_id
    left join event_totals t on t.aggregation_id = b.id
  )
  insert into public.benefit_aggregation_monthly(
    competence, aggregation_id, employee_id, cpf, employee_name, company, city, base_value,
    employment_status, admission_date, termination_date, absence_days, medical_days, vacation_days,
    employment_days, payable_days, amount_due, calculation_note, synced_at
  )
  select
    month_start,
    aggregation_id,
    employee_id,
    cpf,
    employee_name,
    company,
    city,
    base_value,
    case when status in ('ATIVO','DESLIGADO') then status else 'NAO_LOCALIZADO' end,
    admission_date,
    termination_date,
    absence_days,
    medical_days,
    vacation_days,
    employment_days,
    greatest(
      0::numeric,
      employment_days
      - vacation_days
      - case when (absence_days + medical_days) > 3 then (absence_days + medical_days) else 0 end
    ),
    case
      when vacation_days > 0 or employment_days < 30 then
        round(
          round(base_value / 30::numeric, 2)
          * greatest(
              0::numeric,
              employment_days
              - vacation_days
              - case when (absence_days + medical_days) > 3 then (absence_days + medical_days) else 0 end
            ),
          2
        )
      when (absence_days + medical_days) > 3 then
        greatest(
          0::numeric,
          base_value - round(round(base_value / 30::numeric, 2) * (absence_days + medical_days), 2)
        )
      else base_value
    end,
    case
      when vacation_days > 0 or employment_days < 30
        then 'Proporcional por férias/admissão/desligamento; faltas + atestados só descontam quando somam mais de 3 dias.'
      when (absence_days + medical_days) > 3
        then 'Faltas + atestados ultrapassaram 3 dias; desconto aplicado sobre todos os dias acumulados usando o valor diário arredondado.'
      when (absence_days + medical_days) > 0
        then 'Faltas + atestados somam até 3 dias; sem desconto conforme a regra do benefício.'
      else 'Valor base integral.'
    end,
    now()
  from prepared;

  get diagnostics monthly_count = row_count;

  return jsonb_build_object(
    'events', inserted_events,
    'rows', monthly_count,
    'competence', to_char(month_start,'YYYY-MM')
  );
end;
$$;

revoke all on function public.save_benefit_aggregation_month(uuid,date,jsonb) from public, anon, authenticated;
grant execute on function public.save_benefit_aggregation_month(uuid,date,jsonb) to service_role;

comment on table public.benefit_aggregation_base is 'Base editável do benefício Agregamento, vinculada aos funcionários por CPF.';
comment on table public.benefit_aggregation_events is 'Ocorrências mensais de falta, atestado e férias obtidas do QuarkRH.';
comment on table public.benefit_aggregation_monthly is 'Fechamento mensal calculado do benefício Agregamento.';
comment on function public.save_benefit_aggregation_month(uuid,date,jsonb) is 'Substitui eventos Quark da competência e recalcula o valor a receber com divisor fixo de 30 dias.';

commit;
