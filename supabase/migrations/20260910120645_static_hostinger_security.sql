-- Permite que a SPA estática use o bucket privado sem expor a service role.
-- Cada usuário acessa somente os próprios objetos; administradores ativos
-- podem consultar e remover objetos para cumprir a política de retenção.

drop policy if exists rh_private_files_select on storage.objects;
drop policy if exists rh_private_files_insert on storage.objects;
drop policy if exists rh_private_files_delete on storage.objects;

create policy rh_private_files_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'rh-private-files'
  and (
    owner_id = (select auth.uid()::text)
    or public.is_admin()
  )
);

create policy rh_private_files_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'rh-private-files'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and public.is_active_user()
);

create policy rh_private_files_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'rh-private-files'
  and (
    owner_id = (select auth.uid()::text)
    or public.is_admin()
  )
);
