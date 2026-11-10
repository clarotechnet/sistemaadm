-- RH-only catalog and mappings. Never refers to the Financeiro database.
create table public.rh_unit_catalog (
  id uuid primary key default gen_random_uuid(), name text not null unique check(length(btrim(name)) between 2 and 120),
  city text not null check(length(btrim(city)) between 2 and 100), created_at timestamptz not null default now()
);
create table public.quark_unit_mappings (
  external_unit_id text primary key check(external_unit_id ~ '^[0-9]+$'), external_unit_name text not null,
  api_city text not null default '', sync_enabled boolean not null default false,
  target_unit_id uuid references public.rh_unit_catalog(id) on delete restrict,
  last_seen_at timestamptz, updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id) on delete set null
);
create index quark_unit_mappings_target on public.quark_unit_mappings(target_unit_id);
create index quark_unit_mappings_actor on public.quark_unit_mappings(updated_by);
create table public.quark_team_mappings (
  external_unit_id text not null references public.quark_unit_mappings(external_unit_id) on delete restrict,
  external_team_id text not null, external_team_name text not null, department text check(department is null or length(btrim(department)) between 2 and 120),
  last_seen_at timestamptz, updated_at timestamptz not null default now(), updated_by uuid references public.profiles(id) on delete set null,
  primary key(external_unit_id,external_team_id)
);
create index quark_team_mappings_actor on public.quark_team_mappings(updated_by);
alter table public.employees add column mapped_unit_name text, add column mapped_city text, add column quark_mapping_pending boolean not null default false;
alter table public.employee_sync_runs add column conflicts_count integer not null default 0, add column unmapped_count integer not null default 0;
create unique index employee_sync_one_running on public.employee_sync_runs((true)) where status='RUNNING';

alter table public.rh_unit_catalog enable row level security;
alter table public.quark_unit_mappings enable row level security;
alter table public.quark_team_mappings enable row level security;
create policy rh_unit_catalog_read on public.rh_unit_catalog for select to authenticated using ((select public.is_rh_or_admin()));
create policy quark_unit_mappings_read on public.quark_unit_mappings for select to authenticated using ((select public.is_rh_or_admin()));
create policy quark_team_mappings_read on public.quark_team_mappings for select to authenticated using ((select public.is_rh_or_admin()));
revoke all on public.rh_unit_catalog,public.quark_unit_mappings,public.quark_team_mappings from public,anon,authenticated;
grant select on public.rh_unit_catalog,public.quark_unit_mappings,public.quark_team_mappings to authenticated;
grant all on public.rh_unit_catalog,public.quark_unit_mappings,public.quark_team_mappings to service_role;

insert into public.rh_unit_catalog(name,city) values ('Natal','Natal'),('Mossoró','Mossoró'),('Fortaleza','Fortaleza'),('Recife','Recife'),('João Pessoa','João Pessoa'),('Maceió','Maceió');
insert into public.quark_unit_mappings(external_unit_id,external_unit_name,sync_enabled,target_unit_id)
select seed.id,seed.name,true,u.id from (values
 ('9417839','VNA TELECOM LTDA - NATAL','Natal'),('9417838','VNA TELECOM LTDA - Mossoro','Mossoró'),
 ('9417837','RDT TELECOM LTDA - RECIFE','Recife'),('9417836','RDT TELECOM LTDA - FORTALEZA','Fortaleza'),
 ('9417834','DMV DINIZ - RECIFE','Recife'),('9338112','DMV DINIZ-NATAL','Natal'),
 ('13852936','DMV DINIZ - FORTALEZA','Fortaleza'),('13852937','RDT TELECOM LTDA - JOAO PESSOA','João Pessoa'),
 ('13852938','RDT TELECOM LTDA - MACEIO','Maceió'),('14180910','VNA TELECOM - Maceió','Maceió')
) seed(id,name,city) join public.rh_unit_catalog u on u.city=seed.city;
insert into public.quark_unit_mappings(external_unit_id,external_unit_name)
select distinct on(external_unit_id) external_unit_id,external_unit_name from public.employees where source='QUARK' and external_unit_id ~ '^[0-9]+$' on conflict do nothing;
insert into public.quark_team_mappings(external_unit_id,external_team_id,external_team_name,department)
select distinct on(external_unit_id,coalesce(nullif(external_team_id,''),'nome:'||lower(btrim(coalesce(nullif(external_team_name,''),department,'')))))
 external_unit_id,coalesce(nullif(external_team_id,''),'nome:'||lower(btrim(coalesce(nullif(external_team_name,''),department,'')))),
 coalesce(nullif(external_team_name,''),department,''),case when length(btrim(department))>=2 then department else null end
