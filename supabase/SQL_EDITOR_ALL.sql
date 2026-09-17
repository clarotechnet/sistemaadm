-- RH Control / Supabase - execute este arquivo inteiro no SQL Editor

-- ===== 0001_schema.sql =====

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null,
  department text not null default '',
  job_title text not null default '',
  role text not null default 'CONSULTA' check (role in ('ADMINISTRADOR','RH','CONSULTA')),
  status text not null default 'AGUARDANDO APROVAÇÃO' check (status in ('ATIVO','AGUARDANDO APROVAÇÃO','BLOQUEADO')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null
);
create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.payroll_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  file_name text not null,
  competence text not null,
  record_count integer not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  type text not null,
  file_name text,
  status text not null,
  processed_count integer default 0,
  ok_count integer default 0,
  divergent_count integer default 0,
  missing_count integer default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.comparison_results (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  cpf_hash text not null,
  status text not null,
  payroll_value double precision,
  reference_value double precision,
  difference double precision
);

create table if not exists public.pdf_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  tool text not null,
  file_count integer not null,
  created_at timestamptz not null default now()
);

create table if not exists public.benefit_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.processing_jobs(id) on delete cascade,
  benefit_type text not null,
  configuration text not null default '{}'
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  user_name text not null,
  operation text not null,
  module text not null,
  result text not null,
  status text not null,
  file_name text,
  processed_count integer,
  ok_count integer,
  divergent_count integer,
  missing_count integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_processing_jobs_user_created on public.processing_jobs(user_id, created_at desc);
create index if not exists idx_processing_jobs_type_status on public.processing_jobs(type, status);
create index if not exists idx_audit_logs_created on public.audit_logs(created_at desc);
create index if not exists idx_audit_logs_user_created on public.audit_logs(user_id, created_at desc);
create index if not exists idx_comparison_results_job on public.comparison_results(job_id);


-- ===== 0002_auth_rls.sql =====

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare first_user boolean;
begin
  perform pg_advisory_xact_lock(hashtext('rh_control_first_user'));
  select not exists(select 1 from public.profiles) into first_user;
  insert into public.profiles(id,email,full_name,department,job_title,role,status)
  values (
    new.id,
    lower(coalesce(new.email,'')),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)),
    coalesce(new.raw_user_meta_data->>'department',''),
    coalesce(new.raw_user_meta_data->>'job_title',''),
    case when first_user then 'ADMINISTRADOR' else 'CONSULTA' end,
    case when first_user then 'ATIVO' else 'AGUARDANDO APROVAÇÃO' end
  ) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path=public as $$
  select role from public.profiles where id=auth.uid() and status='ATIVO';
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and status='ATIVO');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_profile_role()='ADMINISTRADOR', false);
$$;

create or replace function public.is_rh_or_admin()
returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_profile_role() in ('ADMINISTRADOR','RH'), false);
$$;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_rh_or_admin() to authenticated;
create or replace function public.admin_update_profile(target_id uuid, new_role text default null, new_status text default null)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare target public.profiles; result public.profiles;
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if new_role is not null and new_role not in ('ADMINISTRADOR','RH','CONSULTA') then raise exception 'Perfil inválido'; end if;
  if new_status is not null and new_status not in ('ATIVO','AGUARDANDO APROVAÇÃO','BLOQUEADO') then raise exception 'Status inválido'; end if;
  select * into target from public.profiles where id=target_id for update;
  if not found then raise exception 'Usuário não encontrado'; end if;
  if target.role='ADMINISTRADOR' and target.status='ATIVO'
     and (coalesce(new_role,target.role)<>'ADMINISTRADOR' or coalesce(new_status,target.status)<>'ATIVO')
     and not exists(select 1 from public.profiles p where p.id<>target.id and p.role='ADMINISTRADOR' and p.status='ATIVO') then
    raise exception 'É necessário manter pelo menos um administrador ativo';
  end if;
  update public.profiles set role=coalesce(new_role,role), status=coalesce(new_status,status), updated_at=now()
  where id=target_id returning * into result;
  return to_jsonb(result);
end;
$$;

