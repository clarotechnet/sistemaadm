-- Additive shared references. Payroll records and their financial values are
-- read-only to this module; results are recalculated, never written over them.
create table public.payroll_overtime_references (
  id uuid primary key default gen_random_uuid(),
  payroll_import_id uuid not null references public.payroll_imports(id) on delete cascade,
  source_id uuid,
  label text not null check(length(btrim(label)) between 1 and 120),
  file_name text not null check(length(file_name) between 1 and 255),
  file_hash text not null check(file_hash ~ '^[a-f0-9]{64}$'),
  reference_data jsonb not null check(jsonb_typeof(reference_data)='object'),
  mappings jsonb not null default '{}' check(jsonb_typeof(mappings)='object'),
  mapping_revision timestamptz,
  created_by uuid not null,
  updated_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(source_id,payroll_import_id) references public.payroll_sources(id,payroll_import_id) on delete cascade,
  unique(payroll_import_id,file_hash)
);
create unique index payroll_overtime_label_unique on public.payroll_overtime_references(payroll_import_id,lower(regexp_replace(btrim(label),'\s+',' ','g')));
create index payroll_overtime_source_idx on public.payroll_overtime_references(source_id,payroll_import_id);
alter table public.payroll_overtime_references enable row level security;
revoke all on public.payroll_overtime_references from public,anon,authenticated;
grant select on public.payroll_overtime_references to authenticated;
create policy payroll_overtime_read on public.payroll_overtime_references for select to authenticated using ((select auth.uid()) is not null and (select public.is_rh_or_admin()));

