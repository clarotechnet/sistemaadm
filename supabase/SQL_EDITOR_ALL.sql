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
