-- Additive, isolated Vale Alimentação snapshots. No payroll/aggregation updates.
create table public.benefit_meal_runs (
  id uuid primary key default gen_random_uuid(),
  period_start date not null, period_end date not null, benefit_month date not null,
  queried_through date not null,
  status text not null default 'RUNNING' check (status in ('RUNNING','SUCCESS','PARTIAL','ERROR')),
  triggered_by uuid references public.profiles(id) on delete set null,
  triggered_by_name text not null,
  started_at timestamptz not null default now(), completed_at timestamptz,
  employee_count integer not null default 0 check (employee_count >= 0),
  coverage jsonb not null default '[]'::jsonb check (jsonb_typeof(coverage)='array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings)='array'),
  error_message text,
  check (period_end >= period_start and period_end-period_start < 366),
  check (queried_through between period_start and period_end),
  check (benefit_month=(date_trunc('month',period_end)::date + interval '1 month')::date)
);
create index benefit_meal_runs_period on public.benefit_meal_runs(period_start,period_end,benefit_month,started_at desc);
create index benefit_meal_runs_actor on public.benefit_meal_runs(triggered_by);
create unique index benefit_meal_one_running on public.benefit_meal_runs(period_start,period_end,benefit_month) where status='RUNNING';

create table public.benefit_meal_rows (
  run_id uuid not null references public.benefit_meal_runs(id) on delete cascade,
  snapshot_employee_id uuid not null,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text not null, cpf text not null default '', department text not null, job_title text not null,
  company text not null, city text not null, employment_status text not null, rate_group text not null,
  absence_days integer check (absence_days between 0 and 366),
  medical_days integer check (medical_days between 0 and 366),
  overlap_days integer check (overlap_days between 0 and 366),
  deduction_days integer check (deduction_days between 0 and 366),
  planned_work_days numeric, payable_days numeric, daily_value numeric(14,2), amount_due numeric(14,2),
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues)='array'),
  primary key(run_id,snapshot_employee_id),
  -- Values and future workdays have not been supplied by RH. Missing is not zero.
  check (planned_work_days is null and payable_days is null and daily_value is null and amount_due is null),
  check (deduction_days is null or (overlap_days=0 and absence_days is not null and medical_days is not null and deduction_days=absence_days+medical_days))
);
create index benefit_meal_rows_employee on public.benefit_meal_rows(employee_id);

create table public.benefit_meal_events (
  id bigint generated always as identity primary key,
  run_id uuid not null, snapshot_employee_id uuid not null,
  event_type text not null check (event_type in ('FALTA','ATESTADO')),
  source_id text not null, start_date date not null, end_date date not null,
  hours numeric check (hours is null or hours>=0),
  foreign key(run_id,snapshot_employee_id) references public.benefit_meal_rows(run_id,snapshot_employee_id) on delete cascade,
  check (end_date>=start_date),
  unique(run_id,snapshot_employee_id,event_type,source_id,start_date,end_date)
);
create index benefit_meal_events_employee_date on public.benefit_meal_events(run_id,snapshot_employee_id,start_date);

alter table public.benefit_meal_runs enable row level security;
alter table public.benefit_meal_rows enable row level security;
alter table public.benefit_meal_events enable row level security;
create policy benefit_meal_runs_read on public.benefit_meal_runs for select to authenticated using ((select public.is_rh_or_admin()));
create policy benefit_meal_rows_read on public.benefit_meal_rows for select to authenticated using ((select public.is_rh_or_admin()));
create policy benefit_meal_events_read on public.benefit_meal_events for select to authenticated using ((select public.is_rh_or_admin()));
revoke all on public.benefit_meal_runs, public.benefit_meal_rows, public.benefit_meal_events from public, anon, authenticated;
grant select on public.benefit_meal_runs, public.benefit_meal_rows, public.benefit_meal_events to authenticated;
grant all on public.benefit_meal_runs, public.benefit_meal_rows, public.benefit_meal_events to service_role;
grant usage, select on sequence public.benefit_meal_events_id_seq to service_role;

create function public.complete_benefit_meal_run(p_run_id uuid,p_actor uuid,p_rows jsonb,p_events jsonb,p_coverage jsonb,p_warnings jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare target public.benefit_meal_runs; item jsonb; has_issues boolean;
begin
  if not exists(select 1 from public.profiles where id=p_actor and status='ATIVO' and role in ('ADMINISTRADOR','RH')) then raise exception 'Acesso negado'; end if;
  select * into target from public.benefit_meal_runs where id=p_run_id for update;
  if target.id is null or target.status<>'RUNNING' or target.triggered_by is distinct from p_actor then raise exception 'Atualização inválida ou já concluída'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)=0 or jsonb_array_length(p_rows)>50000 then raise exception 'Funcionários inválidos'; end if;
  if jsonb_typeof(p_events) is distinct from 'array' or jsonb_typeof(p_coverage) is distinct from 'array' or jsonb_typeof(p_warnings) is distinct from 'array' then raise exception 'Dados inválidos'; end if;
  for item in select value from jsonb_array_elements(p_rows) loop
    if not exists(select 1 from public.employees where id=(item->>'employee_id')::uuid) then raise exception 'Funcionário não encontrado'; end if;
    insert into public.benefit_meal_rows(run_id,snapshot_employee_id,employee_id,employee_name,cpf,department,job_title,company,city,employment_status,rate_group,absence_days,medical_days,overlap_days,deduction_days,issues)
    values(p_run_id,(item->>'employee_id')::uuid,(item->>'employee_id')::uuid,item->>'employee_name',coalesce(item->>'cpf',''),item->>'department',item->>'job_title',item->>'company',item->>'city',item->>'employment_status',item->>'rate_group',(item->>'absence_days')::integer,(item->>'medical_days')::integer,(item->>'overlap_days')::integer,(item->>'deduction_days')::integer,coalesce(item->'issues','[]'::jsonb));
  end loop;
  for item in select value from jsonb_array_elements(p_events) loop
    if (item->>'start_date')::date>target.queried_through or (item->>'end_date')::date<target.period_start then raise exception 'Ocorrência fora do período consultado'; end if;
    insert into public.benefit_meal_events(run_id,snapshot_employee_id,event_type,source_id,start_date,end_date,hours)
    values(p_run_id,(item->>'employee_id')::uuid,item->>'event_type',item->>'source_id',(item->>'start_date')::date,(item->>'end_date')::date,(item->>'hours')::numeric);
  end loop;
  select exists(select 1 from public.benefit_meal_rows where run_id=p_run_id and (absence_days is null or medical_days is null or jsonb_array_length(issues)>0)) into has_issues;
  update public.benefit_meal_runs set
    status=case when has_issues or target.queried_through<target.period_end or jsonb_array_length(p_warnings)>0 then 'PARTIAL' else 'SUCCESS' end,
    employee_count=jsonb_array_length(p_rows),coverage=p_coverage,warnings=p_warnings,completed_at=now()
  where id=p_run_id;
  return p_run_id;
end;
$$;
revoke all on function public.complete_benefit_meal_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.complete_benefit_meal_run(uuid,uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
comment on table public.benefit_meal_runs is 'Versões imutáveis de consultas de Vale Alimentação por período de ocorrências e mês futuro do benefício.';
comment on table public.benefit_meal_events is 'Somente IDs/datas/horas de faltas e atestados. Sem CID, diagnóstico ou documentos médicos.';
notify pgrst,'reload schema';