create function payroll_private.save_overtime_reference(p_month_id uuid,p_source_id uuid,p_label text,p_file_name text,p_file_hash text,p_reference_data jsonb,p_id uuid,p_expected_updated_at timestamptz) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.profiles; target public.payroll_overtime_references; result_id uuid; item jsonb; val jsonb; rate text; normalized_label text;
begin
  if auth.uid() is null or not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  select * into actor from public.profiles where id=auth.uid() and status='ATIVO';
  if actor.id is null then raise exception 'Usuário ativo não encontrado'; end if;
  perform 1 from public.payroll_imports where id=p_month_id for update;
  if not found then raise exception 'A competência não foi encontrada'; end if;
  if p_source_id is not null and not exists(select 1 from public.payroll_sources where id=p_source_id and payroll_import_id=p_month_id) then raise exception 'A origem não pertence à competência'; end if;
  normalized_label:=regexp_replace(btrim(coalesce(p_label,'')),'\s+',' ','g');
  if length(normalized_label) not between 1 and 120 or length(coalesce(p_file_name,'')) not between 1 and 255 or p_file_name !~* '\.xlsx?$' or coalesce(p_file_hash,'') !~ '^[a-f0-9]{64}$' then raise exception 'Identificação ou arquivo de referência inválido'; end if;
  if jsonb_typeof(p_reference_data) is distinct from 'object' or pg_column_size(p_reference_data)>10485760 or p_reference_data->>'version' is distinct from '1' or jsonb_typeof(p_reference_data->'records') is distinct from 'array' or jsonb_typeof(p_reference_data->'rates') is distinct from 'array' then raise exception 'Estrutura da referência inválida'; end if;
  if jsonb_array_length(p_reference_data->'records') not between 1 and 50000 or jsonb_array_length(p_reference_data->'rates') not between 1 and 50 then raise exception 'Quantidade de registros/percentuais inválida'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_reference_data->'rates') r where r !~ '^[0-9]+(\.[0-9]+)?$' or length(r)>12) then raise exception 'Percentual inválido'; end if;
  if exists(select 1 from jsonb_array_elements(p_reference_data->'records') r group by r->>'id' having count(*)>1) then raise exception 'Identificador de linha repetido'; end if;
  for item in select value from jsonb_array_elements(p_reference_data->'records') loop
    if length(coalesce(item->>'id','')) not between 1 and 240 or length(btrim(coalesce(item->>'name',''))) not between 1 and 240 or jsonb_typeof(item->'values') is distinct from 'object' or coalesce(item->>'row','') !~ '^[1-9][0-9]*$' then raise exception 'Colaborador/linha de referência inválido'; end if;
    if item->>'cpf' is not null and item->>'cpf' !~ '^[0-9]{11}$' then raise exception 'CPF inválido na referência'; end if;
    for rate,val in select * from jsonb_each(item->'values') loop
      if rate !~ '^[0-9]+(\.[0-9]+)?$' or not (p_reference_data->'rates' ? rate) or jsonb_typeof(val) is distinct from 'object' or jsonb_typeof(val->'issues') is distinct from 'array' then raise exception 'Rubrica de referência inválida'; end if;
      if val->>'minutes' is not null and (jsonb_typeof(val->'minutes') is distinct from 'number' or val->>'minutes' !~ '^[0-9]+$' or length(val->>'minutes')>9) then raise exception 'Duração inválida na referência'; end if;
      if val->>'amount' is not null then
        if jsonb_typeof(val->'amount') is distinct from 'number' then raise exception 'Valor de referência inválido'; end if;
        if abs((val->>'amount')::numeric)>1000000000000 then raise exception 'Valor de referência fora do limite'; end if;
      end if;
    end loop;
  end loop;
  if p_id is not null then
    select * into target from public.payroll_overtime_references where id=p_id and payroll_import_id=p_month_id for update;
    if target.id is null then raise exception 'A referência não pertence à competência'; end if;
    if p_expected_updated_at is distinct from target.updated_at then raise exception 'A referência foi alterada por outra pessoa. Atualize a tela'; end if;
  end if;
  if exists(select 1 from public.payroll_overtime_references where payroll_import_id=p_month_id and file_hash=p_file_hash and id is distinct from p_id) then raise exception 'Este arquivo já está salvo nesta competência'; end if;
  if exists(select 1 from public.payroll_overtime_references where payroll_import_id=p_month_id and lower(regexp_replace(btrim(label),'\s+',' ','g'))=lower(normalized_label) and id is distinct from p_id) then raise exception 'Já existe uma referência com esta identificação. Escolha atualizar somente essa referência'; end if;
  if p_id is null then
    insert into public.payroll_overtime_references(payroll_import_id,source_id,label,file_name,file_hash,reference_data,created_by,updated_by_name)
    values(p_month_id,p_source_id,normalized_label,p_file_name,p_file_hash,p_reference_data,actor.id,actor.full_name) returning id into result_id;
  else
    update public.payroll_overtime_references set source_id=p_source_id,label=normalized_label,file_name=p_file_name,file_hash=p_file_hash,reference_data=p_reference_data,mappings='{}',mapping_revision=null,updated_at=clock_timestamp(),updated_by_name=actor.full_name where id=p_id returning id into result_id;
  end if;
  return result_id;
end;
$$;

