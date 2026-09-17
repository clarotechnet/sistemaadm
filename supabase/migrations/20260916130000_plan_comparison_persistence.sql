create table if not exists public.payroll_comparisons (
  id uuid primary key default gen_random_uuid(),
  payroll_import_id uuid not null references public.payroll_imports(id) on delete cascade,
  kind text not null check (kind in ('health','dental')),
  reference_file_name text not null,
  reference_file_size bigint not null default 0,
  tolerance double precision not null default 0.01,
  processed_by uuid not null references public.profiles(id) on delete restrict,
  processed_by_name text not null,
  total_count integer not null default 0,
  ok_count integer not null default 0,
  divergent_count integer not null default 0,
  missing_count integer not null default 0,
  difference_total double precision not null default 0,
  processed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payroll_import_id,kind)
);

create table if not exists public.payroll_comparison_rows (
  id uuid primary key default gen_random_uuid(),
  comparison_id uuid not null references public.payroll_comparisons(id) on delete cascade,
  cpf text not null,
  name text not null,
  payroll_value double precision,
  reference_value double precision,
  difference double precision,
  liquid double precision,
  column_count integer not null default 0,
  status text not null,
  unique(comparison_id,cpf)
);

create index if not exists idx_payroll_comparisons_import_kind
  on public.payroll_comparisons(payroll_import_id,kind);
create index if not exists idx_payroll_comparison_rows_comparison
  on public.payroll_comparison_rows(comparison_id);
create index if not exists idx_payroll_comparison_rows_cpf
  on public.payroll_comparison_rows(cpf);

alter table public.payroll_comparisons enable row level security;
alter table public.payroll_comparison_rows enable row level security;
revoke all on public.payroll_comparisons, public.payroll_comparison_rows from anon, authenticated;
grant select on public.payroll_comparisons, public.payroll_comparison_rows to authenticated;

drop policy if exists payroll_comparisons_select on public.payroll_comparisons;
drop policy if exists payroll_comparison_rows_select on public.payroll_comparison_rows;
create policy payroll_comparisons_select on public.payroll_comparisons
for select to authenticated using (public.is_rh_or_admin());
create policy payroll_comparison_rows_select on public.payroll_comparison_rows
for select to authenticated using (public.is_rh_or_admin());

drop index if exists public.uq_payroll_imports_single_active;
update public.payroll_imports set is_active=false where is_active=true;