from public.employees where source='QUARK' and external_unit_id in(select external_unit_id from public.quark_unit_mappings);
update public.employees e set mapped_unit_name=u.name,mapped_city=u.city,
 quark_mapping_pending=(u.id is null or not exists(select 1 from public.quark_team_mappings t where t.external_unit_id=e.external_unit_id and t.external_team_id=coalesce(nullif(e.external_team_id,''),'nome:'||lower(btrim(coalesce(nullif(e.external_team_name,''),e.department,'')))) and t.department is not null))
from public.quark_unit_mappings m left join public.rh_unit_catalog u on u.id=m.target_unit_id where e.source='QUARK' and e.external_unit_id=m.external_unit_id;

create function public.discover_quark_rh_units(p_units jsonb) returns integer language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 if jsonb_typeof(p_units) is distinct from 'array' or jsonb_array_length(p_units)>10000 then raise exception 'Lista de unidades inválida'; end if;
 if exists(select 1 from jsonb_array_elements(p_units) x where coalesce(x->>'id','') !~ '^[0-9]+$' or length(btrim(coalesce(x->>'name','')))<1) then raise exception 'Unidade inválida'; end if;
 insert into public.quark_unit_mappings(external_unit_id,external_unit_name,api_city,last_seen_at)
 select x->>'id',left(x->>'name',200),left(coalesce(x->>'city',''),100),now() from jsonb_array_elements(p_units) x
 on conflict(external_unit_id) do update set external_unit_name=excluded.external_unit_name,api_city=excluded.api_city,last_seen_at=excluded.last_seen_at;
 get diagnostics n=row_count; return n;
end; $$;