create function payroll_private.map_overtime_reference(p_id uuid,p_record_id text,p_cpf text,p_expected_updated_at timestamptz,p_payroll_revision timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare target public.payroll_overtime_references; month_revision timestamptz; month_id uuid; actor_name text; links jsonb;
begin
  if auth.uid() is null or not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  select payroll_import_id into month_id from public.payroll_overtime_references where id=p_id;
  select updated_at into month_revision from public.payroll_imports where id=month_id for update;
  select * into target from public.payroll_overtime_references where id=p_id for update;
  if target.id is null then raise exception 'A referência não foi encontrada'; end if;
  if p_expected_updated_at is distinct from target.updated_at or p_payroll_revision is distinct from month_revision then raise exception 'A folha ou a referência foi alterada. Atualize antes de confirmar'; end if;
  if p_record_id is null or not exists(select 1 from jsonb_array_elements(target.reference_data->'records') r where r->>'id'=p_record_id) then raise exception 'A linha de referência não existe'; end if;
  if p_cpf is not null and not exists(select 1 from public.payroll_records r where r.payroll_import_id=target.payroll_import_id and r.cpf=p_cpf and (target.source_id is null or r.source_id=target.source_id)) then raise exception 'O CPF não pertence à folha/origem selecionada'; end if;
  links:=case when target.mapping_revision=month_revision then target.mappings else '{}'::jsonb end;
  links:=case when p_cpf is null then links-p_record_id else jsonb_set(links,array[p_record_id],to_jsonb(p_cpf)) end;
  select full_name into actor_name from public.profiles where id=auth.uid();
  update public.payroll_overtime_references set mappings=links,mapping_revision=month_revision,updated_at=clock_timestamp(),updated_by_name=actor_name where id=p_id;
end;
$$;

create function payroll_private.delete_overtime_reference(p_id uuid,p_expected_updated_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare target public.payroll_overtime_references; month_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Acesso negado'; end if;
  select payroll_import_id into month_id from public.payroll_overtime_references where id=p_id;
  perform 1 from public.payroll_imports where id=month_id for update;
  select * into target from public.payroll_overtime_references where id=p_id for update;
  if target.id is null then raise exception 'A referência não foi encontrada'; end if;
  if p_expected_updated_at is distinct from target.updated_at then raise exception 'A referência foi alterada. Atualize antes de remover'; end if;
  delete from public.payroll_overtime_references where id=p_id;
end;
$$;

create function public.save_payroll_overtime_reference(p_month_id uuid,p_source_id uuid,p_label text,p_file_name text,p_file_hash text,p_reference_data jsonb,p_id uuid default null,p_expected_updated_at timestamptz default null) returns uuid
language sql security invoker set search_path='' as $$select payroll_private.save_overtime_reference(p_month_id,p_source_id,p_label,p_file_name,p_file_hash,p_reference_data,p_id,p_expected_updated_at)$$;
create function public.map_payroll_overtime_reference(p_id uuid,p_record_id text,p_cpf text,p_expected_updated_at timestamptz,p_payroll_revision timestamptz) returns void
language sql security invoker set search_path='' as $$select payroll_private.map_overtime_reference(p_id,p_record_id,p_cpf,p_expected_updated_at,p_payroll_revision)$$;
create function public.admin_delete_payroll_overtime_reference(p_id uuid,p_expected_updated_at timestamptz) returns void
language sql security invoker set search_path='' as $$select payroll_private.delete_overtime_reference(p_id,p_expected_updated_at)$$;

revoke all on function payroll_private.save_overtime_reference(uuid,uuid,text,text,text,jsonb,uuid,timestamptz),payroll_private.map_overtime_reference(uuid,text,text,timestamptz,timestamptz),payroll_private.delete_overtime_reference(uuid,timestamptz) from public,anon;
grant execute on function payroll_private.save_overtime_reference(uuid,uuid,text,text,text,jsonb,uuid,timestamptz),payroll_private.map_overtime_reference(uuid,text,text,timestamptz,timestamptz),payroll_private.delete_overtime_reference(uuid,timestamptz) to authenticated;
revoke all on function public.save_payroll_overtime_reference(uuid,uuid,text,text,text,jsonb,uuid,timestamptz),public.map_payroll_overtime_reference(uuid,text,text,timestamptz,timestamptz),public.admin_delete_payroll_overtime_reference(uuid,timestamptz) from public,anon;
grant execute on function public.save_payroll_overtime_reference(uuid,uuid,text,text,text,jsonb,uuid,timestamptz),public.map_payroll_overtime_reference(uuid,text,text,timestamptz,timestamptz),public.admin_delete_payroll_overtime_reference(uuid,timestamptz) to authenticated;
comment on table public.payroll_overtime_references is 'Referências de horas extras compartilhadas por competência/origem. Preserva HH:MM original e sinaliza minutos inválidos. Sem escrita direta pelo cliente.';
notify pgrst, 'reload schema';
