begin;

alter table public.employees
  add column if not exists source text not null default 'MANUAL',
  add column if not exists external_id text,
  add column if not exists external_unit_id text,
  add column if not exists external_unit_name text not null default '',
  add column if not exists external_team_id text,
  add column if not exists external_team_name text not null default '',
  add column if not exists admission_date date,
  add column if not exists termination_date date,
  add column if not exists last_synced_at timestamptz;

alter table public.employees drop constraint if exists employees_source_check;
alter table public.employees add constraint employees_source_check check (source in ('MANUAL','QUARK'));

create unique index if not exists uq_employees_quark_external_id
  on public.employees(external_id)
  where source = 'QUARK' and external_id is not null;
create index if not exists idx_employees_source on public.employees(source);
create index if not exists idx_employees_external_unit on public.employees(external_unit_id) where source = 'QUARK';
create index if not exists idx_employees_last_synced on public.employees(last_synced_at desc) where source = 'QUARK';
create table if not exists public.employee_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'QUARK' check (source in ('QUARK')),
  status text not null check (status in ('RUNNING','SUCCESS','ERROR')),
  triggered_by uuid not null references public.profiles(id) on delete restrict,
  triggered_by_name text not null,
  units_count integer not null default 0,
  received_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  linked_count integer not null default 0,
  skipped_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_employee_sync_runs_started on public.employee_sync_runs(started_at desc);
alter table public.employee_sync_runs enable row level security;
revoke all on public.employee_sync_runs from anon, authenticated;
grant select on public.employee_sync_runs to authenticated;
drop policy if exists employee_sync_runs_select on public.employee_sync_runs;
create policy employee_sync_runs_select on public.employee_sync_runs for select to authenticated
  using ((select public.is_active_user()));
create or replace function public.set_employee_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    if new.created_by is null then raise exception 'Usuário responsável não informado'; end if;
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

revoke all on function public.set_employee_audit_fields() from public, anon, authenticated;

drop trigger if exists employees_set_audit_fields on public.employees;
create trigger employees_set_audit_fields
before insert or update on public.employees
for each row execute function public.set_employee_audit_fields();
create or replace function public.sync_quark_employees(p_actor uuid, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor public.profiles;
  item jsonb;
  target public.employees;
  external_id_value text;
  cpf_value text;
  name_value text;
  registration_value text;
  department_value text;
  job_title_value text;
  status_value text;
  admission_value date;
  termination_value date;
  created_count integer := 0;
  updated_count integer := 0;
  linked_count integer := 0;
  skipped_count integer := 0;
begin
  if jsonb_typeof(p_records) <> 'array' then raise exception 'Registros do Quark inválidos'; end if;
  select * into actor from public.profiles where id = p_actor and status = 'ATIVO';
  if actor.id is null or actor.role not in ('ADMINISTRADOR','RH') then raise exception 'Acesso negado'; end if;
  for item in select value from jsonb_array_elements(p_records)
  loop
    external_id_value := nullif(btrim(item->>'external_id'), '');
    cpf_value := regexp_replace(coalesce(item->>'cpf',''), '[^0-9]', '', 'g');
    name_value := btrim(coalesce(item->>'name',''));
    registration_value := btrim(coalesce(item->>'registration',''));
    department_value := btrim(coalesce(item->>'department',''));
    job_title_value := btrim(coalesce(item->>'job_title',''));
    status_value := case when upper(coalesce(item->>'status','ATIVO')) = 'DESLIGADO' then 'DESLIGADO' else 'ATIVO' end;
    admission_value := case when coalesce(item->>'admission_date','') ~ '^\d{4}-\d{2}-\d{2}$' then (item->>'admission_date')::date else null end;
    termination_value := case when coalesce(item->>'termination_date','') ~ '^\d{4}-\d{2}-\d{2}$' then (item->>'termination_date')::date else null end;

    if external_id_value is null or length(cpf_value) <> 11 or char_length(name_value) < 2 then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    target := null;
    select * into target from public.employees
      where source = 'QUARK' and external_id = external_id_value
      limit 1 for update;
    if target.id is null then
      select * into target from public.employees where cpf = cpf_value limit 1 for update;
    end if;
    begin
      if target.id is not null then
        if target.source <> 'QUARK' or target.external_id is null then linked_count := linked_count + 1;
        else updated_count := updated_count + 1;
        end if;

        update public.employees set
          source = 'QUARK',
          external_id = external_id_value,
          external_unit_id = nullif(btrim(item->>'external_unit_id'), ''),
          external_unit_name = btrim(coalesce(item->>'external_unit_name','')),
          external_team_id = nullif(btrim(item->>'external_team_id'), ''),
          external_team_name = btrim(coalesce(item->>'external_team_name','')),
          full_name = name_value,
          cpf = cpf_value,
          registration = case when registration_value <> '' then registration_value else registration end,
          department = case when department_value <> '' then department_value else department end,
          job_title = case when job_title_value <> '' then job_title_value else job_title end,
          status = status_value,
          admission_date = coalesce(admission_value, admission_date),
          termination_date = termination_value,
          last_synced_at = now(),
          updated_by = p_actor
        where id = target.id;
      else
        insert into public.employees(
          full_name, cpf, registration, department, job_title, status,
          source, external_id, external_unit_id, external_unit_name,
          external_team_id, external_team_name, admission_date, termination_date,
          last_synced_at, created_by, updated_by
        ) values (
          name_value, cpf_value, registration_value, department_value, job_title_value, status_value,
          'QUARK', external_id_value, nullif(btrim(item->>'external_unit_id'), ''), btrim(coalesce(item->>'external_unit_name','')),
          nullif(btrim(item->>'external_team_id'), ''), btrim(coalesce(item->>'external_team_name','')), admission_value, termination_value,
          now(), p_actor, p_actor
        );
        created_count := created_count + 1;
      end if;
    exception when unique_violation then
      skipped_count := skipped_count + 1;
    end;
  end loop;

  return jsonb_build_object(
    'created', created_count,
    'updated', updated_count,
    'linked', linked_count,
    'skipped', skipped_count,
    'total', jsonb_array_length(p_records)
  );
end;
$$;

revoke all on function public.sync_quark_employees(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.sync_quark_employees(uuid,jsonb) to service_role;

comment on table public.employee_sync_runs is 'Histórico de sincronizações de funcionários com fontes externas como QuarkRH.';
comment on function public.sync_quark_employees(uuid,jsonb) is 'Upsert server-side de colaboradores Quark por external_id, com fallback seguro por CPF.';

commit;