grant execute on function public.admin_update_profile(uuid,text,text) to authenticated;

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.payroll_imports enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.comparison_results enable row level security;
alter table public.pdf_jobs enable row level security;
alter table public.benefit_jobs enable row level security;
alter table public.audit_logs enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update(full_name,department,job_title,updated_at) on public.profiles to authenticated;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists roles_select on public.roles;
drop policy if exists permissions_select on public.permissions;
drop policy if exists role_permissions_select on public.role_permissions;
drop policy if exists payroll_select on public.payroll_imports;
drop policy if exists payroll_insert on public.payroll_imports;
drop policy if exists payroll_update on public.payroll_imports;
drop policy if exists payroll_delete on public.payroll_imports;
drop policy if exists jobs_select on public.processing_jobs;
drop policy if exists jobs_insert on public.processing_jobs;
drop policy if exists jobs_update on public.processing_jobs;
drop policy if exists jobs_delete on public.processing_jobs;
drop policy if exists comparison_select on public.comparison_results;
drop policy if exists comparison_write on public.comparison_results;
drop policy if exists pdf_select on public.pdf_jobs;
drop policy if exists pdf_write on public.pdf_jobs;
drop policy if exists benefit_select on public.benefit_jobs;
drop policy if exists benefit_write on public.benefit_jobs;
drop policy if exists audit_select on public.audit_logs;
drop policy if exists audit_insert on public.audit_logs;

create policy profiles_select on public.profiles for select to authenticated
using (id=auth.uid() or public.is_admin());
create policy profiles_update_self on public.profiles for update to authenticated
using (id=auth.uid() and status<>'BLOQUEADO')
with check (id=auth.uid() and status<>'BLOQUEADO');

revoke all on public.roles, public.permissions, public.role_permissions from anon, authenticated;
grant select on public.roles, public.permissions, public.role_permissions to authenticated;
create policy roles_select on public.roles for select to authenticated using (public.is_active_user());
create policy permissions_select on public.permissions for select to authenticated using (public.is_active_user());
create policy role_permissions_select on public.role_permissions for select to authenticated using (public.is_active_user());
grant select,insert,update,delete on public.payroll_imports, public.processing_jobs to authenticated;
create policy payroll_select on public.payroll_imports for select to authenticated
using (public.is_active_user() and (user_id=auth.uid() or public.is_rh_or_admin()));
create policy payroll_insert on public.payroll_imports for insert to authenticated
with check (public.is_active_user() and user_id=auth.uid());
create policy payroll_update on public.payroll_imports for update to authenticated
using (public.is_active_user() and (user_id=auth.uid() or public.is_rh_or_admin()))
with check (public.is_active_user() and (user_id=auth.uid() or public.is_rh_or_admin()));
create policy payroll_delete on public.payroll_imports for delete to authenticated
using (public.is_active_user() and (user_id=auth.uid() or public.is_admin()));

create policy jobs_select on public.processing_jobs for select to authenticated
using (public.is_active_user() and (user_id=auth.uid() or public.is_rh_or_admin()));
create policy jobs_insert on public.processing_jobs for insert to authenticated
with check (public.is_active_user() and user_id=auth.uid());
create policy jobs_update on public.processing_jobs for update to authenticated
using (public.is_active_user() and (user_id=auth.uid() or public.is_rh_or_admin()))
with check (public.is_active_user() and (user_id=auth.uid() or public.is_rh_or_admin()));
create policy jobs_delete on public.processing_jobs for delete to authenticated
using (public.is_active_user() and (user_id=auth.uid() or public.is_admin()));
grant select,insert,update,delete on public.comparison_results, public.pdf_jobs, public.benefit_jobs to authenticated;

create policy comparison_select on public.comparison_results for select to authenticated
using (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())));
create policy comparison_write on public.comparison_results for all to authenticated
using (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())))
with check (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())));

create policy pdf_select on public.pdf_jobs for select to authenticated
using (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())));
create policy pdf_write on public.pdf_jobs for all to authenticated
using (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())))
with check (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())));

create policy benefit_select on public.benefit_jobs for select to authenticated
using (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())));
create policy benefit_write on public.benefit_jobs for all to authenticated
using (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())))
with check (public.is_active_user() and exists(select 1 from public.processing_jobs j where j.id=job_id and (j.user_id=auth.uid() or public.is_rh_or_admin())));
grant select,insert on public.audit_logs to authenticated;
create policy audit_select on public.audit_logs for select to authenticated
using (public.is_active_user() and (user_id=auth.uid() or public.is_rh_or_admin()));
create policy audit_insert on public.audit_logs for insert to authenticated
with check (public.is_active_user() and user_id=auth.uid());