create function public.save_quark_rh_mapping(p_actor uuid,p_kind text,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare unit_key text; team_key text; target uuid; mapped text; n integer:=0; created uuid;
begin
 if not exists(select 1 from public.profiles where id=p_actor and status='ATIVO' and role in('RH','ADMINISTRADOR')) then raise exception 'Acesso negado'; end if;
 if p_kind='create_unit' then
  if length(btrim(coalesce(p_data->>'name',''))) not between 2 and 120 or length(btrim(coalesce(p_data->>'city',''))) not between 2 and 100 then raise exception 'Nome e cidade da unidade são obrigatórios'; end if;
  insert into public.rh_unit_catalog(name,city) values(btrim(p_data->>'name'),btrim(p_data->>'city')) returning id into created;
  return jsonb_build_object('id',created,'employees',0);
 end if;
 unit_key:=p_data->>'unit';
 perform 1 from public.quark_unit_mappings where external_unit_id=unit_key for update;
 if not found then raise exception 'Unidade QuarkRH não encontrada'; end if;
 if p_kind='unit' then
  target:=nullif(p_data->>'target','')::uuid;
  if target is not null and not exists(select 1 from public.rh_unit_catalog where id=target) then raise exception 'Unidade do RH não encontrada'; end if;
  if jsonb_typeof(p_data->'enabled') is distinct from 'boolean' then raise exception 'Informe se a unidade participa da sincronização'; end if;
  update public.quark_unit_mappings set target_unit_id=target,sync_enabled=(p_data->>'enabled')::boolean,updated_at=now(),updated_by=p_actor where external_unit_id=unit_key;
  update public.employees e set mapped_unit_name=(select name from public.rh_unit_catalog where id=target),mapped_city=(select city from public.rh_unit_catalog where id=target),
   quark_mapping_pending=(target is null or not exists(select 1 from public.quark_team_mappings t where t.external_unit_id=unit_key and t.external_team_id=coalesce(nullif(e.external_team_id,''),'nome:'||lower(btrim(coalesce(nullif(e.external_team_name,''),e.department,'')))) and t.department is not null)),updated_by=p_actor
  where e.source='QUARK' and e.external_unit_id=unit_key;
 elsif p_kind='team' then
  team_key:=p_data->>'team'; mapped:=nullif(btrim(p_data->>'department'),'');
  if mapped is not null and length(mapped) not between 2 and 120 then raise exception 'Setor inválido'; end if;
  update public.quark_team_mappings set department=mapped,updated_at=now(),updated_by=p_actor where external_unit_id=unit_key and external_team_id=team_key;
  if not found then raise exception 'Equipe QuarkRH não encontrada'; end if;
  update public.employees e set department=coalesce(mapped,nullif(e.external_team_name,''),e.department),
   quark_mapping_pending=(mapped is null or not exists(select 1 from public.quark_unit_mappings where external_unit_id=unit_key and target_unit_id is not null)),updated_by=p_actor
  where e.source='QUARK' and e.external_unit_id=unit_key and coalesce(nullif(e.external_team_id,''),'nome:'||lower(btrim(coalesce(nullif(e.external_team_name,''),e.department,''))))=team_key;
 else raise exception 'Tipo de mapeamento inválido'; end if;
 get diagnostics n=row_count; return jsonb_build_object('employees',n);
end; $$;

create function public.complete_quark_rh_sync(p_actor uuid,p_run uuid,p_records jsonb,p_received integer,p_skipped integer,p_conflicts integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare run public.employee_sync_runs; item jsonb; mapped_records jsonb; result jsonb; pending integer;
begin
 if not exists(select 1 from public.profiles where id=p_actor and status='ATIVO' and role in('RH','ADMINISTRADOR')) then raise exception 'Acesso negado'; end if;
 select * into run from public.employee_sync_runs where id=p_run for update;
 if run.id is null or run.status<>'RUNNING' or run.triggered_by is distinct from p_actor then raise exception 'Sincronização inválida ou já concluída'; end if;
 if jsonb_typeof(p_records) is distinct from 'array' or jsonb_array_length(p_records)>50000 or p_received<jsonb_array_length(p_records) or p_received<1 or p_skipped<0 or p_conflicts<0 then raise exception 'Dados de sincronização inválidos'; end if;
 perform 1 from public.quark_unit_mappings where external_unit_id in(select x->>'external_unit_id' from jsonb_array_elements(p_records) x) order by external_unit_id for update;
 if exists(select 1 from jsonb_array_elements(p_records) x left join public.quark_unit_mappings m on m.external_unit_id=x->>'external_unit_id' where m.external_unit_id is null or not m.sync_enabled) then raise exception 'A seleção de unidades mudou. Consulte novamente antes de sincronizar'; end if;
 insert into public.quark_team_mappings(external_unit_id,external_team_id,external_team_name,last_seen_at)
 select distinct on(x->>'external_unit_id',coalesce(nullif(x->>'external_team_id',''),'nome:'||lower(btrim(coalesce(x->>'external_team_name','')))))
  x->>'external_unit_id',coalesce(nullif(x->>'external_team_id',''),'nome:'||lower(btrim(coalesce(x->>'external_team_name','')))),coalesce(x->>'external_team_name',''),now() from jsonb_array_elements(p_records) x
 on conflict(external_unit_id,external_team_id) do update set external_team_name=excluded.external_team_name,last_seen_at=excluded.last_seen_at;
 select coalesce(jsonb_agg(jsonb_set(x,'{department}',to_jsonb(coalesce(t.department,x->>'department','')))),'[]'::jsonb) into mapped_records
 from jsonb_array_elements(p_records) x left join public.quark_team_mappings t on t.external_unit_id=x->>'external_unit_id' and t.external_team_id=coalesce(nullif(x->>'external_team_id',''),'nome:'||lower(btrim(coalesce(x->>'external_team_name',''))));
 select public.sync_quark_employees(p_actor,mapped_records) into result;
 update public.employees e set mapped_unit_name=u.name,mapped_city=u.city,quark_mapping_pending=(u.id is null or t.department is null),updated_by=p_actor
 from public.quark_unit_mappings m left join public.rh_unit_catalog u on u.id=m.target_unit_id
 left join public.quark_team_mappings t on t.external_unit_id=m.external_unit_id
 where e.source='QUARK' and e.external_unit_id=m.external_unit_id and t.external_team_id=coalesce(nullif(e.external_team_id,''),'nome:'||lower(btrim(coalesce(e.external_team_name,''))))
 and exists(select 1 from jsonb_array_elements(p_records) x where x->>'external_unit_id'=e.external_unit_id and x->>'external_id'=e.external_id)
 and (e.mapped_unit_name,e.mapped_city,e.quark_mapping_pending) is distinct from (u.name,u.city,(u.id is null or t.department is null));
 select count(*) into pending from jsonb_array_elements(p_records) x join public.employees e on e.external_unit_id=x->>'external_unit_id' and e.external_id=x->>'external_id' where e.quark_mapping_pending;
 update public.employee_sync_runs set status='SUCCESS',received_count=p_received,created_count=coalesce((result->>'created')::integer,0),updated_count=coalesce((result->>'updated')::integer,0),linked_count=coalesce((result->>'linked')::integer,0),skipped_count=p_skipped+coalesce((result->>'skipped')::integer,0),conflicts_count=p_conflicts,unmapped_count=pending,completed_at=now() where id=p_run;
 return result||jsonb_build_object('received',p_received,'skipped',p_skipped+coalesce((result->>'skipped')::integer,0),'conflicts',p_conflicts,'unmapped',pending);
end; $$;
revoke all on function public.discover_quark_rh_units(jsonb),public.save_quark_rh_mapping(uuid,text,jsonb),public.complete_quark_rh_sync(uuid,uuid,jsonb,integer,integer,integer) from public,anon,authenticated;
grant execute on function public.discover_quark_rh_units(jsonb),public.save_quark_rh_mapping(uuid,text,jsonb),public.complete_quark_rh_sync(uuid,uuid,jsonb,integer,integer,integer) to service_role;
comment on column public.employees.mapped_city is 'Cidade operacional escolhida no RH; o endereço fiscal retornado pela API não define a filial.';
notify pgrst,'reload schema';
