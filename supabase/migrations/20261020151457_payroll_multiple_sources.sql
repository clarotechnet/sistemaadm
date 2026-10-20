-- Keep the unique month anchor and its comparison/review foreign keys intact.
-- Split only the source files, preserving every existing row during backfill.
create schema if not exists payroll_private;
revoke all on schema payroll_private from public, anon;
grant usage on schema payroll_private to authenticated;

create table public.payroll_sources (
  id uuid primary key default gen_random_uuid(),
  payroll_import_id uuid not null references public.payroll_imports(id) on delete cascade,
  label text not null check (length(btrim(label)) between 1 and 120),
  file_name text not null check (length(file_name) between 1 and 255),
  file_size bigint not null default 0 check (file_size >= 0),
  file_hash text check (file_hash ~ '^[a-f0-9]{64}$'),
  record_count integer not null default 0 check (record_count >= 0),
  imported_by_name text not null,
  logs jsonb not null default '[]'::jsonb check (jsonb_typeof(logs) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id, payroll_import_id)
);
create unique index payroll_sources_label_unique on public.payroll_sources
  (payroll_import_id, lower(regexp_replace(btrim(label), '\s+', ' ', 'g')));
create unique index payroll_sources_file_hash_unique on public.payroll_sources
  (payroll_import_id, file_hash) where file_hash is not null;
alter table public.payroll_sources enable row level security;
revoke all on public.payroll_sources from public, anon, authenticated;
grant select on public.payroll_sources to authenticated;
create policy payroll_sources_read on public.payroll_sources for select to authenticated
  using (public.is_rh_or_admin());

insert into public.payroll_sources (payroll_import_id,label,file_name,file_size,record_count,imported_by_name,logs,created_at,updated_at)
select id, coalesce(nullif(left(regexp_replace(file_name, '\.(xls|xlsx)$', '', 'i'),120),''),'Folha anterior'),
  file_name,file_size,record_count,imported_by_name,logs,created_at,updated_at
from public.payroll_imports;
alter table public.payroll_records add column source_id uuid;
update public.payroll_records r set source_id=s.id
from public.payroll_sources s where s.payroll_import_id=r.payroll_import_id;
alter table public.payroll_records alter column source_id set not null;
alter table public.payroll_records drop constraint payroll_records_payroll_import_id_cpf_key;
alter table public.payroll_records add constraint payroll_records_source_cpf_unique unique(source_id,cpf);
alter table public.payroll_records add constraint payroll_records_source_month_fk
  foreign key(source_id,payroll_import_id) references public.payroll_sources(id,payroll_import_id) on delete cascade;

-- Owner-only helper; never exposed as a Data API function.
create function payroll_private.refresh_month(p_month uuid, p_actor text) returns void
language plpgsql security invoker set search_path='' as $$
declare source_count integer; names text; one_file text; bytes bigint; total integer; details jsonb;
begin
  select count(*),string_agg(label,', ' order by label),min(file_name),sum(file_size)
    into source_count,names,one_file,bytes from public.payroll_sources where payroll_import_id=p_month;
  select count(distinct cpf) into total from public.payroll_records where payroll_import_id=p_month;
  select coalesce(jsonb_agg(to_jsonb(s.label || ': ' || item.value) order by s.label,item.position),'[]'::jsonb)
    into details from public.payroll_sources s
    cross join lateral jsonb_array_elements_text(s.logs) with ordinality item(value,position)
    where s.payroll_import_id=p_month;
  update public.payroll_imports set file_name=case when source_count=1 then one_file else source_count || ' folhas: ' || names end,
    file_size=coalesce(bytes,0),record_count=total,imported_by_name=p_actor,updated_at=clock_timestamp(),
    logs=jsonb_build_array(source_count || ' folha(s) consolidadas; ' || total || ' CPF(s) únicos. Os valores de CPFs presentes em mais de uma folha são somados e suas origens são preservadas.') || details
    where id=p_month;
  delete from public.payroll_comparisons where payroll_import_id=p_month;
end;
$$;
revoke all on function payroll_private.refresh_month(uuid,text) from public,anon,authenticated;