revoke all on public.payroll_imports, public.processing_jobs, public.comparison_results,
  public.pdf_jobs, public.benefit_jobs, public.audit_logs from anon;

comment on function public.handle_new_user() is 'Cria o perfil vinculado ao auth.users; primeiro usuário vira administrador ativo.';
comment on function public.admin_update_profile(uuid,text,text) is 'Atualiza papel/status somente por administrador ativo e preserva ao menos um admin ativo.';


-- ===== 0003_seed_roles_permissions.sql =====

insert into public.roles(name,description) values
('ADMINISTRADOR','Acesso total ao RH Control'),
('RH','Operação de folha, benefícios, PDFs, relatórios e histórico'),
('CONSULTA','Acesso de consulta a relatórios e ao próprio histórico')
on conflict (name) do update set description=excluded.description;

insert into public.permissions(key,description) values
('users.manage','Gerenciar usuários, papéis e aprovações'),
('payroll.manage','Importar e processar folha de pagamento'),
('benefits.manage','Processar benefícios e comparativos'),
('pdf.manage','Processar ferramentas de PDF'),
('reports.read','Consultar relatórios'),
('audit.read','Consultar histórico de auditoria'),
('settings.manage','Gerenciar configurações administrativas')
on conflict (key) do update set description=excluded.description;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name='ADMINISTRADOR'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p
  on p.key in ('payroll.manage','benefits.manage','pdf.manage','reports.read','audit.read')
where r.name='RH'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p
  on p.key in ('reports.read','audit.read')
where r.name='CONSULTA'
on conflict do nothing;


-- ===== 0004_backfill_existing_users.sql =====

insert into public.profiles(id,email,full_name,department,job_title,role,status,created_at,updated_at)
select u.id, lower(coalesce(u.email,'')),
       coalesce(u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email,''),'@',1)),
       coalesce(u.raw_user_meta_data->>'department',''),
       coalesce(u.raw_user_meta_data->>'job_title',''),
       'CONSULTA','AGUARDANDO APROVAÇÃO',u.created_at,now()
from auth.users u
where not exists(select 1 from public.profiles p where p.id=u.id)
on conflict (id) do nothing;

with first_profile as (
  select p.id from public.profiles p
  order by p.created_at asc, p.id asc limit 1
)
update public.profiles p
set role='ADMINISTRADOR', status='ATIVO', updated_at=now()
where p.id=(select id from first_profile)
  and not exists(select 1 from public.profiles x where x.role='ADMINISTRADOR' and x.status='ATIVO');



