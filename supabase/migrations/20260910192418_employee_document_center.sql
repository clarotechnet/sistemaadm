-- Central permanente de documentos trabalhistas para auditorias mensais.
-- Os arquivos ficam em bucket privado separado dos uploads temporarios.

begin;

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(btrim(full_name)) between 2 and 180),
  cpf text not null unique check (cpf ~ '^[0-9]{11}$'),
  registration text not null default '',
  department text not null default '',
  job_title text not null default '',
  status text not null default 'ATIVO' check (status in ('ATIVO', 'DESLIGADO')),
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_categories (
  id text primary key check (id ~ '^[A-Z0-9_]+$'),
  label text not null unique check (char_length(btrim(label)) between 2 and 80),
  monthly_required boolean not null default false,
  active boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.employee_documents (
  id uuid primary key,
  employee_id uuid not null references public.employees(id) on delete restrict,
  category_id text not null references public.document_categories(id) on delete restrict,
  competence date not null check (extract(day from competence) = 1),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  file_name text not null check (char_length(btrim(file_name)) between 1 and 255),
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  version integer not null default 1 check (version > 0),
  is_current boolean not null default true,
  supersedes_document_id uuid references public.employee_documents(id) on delete set null,
  review_status text not null default 'RECEBIDO' check (review_status in ('RECEBIDO', 'CONFERIDO', 'REJEITADO')),
  notes text not null default '',
  uploaded_by uuid not null references public.profiles(id) on delete restrict,
  uploaded_by_name text not null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  deleted_by uuid references public.profiles(id) on delete set null,
  deleted_by_name text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_employees_active_name on public.employees(full_name) where status = 'ATIVO';
create index if not exists idx_employees_created_by on public.employees(created_by);
create index if not exists idx_employees_updated_by on public.employees(updated_by);
create index if not exists idx_employee_documents_employee_competence on public.employee_documents(employee_id, competence desc);
create index if not exists idx_employee_documents_competence_category on public.employee_documents(competence desc, category_id) where deleted_at is null and is_current;
create index if not exists idx_employee_documents_trash on public.employee_documents(deleted_at desc) where deleted_at is not null;
create index if not exists idx_employee_documents_uploaded_by on public.employee_documents(uploaded_by);
create index if not exists idx_employee_documents_reviewed_by on public.employee_documents(reviewed_by);
create index if not exists idx_employee_documents_deleted_by on public.employee_documents(deleted_by);
create index if not exists idx_employee_documents_supersedes on public.employee_documents(supersedes_document_id);
create unique index if not exists idx_employee_documents_version
  on public.employee_documents(employee_id, category_id, competence, lower(file_name), version);
create unique index if not exists idx_employee_documents_current
  on public.employee_documents(employee_id, category_id, competence, lower(file_name))
  where deleted_at is null and is_current;

insert into public.document_categories(id, label, monthly_required, active, sort_order) values
  ('PONTO', 'Folha de Ponto', true, true, 10),
  ('HOLERITE', 'Holerite', true, true, 20),
  ('RESCISAO', 'Rescisão', false, true, 30),
  ('ADMISSAO', 'Documentos de Admissão', false, true, 40),
  ('FERIAS', 'Férias', false, true, 50),
  ('ATESTADO', 'Atestado', false, true, 60),
  ('ASO', 'ASO', false, true, 70),
  ('OUTROS', 'Outros documentos', false, true, 100)
on conflict (id) do update set
  label = excluded.label,
  monthly_required = excluded.monthly_required,
  active = excluded.active,
  sort_order = excluded.sort_order;

alter table public.employees enable row level security;
alter table public.document_categories enable row level security;
alter table public.employee_documents enable row level security;

revoke all on public.employees, public.document_categories, public.employee_documents from anon, authenticated;
grant select, delete on public.employees to authenticated;
grant insert(full_name, cpf, registration, department, job_title, status) on public.employees to authenticated;
grant update(full_name, cpf, registration, department, job_title, status) on public.employees to authenticated;
grant select, insert, update, delete on public.document_categories to authenticated;
grant select, delete on public.employee_documents to authenticated;

create or replace function public.set_employee_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := (select auth.uid());
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_employee_audit_fields() from public, anon, authenticated;
drop trigger if exists employees_set_audit_fields on public.employees;
create trigger employees_set_audit_fields
before insert or update on public.employees
for each row execute function public.set_employee_audit_fields();

drop policy if exists employees_select on public.employees;
drop policy if exists employees_insert_rh on public.employees;
drop policy if exists employees_update_rh on public.employees;
drop policy if exists employees_delete_admin on public.employees;
create policy employees_select on public.employees for select to authenticated
  using ((select public.is_active_user()));
create policy employees_insert_rh on public.employees for insert to authenticated
  with check ((select public.is_rh_or_admin()) and created_by = (select auth.uid()));
create policy employees_update_rh on public.employees for update to authenticated
  using ((select public.is_rh_or_admin()))
  with check ((select public.is_rh_or_admin()));
create policy employees_delete_admin on public.employees for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists document_categories_select on public.document_categories;
drop policy if exists document_categories_insert_admin on public.document_categories;
drop policy if exists document_categories_update_admin on public.document_categories;
drop policy if exists document_categories_delete_admin on public.document_categories;
create policy document_categories_select on public.document_categories for select to authenticated
  using ((select public.is_active_user()));
create policy document_categories_insert_admin on public.document_categories for insert to authenticated
  with check ((select public.is_admin()));
create policy document_categories_update_admin on public.document_categories for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy document_categories_delete_admin on public.document_categories for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists employee_documents_select on public.employee_documents;
drop policy if exists employee_documents_insert_rh on public.employee_documents;
drop policy if exists employee_documents_update_rh on public.employee_documents;
drop policy if exists employee_documents_delete_admin on public.employee_documents;
create policy employee_documents_select on public.employee_documents for select to authenticated
  using (
    (select public.is_active_user())
    and (deleted_at is null or (select public.is_rh_or_admin()))
  );
create policy employee_documents_insert_rh on public.employee_documents for insert to authenticated
  with check (
    (select public.is_rh_or_admin())
    and uploaded_by = (select auth.uid())
    and uploaded_by_name = (select full_name from public.profiles where id = (select auth.uid()) and status = 'ATIVO')
  );
create policy employee_documents_update_rh on public.employee_documents for update to authenticated
  using ((select public.is_rh_or_admin()))
  with check ((select public.is_rh_or_admin()));
create policy employee_documents_delete_admin on public.employee_documents for delete to authenticated
  using ((select public.is_admin()));

create or replace function public.register_employee_document(
  p_id uuid,
  p_employee_id uuid,
  p_category_id text,
  p_competence date,
  p_title text,
  p_file_name text,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_notes text default ''
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_document public.employee_documents;
  inserted_document public.employee_documents;
  uploader_name text;
begin
  if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  if split_part(p_storage_path, '/', 1) <> p_employee_id::text then raise exception 'Caminho de armazenamento inválido'; end if;
  select full_name into uploader_name from public.profiles where id = (select auth.uid()) and status = 'ATIVO';
  if uploader_name is null then raise exception 'Usuário não aprovado'; end if;

  select * into previous_document
  from public.employee_documents
  where employee_id = p_employee_id
    and category_id = p_category_id
    and competence = p_competence
    and lower(file_name) = lower(p_file_name)
    and deleted_at is null
    and is_current
  for update;

  if found then
    update public.employee_documents
      set is_current = false, updated_at = now()
      where id = previous_document.id;
  end if;

  insert into public.employee_documents(
    id, employee_id, category_id, competence, title, file_name, storage_path,
    mime_type, size_bytes, sha256, version, is_current, supersedes_document_id,
    notes, uploaded_by, uploaded_by_name
  ) values (
    p_id, p_employee_id, p_category_id, p_competence, btrim(p_title), btrim(p_file_name), p_storage_path,
    coalesce(nullif(p_mime_type, ''), 'application/octet-stream'), p_size_bytes, lower(p_sha256),
    coalesce(previous_document.version, 0) + 1, true, previous_document.id,
    coalesce(btrim(p_notes), ''), (select auth.uid()), uploader_name
  ) returning * into inserted_document;

  return to_jsonb(inserted_document);
end;
$$;

create or replace function public.review_employee_document(p_document_id uuid, p_review_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result public.employee_documents; reviewer_name text;
begin
  if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  if p_review_status not in ('RECEBIDO', 'CONFERIDO', 'REJEITADO') then raise exception 'Situação inválida'; end if;
  select full_name into reviewer_name from public.profiles where id = (select auth.uid()) and status = 'ATIVO';
  update public.employee_documents set
    review_status = p_review_status,
    reviewed_by = case when p_review_status = 'RECEBIDO' then null else (select auth.uid()) end,
    reviewed_by_name = case when p_review_status = 'RECEBIDO' then null else reviewer_name end,
    reviewed_at = case when p_review_status = 'RECEBIDO' then null else now() end,
    updated_at = now()
  where id = p_document_id and deleted_at is null
  returning * into result;
  if not found then raise exception 'Documento não encontrado'; end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.trash_employee_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.employee_documents; replacement_id uuid; remover_name text; result public.employee_documents;
begin
  if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  select full_name into remover_name from public.profiles where id = (select auth.uid()) and status = 'ATIVO';
  select * into target from public.employee_documents where id = p_document_id for update;
  if not found or target.deleted_at is not null then raise exception 'Documento não encontrado'; end if;

  update public.employee_documents set
    deleted_at = now(), deleted_by = (select auth.uid()), deleted_by_name = remover_name,
    is_current = false, updated_at = now()
  where id = target.id returning * into result;

  if target.is_current then
    select id into replacement_id
    from public.employee_documents
    where employee_id = target.employee_id and category_id = target.category_id
      and competence = target.competence and lower(file_name) = lower(target.file_name)
      and id <> target.id and deleted_at is null
    order by version desc limit 1 for update;
    if replacement_id is not null then
      update public.employee_documents set is_current = true, updated_at = now() where id = replacement_id;
    end if;
  end if;
  return to_jsonb(result);
end;
$$;

create or replace function public.restore_employee_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare target public.employee_documents; result public.employee_documents;
begin
  if not public.is_rh_or_admin() then raise exception 'Acesso negado'; end if;
  select * into target from public.employee_documents where id = p_document_id for update;
  if not found or target.deleted_at is null then raise exception 'Documento não encontrado na lixeira'; end if;

  update public.employee_documents set is_current = false, updated_at = now()
  where employee_id = target.employee_id and category_id = target.category_id
    and competence = target.competence and lower(file_name) = lower(target.file_name)
    and deleted_at is null and is_current;

  update public.employee_documents set
    deleted_at = null, deleted_by = null, deleted_by_name = null,
    is_current = true, updated_at = now()
  where id = target.id returning * into result;
  return to_jsonb(result);
end;
$$;

revoke all on function public.register_employee_document(uuid, uuid, text, date, text, text, text, text, bigint, text, text) from public, anon, authenticated;
revoke all on function public.review_employee_document(uuid, text) from public, anon, authenticated;
revoke all on function public.trash_employee_document(uuid) from public, anon, authenticated;
revoke all on function public.restore_employee_document(uuid) from public, anon, authenticated;
grant execute on function public.register_employee_document(uuid, uuid, text, date, text, text, text, text, bigint, text, text) to authenticated;
grant execute on function public.review_employee_document(uuid, text) to authenticated;
grant execute on function public.trash_employee_document(uuid) to authenticated;
grant execute on function public.restore_employee_document(uuid) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit)
values ('employee-documents', 'employee-documents', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists employee_documents_storage_select on storage.objects;
drop policy if exists employee_documents_storage_insert on storage.objects;
drop policy if exists employee_documents_storage_delete on storage.objects;

create policy employee_documents_storage_select on storage.objects for select to authenticated
using (
  bucket_id = 'employee-documents'
  and (select public.is_active_user())
  and exists (
    select 1 from public.employee_documents document
    where document.storage_path = storage.objects.name
      and (document.deleted_at is null or (select public.is_rh_or_admin()))
  )
);

create policy employee_documents_storage_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'employee-documents'
  and (select public.is_rh_or_admin())
  and lower(storage.extension(name)) in ('pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'zip')
  and exists (
    select 1 from public.employees employee
    where employee.id::text = (storage.foldername(storage.objects.name))[1]
  )
);

create policy employee_documents_storage_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'employee-documents'
  and (
    (select public.is_admin())
    or (
      owner_id = (select auth.uid()::text)
      and not exists (
        select 1 from public.employee_documents document where document.storage_path = storage.objects.name
      )
    )
  )
);

comment on table public.employees is 'Funcionários cujos documentos trabalhistas são administrados pelo RH.';
comment on table public.document_categories is 'Tipos de documentos e obrigatoriedade mensal para auditoria.';
comment on table public.employee_documents is 'Metadados, versões, conferência e lixeira dos documentos no bucket privado employee-documents.';

commit;
