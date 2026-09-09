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