-- 0006_privacy_settings.sql
create table if not exists public.system_settings (
  id text primary key default 'global' check (id='global'),
  mask_cpf boolean not null default true,
  file_retention text not null default 'NONE' check (file_retention in ('NONE','24_HOURS','SECURE_OPTIONAL')),
  financial_tolerance numeric(12,2) not null default 0.01,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.system_settings(id,mask_cpf,file_retention,financial_tolerance)
values ('global',true,'NONE',0.01)
on conflict (id) do nothing;

create table if not exists public.raw_file_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_name text not null,
  storage_path text not null unique,
  size_bytes bigint not null,
  retention_mode text not null check (retention_mode in ('24_HOURS','SECURE_OPTIONAL')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);create index if not exists idx_raw_file_uploads_user_created on public.raw_file_uploads(user_id,created_at desc);
create index if not exists idx_raw_file_uploads_expires on public.raw_file_uploads(expires_at) where expires_at is not null;

alter table public.system_settings enable row level security;
alter table public.raw_file_uploads enable row level security;

revoke all on public.system_settings, public.raw_file_uploads from anon, authenticated;
grant select on public.system_settings to authenticated;
grant update(mask_cpf,file_retention,financial_tolerance,updated_by,updated_at) on public.system_settings to authenticated;
grant select,insert,delete on public.raw_file_uploads to authenticated;

drop policy if exists settings_select on public.system_settings;
drop policy if exists settings_update_admin on public.system_settings;
drop policy if exists raw_files_select on public.raw_file_uploads;
drop policy if exists raw_files_insert on public.raw_file_uploads;
drop policy if exists raw_files_delete on public.raw_file_uploads;

create policy settings_select on public.system_settings for select to authenticated
using (public.is_active_user());
create policy settings_update_admin on public.system_settings for update to authenticated
using (public.is_admin()) with check (public.is_admin());

create policy raw_files_select on public.raw_file_uploads for select to authenticated
using (user_id=auth.uid() or public.is_admin());create policy raw_files_insert on public.raw_file_uploads for insert to authenticated
with check (user_id=auth.uid() and public.is_active_user());
create policy raw_files_delete on public.raw_file_uploads for delete to authenticated
using (user_id=auth.uid() or public.is_admin());

insert into storage.buckets(id,name,public,file_size_limit)
values ('rh-private-files','rh-private-files',false,52428800)
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit;

comment on table public.system_settings is 'Configurações globais de privacidade, retenção e tolerância financeira.';
comment on table public.raw_file_uploads is 'Metadados de arquivos brutos armazenados no bucket privado conforme a política de retenção.';

-- 0007_security_hardening.sql
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path='' as $$
declare first_user boolean;
begin
  perform pg_advisory_xact_lock(hashtext('rh_control_first_user'));
  select not exists(select 1 from public.profiles) into first_user;
  insert into public.profiles(id,email,full_name,department,job_title,role,status)
  values (new.id,lower(coalesce(new.email,'')),coalesce(new.raw_user_meta_data->>'full_name',split_part(coalesce(new.email,''),'@',1)),coalesce(new.raw_user_meta_data->>'department',''),coalesce(new.raw_user_meta_data->>'job_title',''),case when first_user then 'ADMINISTRADOR' else 'CONSULTA' end,case when first_user then 'ATIVO' else 'AGUARDANDO APROVAÇÃO' end)
  on conflict (id) do nothing;
  return new;
end;
$$;
create or replace function public.current_profile_role() returns text language sql stable security definer set search_path='' as $$ select role from public.profiles where id=(select auth.uid()) and status='ATIVO' $$;
create or replace function public.is_active_user() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.profiles where id=(select auth.uid()) and status='ATIVO') $$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(public.current_profile_role()='ADMINISTRADOR',false) $$;
create or replace function public.is_rh_or_admin() returns boolean language sql stable security definer set search_path='' as $$ select coalesce(public.current_profile_role() in ('ADMINISTRADOR','RH'),false) $$;
create or replace function public.admin_update_profile(target_id uuid,new_role text default null,new_status text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare target public.profiles; result public.profiles;
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  if new_role is not null and new_role not in ('ADMINISTRADOR','RH','CONSULTA') then raise exception 'Perfil inválido'; end if;
  if new_status is not null and new_status not in ('ATIVO','AGUARDANDO APROVAÇÃO','BLOQUEADO') then raise exception 'Status inválido'; end if;
  select * into target from public.profiles where id=target_id for update;
  if not found then raise exception 'Usuário não encontrado'; end if;
  if target.role='ADMINISTRADOR' and target.status='ATIVO' and (coalesce(new_role,target.role)<>'ADMINISTRADOR' or coalesce(new_status,target.status)<>'ATIVO') and not exists(select 1 from public.profiles p where p.id<>target.id and p.role='ADMINISTRADOR' and p.status='ATIVO') then raise exception 'É necessário manter pelo menos um administrador ativo'; end if;
  update public.profiles set role=coalesce(new_role,role),status=coalesce(new_status,status),updated_at=now() where id=target_id returning * into result;
  return to_jsonb(result);
end;
$$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
revoke all on function public.current_profile_role() from public,anon,authenticated;
revoke all on function public.is_active_user() from public,anon,authenticated;
revoke all on function public.is_admin() from public,anon,authenticated;
revoke all on function public.is_rh_or_admin() from public,anon,authenticated;
revoke all on function public.admin_update_profile(uuid,text,text) from public,anon,authenticated;
grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_rh_or_admin() to authenticated;
grant execute on function public.admin_update_profile(uuid,text,text) to authenticated;
create index if not exists idx_role_permissions_permission on public.role_permissions(permission_id);
create index if not exists idx_payroll_imports_user on public.payroll_imports(user_id);
create index if not exists idx_pdf_jobs_job on public.pdf_jobs(job_id);
create index if not exists idx_benefit_jobs_job on public.benefit_jobs(job_id);
create index if not exists idx_system_settings_updated_by on public.system_settings(updated_by);

-- 0008 / SPA estática da Hostinger: acesso seguro ao Storage privado
drop policy if exists rh_private_files_select on storage.objects;
drop policy if exists rh_private_files_insert on storage.objects;
drop policy if exists rh_private_files_delete on storage.objects;
create policy rh_private_files_select on storage.objects for select to authenticated
using (bucket_id='rh-private-files' and (owner_id=(select auth.uid()::text) or public.is_admin()));
create policy rh_private_files_insert on storage.objects for insert to authenticated
with check (bucket_id='rh-private-files' and (storage.foldername(name))[1]=(select auth.uid()::text) and public.is_active_user());
create policy rh_private_files_delete on storage.objects for delete to authenticated
using (bucket_id='rh-private-files' and (owner_id=(select auth.uid()::text) or public.is_admin()));

-- 0009 / impede a execucao direta do event-trigger de RLS, quando ele existir
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;

-- 0010 / limpeza administrativa do histórico de auditoria
create or replace function public.admin_clear_audit_logs()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  actor public.profiles;
  removed_count integer;
begin
  if not public.is_admin() then raise exception 'Acesso negado'; end if;
  select * into actor from public.profiles where id=(select auth.uid()) and status='ATIVO';
  if actor.id is null then raise exception 'Administrador ativo não encontrado'; end if;
  delete from public.audit_logs where id is not null;
  get diagnostics removed_count = row_count;
  insert into public.audit_logs(id,user_id,user_name,operation,module,result,status,created_at)
  values (gen_random_uuid(),actor.id,actor.full_name,'Limpou histórico de auditoria','Histórico',removed_count || ' registro(s) anterior(es) removido(s).','AVISO',now());
  return removed_count;
end;
$$;
revoke all on function public.admin_clear_audit_logs() from public,anon,authenticated;
grant execute on function public.admin_clear_audit_logs() to authenticated;
revoke delete, update, truncate on table public.audit_logs from authenticated;
grant select, insert on table public.audit_logs to authenticated;



-- ===== 0010_payroll_persistence.sql =====

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
    raise exception 'CompetÃªncia invÃ¡lida. Use MM/AAAA';
  end if;
  if jsonb_typeof(p_records) <> 'array' or jsonb_array_length(p_records)=0 then
    raise exception 'A folha nÃ£o possui registros vÃ¡lidos';
  end if;
  if jsonb_array_length(p_records) > 50000 then
    raise exception 'Quantidade de registros acima do limite permitido';
  end if;

  select * into actor from public.profiles
  where id=(select auth.uid()) and status='ATIVO';
  if actor.id is null then raise exception 'UsuÃ¡rio ativo nÃ£o encontrado'; end if;

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

comment on table public.payroll_records is 'Dados normalizados da folha, persistidos por competÃªncia para uso compartilhado entre RH e Administradores.';
comment on function public.save_payroll_month(text,text,bigint,jsonb,jsonb) is 'Cria a competÃªncia quando nova e substitui atomicamente os dados quando o mÃªs jÃ¡ existe.';



-- 2026-09-16: exclusão individual de comparativos Saúde/Odonto por competência
create or replace function public.delete_payroll_comparison(
  p_payroll_import_id uuid,
  p_kind text
) returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  if p_kind not in ('health','dental') then raise exception 'Tipo de comparativo inválido'; end if;
  delete from public.payroll_comparisons
  where payroll_import_id=p_payroll_import_id and kind=p_kind;
  return found;
end;
$$;
revoke all on function public.delete_payroll_comparison(uuid,text)
from public,anon,authenticated;
grant execute on function public.delete_payroll_comparison(uuid,text)
to authenticated;


-- 20260916224500_quark_employee_sync.sql

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
    if new.created_by is null then raise exception 'UsuÃ¡rio responsÃ¡vel nÃ£o informado'; end if;
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
  if jsonb_typeof(p_records) <> 'array' then raise exception 'Registros do Quark invÃ¡lidos'; end if;
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

comment on table public.employee_sync_runs is 'HistÃ³rico de sincronizaÃ§Ãµes de funcionÃ¡rios com fontes externas como QuarkRH.';
comment on function public.sync_quark_employees(uuid,jsonb) is 'Upsert server-side de colaboradores Quark por external_id, com fallback seguro por CPF.';

commit;
