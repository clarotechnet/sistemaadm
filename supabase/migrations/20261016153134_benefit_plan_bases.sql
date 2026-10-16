-- Append-only monthly plan register. Existing payroll comparisons remain snapshots.
create table if not exists public.benefit_plan_base_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('health','dental')),
  cpf text not null check (cpf ~ '^[0-9]{11}$' and cpf <> repeat(left(cpf,1),11)),
  employee_name text not null check (length(btrim(employee_name)) between 2 and 300),
  company text not null default '', city text not null default '', department text not null default '',
  plan_name text not null default '', discount_value numeric(12,2) check (discount_value >= 0 and discount_value <> 'NaN'::numeric),
  status text not null default 'ATIVO' check (status in ('ATIVO','INATIVO','EXCLUIDO','PENDENTE')),
  check ((status='PENDENTE' and discount_value is null) or (status<>'PENDENTE' and discount_value is not null)),
  effective_from date not null check (extract(day from effective_from)=1),
  revision integer not null check (revision > 0), source text not null default 'Cadastro manual',
  notes text not null default '' check (length(notes)<=2000), metadata jsonb not null default '{}' check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid references public.profiles(id) on delete set null,
  created_by_name text not null,
  unique(kind,cpf,revision)
);
create index if not exists benefit_plan_base_month_idx on public.benefit_plan_base_versions(kind,effective_from desc,revision desc,id);
alter table public.benefit_plan_base_versions enable row level security;
revoke all on public.benefit_plan_base_versions from public,anon,authenticated;
grant select,insert on public.benefit_plan_base_versions to authenticated;
drop policy if exists benefit_plan_base_read on public.benefit_plan_base_versions;
create policy benefit_plan_base_read on public.benefit_plan_base_versions for select to authenticated using ((select public.is_rh_or_admin()));
drop policy if exists benefit_plan_base_insert on public.benefit_plan_base_versions;
create policy benefit_plan_base_insert on public.benefit_plan_base_versions for insert to authenticated with check ((select public.is_rh_or_admin()));

create or replace function public.stamp_benefit_plan_base() returns trigger
language plpgsql security invoker set search_path='' as $$
declare actor_name text; stage integer; i integer; total integer; digit integer;
begin
  if new.cpf is null or new.cpf !~ '^[0-9]{11}$' or new.cpf=repeat(left(new.cpf,1),11) then raise exception 'CPF inválido' using errcode='23514'; end if;
  for stage in 9..10 loop
    total:=0;
    for i in 1..stage loop total:=total+substring(new.cpf from i for 1)::integer*(stage+2-i); end loop;
    digit:=(total*10)%11; if digit=10 then digit:=0; end if;
    if substring(new.cpf from stage+1 for 1)::integer<>digit then raise exception 'CPF inválido' using errcode='23514'; end if;
  end loop;
  if auth.uid() is null then
    if current_user not in ('postgres','supabase_admin') then raise exception 'Acesso negado'; end if;
    new.created_by:=null; new.created_by_name:='Importação administrativa';
  else
    if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
    select full_name into actor_name from public.profiles where id=auth.uid() and status='ATIVO';
    if actor_name is null then raise exception 'Usuário não aprovado'; end if;
    new.created_by:=auth.uid(); new.created_by_name:=actor_name;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.kind||':'||new.cpf,0));
  select coalesce(max(revision),0)+1 into new.revision from public.benefit_plan_base_versions where kind=new.kind and cpf=new.cpf;
  new.created_at:=clock_timestamp();
  return new;
end; $$;
revoke all on function public.stamp_benefit_plan_base() from public,anon,authenticated;
drop trigger if exists benefit_plan_base_stamp on public.benefit_plan_base_versions;
create trigger benefit_plan_base_stamp before insert on public.benefit_plan_base_versions for each row execute function public.stamp_benefit_plan_base();

create or replace function public.save_benefit_plan_base(p_kind text,p_effective_from date,p_records jsonb,p_source text default 'Cadastro manual') returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item jsonb; saved integer:=0;
begin
  if auth.uid() is null or not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  if p_kind not in ('health','dental') or p_kind is null then raise exception 'Plano inválido'; end if;
  if p_effective_from is null or extract(day from p_effective_from)<>1 then raise exception 'Vigência inválida'; end if;
  if jsonb_typeof(p_records) is distinct from 'array' then raise exception 'Registros inválidos'; end if;
  if jsonb_array_length(p_records) not between 1 and 10000 then raise exception 'Envie entre 1 e 10000 cadastros'; end if;
  if (select count(distinct r->>'cpf') from jsonb_array_elements(p_records) r)<>jsonb_array_length(p_records) then raise exception 'CPFs repetidos ou ausentes no lote'; end if;
  for item in select value from jsonb_array_elements(p_records) loop
    insert into public.benefit_plan_base_versions(kind,cpf,employee_name,company,city,department,plan_name,discount_value,status,effective_from,revision,source,notes,metadata,created_by_name)
    values(p_kind,item->>'cpf',btrim(item->>'name'),coalesce(item->>'company',''),coalesce(item->>'city',''),coalesce(item->>'department',''),coalesce(item->>'plan',''),
      (item->>'value')::numeric,coalesce(item->>'status','ATIVO'),p_effective_from,1,left(coalesce(p_source,'Cadastro manual'),300),coalesce(item->>'notes',''),coalesce(item->'metadata','{}'::jsonb),'');
    saved:=saved+1;
  end loop;
  return jsonb_build_object('rows',saved);
end; $$;
revoke all on function public.save_benefit_plan_base(text,date,jsonb,text) from public,anon;
grant execute on function public.save_benefit_plan_base(text,date,jsonb,text) to authenticated;
comment on table public.benefit_plan_base_versions is 'Base Saúde/Odonto versionada por CPF e vigência. Sem UPDATE/DELETE pelo cliente; exclusão e desativação são novas versões.';
notify pgrst, 'reload schema';