create or replace function public.save_payroll_comparison(
  p_payroll_import_id uuid,
  p_kind text,
  p_reference_file_name text,
  p_reference_file_size bigint,
  p_tolerance double precision,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  actor public.profiles;
  v_comparison_id uuid;
  total_count integer;
  ok_count integer;
  divergent_count integer;
  missing_count integer;
  difference_total double precision;
begin
  if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  if p_kind not in ('health','dental') then raise exception 'Tipo de comparativo inválido'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Linhas inválidas'; end if;

  select * into actor from public.profiles
  where id=(select auth.uid()) and status='ATIVO';
  if actor.id is null then raise exception 'Usuário ativo não encontrado'; end if;

  if not exists(select 1 from public.payroll_imports where id=p_payroll_import_id) then
    raise exception 'Competência da folha não encontrada';
  end if;

  total_count=jsonb_array_length(p_rows);
  select count(*) filter(where x.status='OK'),
         count(*) filter(where x.status='DIVERGENTE'),
         count(*) filter(where x.status like 'NÃO LOCALIZADO%'),
         coalesce(sum(x.difference),0)
    into ok_count,divergent_count,missing_count,difference_total
  from jsonb_to_recordset(p_rows) as x(status text,difference double precision);

  insert into public.payroll_comparisons(
    payroll_import_id,kind,reference_file_name,reference_file_size,tolerance,
    processed_by,processed_by_name,total_count,ok_count,divergent_count,
    missing_count,difference_total,processed_at,updated_at
  ) values (
    p_payroll_import_id,p_kind,p_reference_file_name,coalesce(p_reference_file_size,0),
    coalesce(p_tolerance,0.01),actor.id,actor.full_name,total_count,ok_count,
    divergent_count,missing_count,difference_total,now(),now()
  ) on conflict(payroll_import_id,kind) do update set
    reference_file_name=excluded.reference_file_name,
    reference_file_size=excluded.reference_file_size,
    tolerance=excluded.tolerance,
    processed_by=excluded.processed_by,
    processed_by_name=excluded.processed_by_name,
    total_count=excluded.total_count,
    ok_count=excluded.ok_count,
    divergent_count=excluded.divergent_count,
    missing_count=excluded.missing_count,
    difference_total=excluded.difference_total,
    processed_at=now(),updated_at=now()
  returning id into v_comparison_id;

  delete from public.payroll_comparison_rows where comparison_id=v_comparison_id;

  insert into public.payroll_comparison_rows(
    comparison_id,cpf,name,payroll_value,reference_value,difference,liquid,column_count,status
  )
  select v_comparison_id,
    regexp_replace(coalesce(x.cpf,''),'[^0-9]','','g'),
    btrim(coalesce(x.name,'')),x.payroll_value,x.reference_value,x.difference,x.liquid,
    coalesce(x.column_count,0),x.status
  from jsonb_to_recordset(p_rows) as x(
    cpf text,name text,payroll_value double precision,reference_value double precision,
    difference double precision,liquid double precision,column_count integer,status text
  )
  where regexp_replace(coalesce(x.cpf,''),'[^0-9]','','g')<>'';

  return jsonb_build_object('id',v_comparison_id,'total',total_count);
end;
$$;

revoke all on function public.save_payroll_comparison(uuid,text,text,bigint,double precision,jsonb)
from public,anon,authenticated;
grant execute on function public.save_payroll_comparison(uuid,text,text,bigint,double precision,jsonb)
to authenticated;

create or replace function public.admin_delete_payroll_month(p_competence text)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  delete from public.payroll_imports where competence=p_competence;
  return found;
end;
$$;

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
  if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  if p_competence !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' then
    raise exception 'Competência inválida. Use MM/AAAA';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records)=0 then
    raise exception 'A folha não possui registros válidos';
  end if;
  if jsonb_array_length(p_records)>50000 then
    raise exception 'Quantidade de registros acima do limite permitido';
  end if;

  select * into actor from public.profiles
  where id=(select auth.uid()) and status='ATIVO';
  if actor.id is null then raise exception 'Usuário ativo não encontrado'; end if;
  select exists(select 1 from public.payroll_imports where competence=p_competence)
    into existed;

  insert into public.payroll_imports(
    user_id,file_name,competence,record_count,status,file_size,
    imported_by_name,logs,is_active,created_at,updated_at
  ) values (
    actor.id,p_file_name,p_competence,jsonb_array_length(p_records),'ATIVO',
    coalesce(p_file_size,0),actor.full_name,coalesce(p_logs,'[]'::jsonb),false,now(),now()
  ) on conflict (competence) do update set
    user_id=excluded.user_id,
    file_name=excluded.file_name,
    record_count=excluded.record_count,
    status='ATIVO',
    file_size=excluded.file_size,
    imported_by_name=excluded.imported_by_name,
    logs=excluded.logs,
    is_active=false,
    updated_at=now()
  returning id into payroll_id;

  delete from public.payroll_comparisons where payroll_import_id=payroll_id;
  delete from public.payroll_records where payroll_import_id=payroll_id;

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

revoke all on function public.save_payroll_month(text,text,bigint,jsonb,jsonb)
from public,anon,authenticated;
grant execute on function public.save_payroll_month(text,text,bigint,jsonb,jsonb)
to authenticated;

comment on table public.payroll_comparisons is
  'Comparativos persistidos de saúde/odonto vinculados à competência da folha.';
comment on table public.payroll_comparison_rows is
  'Linhas detalhadas dos comparativos persistidos por CPF.';