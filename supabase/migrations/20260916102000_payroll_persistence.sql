alter table public.payroll_imports
  add column if not exists file_size bigint not null default 0,
  add column if not exists imported_by_name text not null default '',
  add column if not exists logs jsonb not null default '[]'::jsonb,
  add column if not exists is_active boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists uq_payroll_imports_competence
  on public.payroll_imports(competence);
create unique index if not exists uq_payroll_imports_single_active
  on public.payroll_imports(is_active) where is_active;

create table if not exists public.payroll_records (
  id uuid primary key default gen_random_uuid(),
  payroll_import_id uuid not null references public.payroll_imports(id) on delete cascade,
  cpf text not null,
  name text not null,
  liquid double precision not null default 0,
  health_total double precision not null default 0,
  dental_total double precision not null default 0,
  health_columns integer not null default 0,
  dental_columns integer not null default 0,
  source_sheet text not null default '',
  created_at timestamptz not null default now(),
  unique(payroll_import_id, cpf)
);

create index if not exists idx_payroll_records_import on public.payroll_records(payroll_import_id);
create index if not exists idx_payroll_records_cpf on public.payroll_records(cpf);
alter table public.payroll_records enable row level security;
revoke all on public.payroll_records from anon, authenticated;
grant select on public.payroll_records to authenticated;
revoke insert, update, delete on public.payroll_imports from authenticated;
grant select on public.payroll_imports to authenticated;

drop policy if exists payroll_select on public.payroll_imports;
drop policy if exists payroll_insert on public.payroll_imports;
drop policy if exists payroll_update on public.payroll_imports;
drop policy if exists payroll_delete on public.payroll_imports;
drop policy if exists payroll_records_select on public.payroll_records;

create policy payroll_select on public.payroll_imports for select to authenticated
using (public.is_rh_or_admin());
create policy payroll_records_select on public.payroll_records for select to authenticated
using (public.is_rh_or_admin());

create or replace function public.save_payroll_month(
  p_competence text,
  p_file_name text,
  p_file_size bigint,
  p_logs jsonb,
  p_records jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor public.profiles;
  payroll_id uuid;
  existed boolean;
  saved_count integer;
begin
  if not public.is_rh_or_admin() then
    raise exception 'Acesso negado';
  end if;
  if p_competence !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' then
    raise exception 'Competência inválida. Use MM/AAAA';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records)=0 then
    raise exception 'A folha não possui registros válidos';
  end if;
  if jsonb_array_length(p_records) > 50000 then
    raise exception 'Quantidade de registros acima do limite permitido';
  end if;

  select * into actor from public.profiles
  where id=(select auth.uid()) and status='ATIVO';
  if actor.id is null then raise exception 'Usuário ativo não encontrado'; end if;

  select exists(select 1 from public.payroll_imports where competence=p_competence)
    into existed;
  update public.payroll_imports set is_active=false
    where is_active=true and competence<>p_competence;

  insert into public.payroll_imports(
    user_id,file_name,competence,record_count,status,file_size,
    imported_by_name,logs,is_active,created_at,updated_at
  ) values (
    actor.id,p_file_name,p_competence,jsonb_array_length(p_records),'ATIVO',
    coalesce(p_file_size,0),actor.full_name,coalesce(p_logs,'[]'::jsonb),true,now(),now()
  ) on conflict (competence) do update set
    user_id=excluded.user_id,
    file_name=excluded.file_name,
    record_count=excluded.record_count,
    status='ATIVO',
    file_size=excluded.file_size,
    imported_by_name=excluded.imported_by_name,
    logs=excluded.logs,
    is_active=true,
    updated_at=now()
  returning id into payroll_id;

  delete from public.payroll_records
  where payroll_import_id=payroll_id;

  insert into public.payroll_records(
    payroll_import_id,cpf,name,liquid,health_total,dental_total,
    health_columns,dental_columns,source_sheet
  )
  select payroll_id,
    regexp_replace(coalesce(x.cpf,''),'[^0-9]','','g'),
    btrim(coalesce(x.name,'')),
    coalesce(x.liquid,0),coalesce(x.health_total,0),coalesce(x.dental_total,0),
    coalesce(x.health_columns,0),coalesce(x.dental_columns,0),coalesce(x.source_sheet,'')
  from jsonb_to_recordset(p_records) as x(
    cpf text,name text,liquid double precision,health_total double precision,
    dental_total double precision,health_columns integer,dental_columns integer,source_sheet text
  )
  where regexp_replace(coalesce(x.cpf,''),'[^0-9]','','g')<>''
    and btrim(coalesce(x.name,''))<>'';

  select count(*) into saved_count
  from public.payroll_records where payroll_import_id=payroll_id;
  update public.payroll_imports set record_count=saved_count,updated_at=now()
  where id=payroll_id;

  return jsonb_build_object('id',payroll_id,'updated',existed,'record_count',saved_count);
end;
$$;

create or replace function public.admin_delete_payroll_month(p_competence text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  removed_active boolean;
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  delete from public.payroll_imports
  where competence=p_competence
  returning is_active into removed_active;
  if not found then return false; end if;
  if coalesce(removed_active,false) then
    update public.payroll_imports set is_active=true
    where id=(select id from public.payroll_imports order by updated_at desc limit 1);
  end if;
  return true;
end;
$$;

revoke all on function public.save_payroll_month(text,text,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_payroll_month(text,text,bigint,jsonb,jsonb) to authenticated;
revoke all on function public.admin_delete_payroll_month(text) from public,anon,authenticated;
grant execute on function public.admin_delete_payroll_month(text) to authenticated;

comment on table public.payroll_records is 'Dados normalizados da folha, persistidos por competência para uso compartilhado entre RH e Administradores.';
comment on function public.save_payroll_month(text,text,bigint,jsonb,jsonb) is 'Cria a competência quando nova e substitui atomicamente os dados quando o mês já existe.';