-- Privileged writes are intentionally confined to a non-exposed schema. Tables
-- remain read-only to clients; every entry point checks the active RH/admin.
create function payroll_private.save_sources(p_competence text,p_sources jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor public.profiles; month_id uuid; v_source_id uuid; source jsonb; records jsonb;
  label_value text; hash_value text; target public.payroll_sources; updated_count integer:=0;
  added_count integer:=0; seen uuid[]:='{}'; saved integer; result_ids uuid[]:='{}';
begin
  if auth.uid() is null or not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='ATIVO';
  if actor.id is null then raise exception 'Usuário ativo não encontrado'; end if;
  if p_competence is null or p_competence !~ '^(0[1-9]|1[0-2])/[0-9]{4}$' then raise exception 'Competência inválida. Use MM/AAAA'; end if;
  if jsonb_typeof(p_sources) is distinct from 'array' then raise exception 'Selecione as folhas a importar'; end if;
  if jsonb_array_length(p_sources) not between 1 and 20 or pg_column_size(p_sources)>52428800 then raise exception 'Importe entre 1 e 20 folhas, respeitando o limite de processamento'; end if;
  -- Serialize only writes to this month. Different months do not block each other.
  perform pg_advisory_xact_lock(hashtextextended('payroll:' || p_competence,0));
  insert into public.payroll_imports(user_id,file_name,competence,record_count,status,file_size,imported_by_name,logs,is_active)
    values(actor.id,'Folhas em importação',p_competence,0,'ATIVO',0,actor.full_name,'[]',false)
    on conflict(competence) do nothing;
  select id into month_id from public.payroll_imports where competence=p_competence for update;
  for source in select value from jsonb_array_elements(p_sources) loop
    v_source_id:=nullif(source->>'source_id','')::uuid;
    label_value:=regexp_replace(btrim(coalesce(source->>'label','')),'\s+',' ','g');
    hash_value:=source->>'file_hash'; records:=source->'records';
    if length(label_value) not between 1 and 120 then raise exception 'Informe uma identificação para cada folha (empresa/unidade)'; end if;
    if length(coalesce(source->>'file_name','')) not between 1 and 255 or coalesce((source->>'file_size')::bigint,0) not between 1 and 52428800 then raise exception 'Arquivo inválido ou acima de 50 MB'; end if;
    if hash_value is null or hash_value !~ '^[a-f0-9]{64}$' then raise exception 'A identificação digital do arquivo é inválida'; end if;
    if jsonb_typeof(records) is distinct from 'array' then raise exception 'A folha não possui registros válidos'; end if;
    if jsonb_array_length(records) not between 1 and 50000 then raise exception 'A folha não possui registros válidos ou excede 50.000 registros'; end if;
    if jsonb_typeof(source->'logs') is distinct from 'array' then raise exception 'Diagnóstico da folha inválido'; end if;
    if exists(select 1 from jsonb_to_recordset(records) x(cpf text,name text,liquid numeric,health_total numeric,dental_total numeric)
      where coalesce(x.cpf,'') !~ '^[0-9]{11}$' or btrim(coalesce(x.name,''))='' or x.liquid is null or x.health_total is null or x.dental_total is null
        or abs(x.liquid)>1000000000000 or abs(x.health_total)>1000000000000 or abs(x.dental_total)>1000000000000
        or x.liquid::text in ('NaN','Infinity','-Infinity') or x.health_total::text in ('NaN','Infinity','-Infinity') or x.dental_total::text in ('NaN','Infinity','-Infinity')) then raise exception 'A folha contém CPF, nome ou valor financeiro inválido'; end if;
    if v_source_id is not null then
      if v_source_id=any(seen) then raise exception 'A mesma folha foi selecionada duas vezes para atualização'; end if;
      seen:=array_append(seen,v_source_id);
      select * into target from public.payroll_sources where id=v_source_id and payroll_import_id=month_id;
      if target.id is null then raise exception 'A folha escolhida para atualização não pertence a esta competência'; end if;
      if (source->>'expected_updated_at')::timestamptz is distinct from target.updated_at then raise exception 'Esta folha foi alterada por outra pessoa. Recarregue antes de atualizar'; end if;
    end if;
    if exists(select 1 from public.payroll_sources s where s.payroll_import_id=month_id and s.id is distinct from v_source_id and lower(regexp_replace(btrim(s.label),'\s+',' ','g'))=lower(label_value)) then raise exception 'Já existe uma folha com esta identificação: %. Escolha Atualizar a folha existente',label_value; end if;
    if exists(select 1 from public.payroll_sources s where s.payroll_import_id=month_id and s.id is distinct from v_source_id and s.file_hash=hash_value) then raise exception 'Este arquivo já foi importado nesta competência. Não será somado novamente'; end if;
    if v_source_id is null then
      insert into public.payroll_sources(payroll_import_id,label,file_name,file_size,file_hash,record_count,imported_by_name,logs)
        values(month_id,label_value,source->>'file_name',(source->>'file_size')::bigint,hash_value,jsonb_array_length(records),actor.full_name,source->'logs') returning id into v_source_id;
      added_count:=added_count+1;
    else
      update public.payroll_sources set label=label_value,file_name=source->>'file_name',file_size=(source->>'file_size')::bigint,
        file_hash=hash_value,record_count=jsonb_array_length(records),imported_by_name=actor.full_name,logs=source->'logs',updated_at=clock_timestamp() where id=v_source_id;
      delete from public.payroll_records r where r.source_id=v_source_id;
      updated_count:=updated_count+1;
    end if;
    insert into public.payroll_records(payroll_import_id,source_id,cpf,name,liquid,health_total,dental_total,health_columns,dental_columns,source_sheet,audit_data)
      select month_id,v_source_id,x.cpf,btrim(x.name),x.liquid,x.health_total,x.dental_total,coalesce(x.health_columns,0),coalesce(x.dental_columns,0),coalesce(x.source_sheet,''),x.audit_data
      from jsonb_to_recordset(records) x(cpf text,name text,liquid double precision,health_total double precision,dental_total double precision,health_columns integer,dental_columns integer,source_sheet text,audit_data jsonb);
    result_ids:=array_append(result_ids,v_source_id);
  end loop;
  if (select count(*) from public.payroll_records where payroll_import_id=month_id)>50000 then raise exception 'A competência excede 50.000 registros de origem'; end if;
  if (select count(*) from public.payroll_sources where payroll_import_id=month_id)>100 then raise exception 'A competência excede 100 folhas'; end if;
  perform payroll_private.refresh_month(month_id,actor.full_name);
  select record_count into saved from public.payroll_imports where id=month_id;
  return jsonb_build_object('id',month_id,'added',added_count,'updated',updated_count,'record_count',saved,'source_ids',to_jsonb(result_ids));
end;
$$;
revoke all on function payroll_private.save_sources(text,jsonb) from public,anon,authenticated;
grant execute on function payroll_private.save_sources(text,jsonb) to authenticated;
create function public.save_payroll_sources(p_competence text,p_sources jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select payroll_private.save_sources(p_competence,p_sources) $$;
revoke all on function public.save_payroll_sources(text,jsonb) from public,anon,authenticated;
grant execute on function public.save_payroll_sources(text,jsonb) to authenticated;

-- Cached/old clients must fail closed rather than delete an entire month.
create or replace function public.save_payroll_month(p_competence text,p_file_name text,p_file_size bigint,p_logs jsonb,p_records jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Importador antigo desativado para proteger as demais folhas. Atualize a página e importe por arquivo'; end;
$$;

create function payroll_private.delete_source(p_source_id uuid,p_expected_updated_at timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare month_id uuid; month_value text; actor text; target public.payroll_sources;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Acesso negado'; end if;
  select full_name into actor from public.profiles where id=auth.uid() and status='ATIVO';
  if actor is null then raise exception 'Usuário ativo não encontrado'; end if;
  select s.payroll_import_id,m.competence into month_id,month_value from public.payroll_sources s join public.payroll_imports m on m.id=s.payroll_import_id where s.id=p_source_id;
  if month_id is null then raise exception 'Folha não encontrada. Recarregue a competência'; end if;
  perform pg_advisory_xact_lock(hashtextextended('payroll:' || month_value,0));
  perform 1 from public.payroll_imports where id=month_id for update;
  select * into target from public.payroll_sources where id=p_source_id;
  if target.id is null or target.updated_at is distinct from p_expected_updated_at then raise exception 'A folha foi alterada. Recarregue antes de remover'; end if;
  delete from public.payroll_sources where id=p_source_id;
  if exists(select 1 from public.payroll_sources where payroll_import_id=month_id) then
    perform payroll_private.refresh_month(month_id,actor);
  else delete from public.payroll_imports where id=month_id; end if;
  return true;
end;
$$;
revoke all on function payroll_private.delete_source(uuid,timestamptz) from public,anon,authenticated;
grant execute on function payroll_private.delete_source(uuid,timestamptz) to authenticated;
create function public.admin_delete_payroll_source(p_source_id uuid,p_expected_updated_at timestamptz) returns boolean
language sql security invoker set search_path='' as $$ select payroll_private.delete_source(p_source_id,p_expected_updated_at) $$;
revoke all on function public.admin_delete_payroll_source(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.admin_delete_payroll_source(uuid,timestamptz) to authenticated;

comment on table public.payroll_sources is 'Folhas independentes por empresa/unidade dentro de uma competência; valores consolidados por CPF na leitura, sem substituir outros arquivos.';
notify pgrst,'reload schema';
