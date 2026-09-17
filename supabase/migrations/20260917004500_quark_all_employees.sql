begin;
alter table public.employees add column if not exists document_number text not null default '';
alter table public.employees drop constraint if exists employees_cpf_key;
alter table public.employees drop constraint if exists employees_cpf_check;
alter table public.employees alter column cpf set default '';
alter table public.employees add constraint employees_cpf_check check (cpf = '' or cpf ~ '^[0-9]{11}$');
create unique index if not exists uq_employees_cpf_present on public.employees(cpf) where cpf <> '';
drop index if exists public.uq_employees_quark_external_id;
create unique index if not exists uq_employees_quark_unit_external_id on public.employees(external_unit_id, external_id) where source = 'QUARK' and external_unit_id is not null and external_id is not null;
commit;

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
  external_unit_id_value text;
  document_value text;
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
    external_unit_id_value := nullif(btrim(item->>'external_unit_id'), '');
    document_value := regexp_replace(coalesce(nullif(item->>'document_number',''), item->>'cpf', ''), '[^0-9]', '', 'g');
    cpf_value := case when length(document_value) = 11 then document_value else '' end;
    name_value := btrim(coalesce(item->>'name',''));
    registration_value := btrim(coalesce(item->>'registration',''));
    department_value := btrim(coalesce(item->>'department',''));
    job_title_value := btrim(coalesce(item->>'job_title',''));
    status_value := case when upper(coalesce(item->>'status','ATIVO')) = 'DESLIGADO' then 'DESLIGADO' else 'ATIVO' end;
    admission_value := case when coalesce(item->>'admission_date','') ~ '^\d{4}-\d{2}-\d{2}$' then (item->>'admission_date')::date else null end;
    termination_value := case when coalesce(item->>'termination_date','') ~ '^\d{4}-\d{2}-\d{2}$' then (item->>'termination_date')::date else null end;

    if external_id_value is null or external_unit_id_value is null or char_length(name_value) < 2 then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    target := null;
    if cpf_value <> '' then
      select * into target from public.employees where cpf = cpf_value limit 1 for update;
    end if;
    if target.id is null then
      select * into target from public.employees
        where source = 'QUARK'
          and external_unit_id = external_unit_id_value
          and external_id = external_id_value
        limit 1 for update;
    end if;

    begin
      if target.id is not null then
        if target.source <> 'QUARK' or target.external_id is null then
          linked_count := linked_count + 1;
        else
          updated_count := updated_count + 1;
        end if;

        update public.employees set
          source = 'QUARK',
          external_id = external_id_value,
          external_unit_id = external_unit_id_value,
          external_unit_name = btrim(coalesce(item->>'external_unit_name','')),
          external_team_id = nullif(btrim(item->>'external_team_id'), ''),
          external_team_name = btrim(coalesce(item->>'external_team_name','')),
          document_number = case when document_value <> '' then document_value else document_number end,
          full_name = name_value,
          cpf = case when cpf_value <> '' then cpf_value else cpf end,
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
          full_name, cpf, document_number, registration, department, job_title, status,
          source, external_id, external_unit_id, external_unit_name,
          external_team_id, external_team_name, admission_date, termination_date,
          last_synced_at, created_by, updated_by
        ) values (
          name_value, cpf_value, document_value, registration_value, department_value, job_title_value, status_value,
          'QUARK', external_id_value, external_unit_id_value, btrim(coalesce(item->>'external_unit_name','')),
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

comment on function public.sync_quark_employees(uuid,jsonb) is 'Upsert Quark: CPF quando disponível, fallback por unidade + external_id, sem descartar colaboradores sem CPF.';

commit;
