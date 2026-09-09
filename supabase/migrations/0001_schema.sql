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
