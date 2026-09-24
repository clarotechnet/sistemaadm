begin;

-- Dados pessoais/documentais de RH não ficam visíveis para perfis CONSULTA.
drop policy if exists employees_select on public.employees;
create policy employees_select
on public.employees for select to authenticated
using ((select public.is_rh_or_admin()));

drop policy if exists employee_documents_select on public.employee_documents;
create policy employee_documents_select
on public.employee_documents for select to authenticated
using ((select public.is_rh_or_admin()) and ((deleted_at is null) or (select public.is_rh_or_admin())));

drop policy if exists document_categories_select on public.document_categories;
create policy document_categories_select
on public.document_categories for select to authenticated
using ((select public.is_rh_or_admin()));

drop policy if exists employee_sync_runs_select on public.employee_sync_runs;
create policy employee_sync_runs_select
on public.employee_sync_runs for select to authenticated
using ((select public.is_rh_or_admin()));

drop policy if exists employee_documents_storage_select on storage.objects;
create policy employee_documents_storage_select
on storage.objects for select to authenticated
using (
  bucket_id='employee-documents'
  and (select public.is_rh_or_admin())
  and exists (
    select 1
    from public.employee_documents document
    where document.storage_path=objects.name
      and (document.deleted_at is null or (select public.is_rh_or_admin()))
  )
);

commit;
