begin;

-- Novos cadastros nunca se autoaprovam nem se tornam administradores.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id,email,full_name,department,job_title,role,status)
  values (
    new.id,
    lower(coalesce(new.email,'')),
    coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)),
    coalesce(new.raw_user_meta_data->>'department',''),
    coalesce(new.raw_user_meta_data->>'job_title',''),
    'CONSULTA',
    'AGUARDANDO APROVAÇÃO'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- Perfil próprio só pode alterar campos não privilegiados via RPC dedicado.
create or replace function public.update_own_profile(
  p_full_name text,
  p_department text,
  p_job_title text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  result public.profiles;
begin
  if uid is null then raise exception 'Não autenticado'; end if;

  update public.profiles
     set full_name = left(btrim(coalesce(p_full_name,'')), 160),
         department = left(btrim(coalesce(p_department,'')), 120),
         job_title = left(btrim(coalesce(p_job_title,'')), 120),
         updated_at = now()
   where id = uid
     and status <> 'BLOQUEADO'
  returning * into result;

  if not found then raise exception 'Perfil indisponível para atualização'; end if;
  return to_jsonb(result);
end;
$$;

revoke all on function public.update_own_profile(text,text,text) from public, anon, authenticated;
grant execute on function public.update_own_profile(text,text,text) to authenticated;

-- Defesa extra: mesmo se permissões de coluna forem ampliadas no futuro,
-- usuários comuns não podem alterar identidade, papel ou aprovação.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and not public.is_admin()
     and (
       new.id is distinct from old.id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.created_at is distinct from old.created_at
     )
  then
    raise exception 'Campos privilegiados do perfil só podem ser alterados por administrador ativo';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_profile_privileged_fields() from public, anon, authenticated;

drop trigger if exists protect_profile_privileged_fields on public.profiles;
create trigger protect_profile_privileged_fields
before update on public.profiles
for each row execute function public.protect_profile_privileged_fields();

-- Remove atualização direta da tabela pelo papel authenticated.
revoke update on public.profiles from authenticated;
drop policy if exists profiles_update_self on public.profiles;

comment on function public.handle_new_user()
  is 'Cria toda nova conta como CONSULTA e AGUARDANDO APROVAÇÃO; nunca autoaprova.';
comment on function public.update_own_profile(text,text,text)
  is 'Permite ao usuário autenticado atualizar apenas nome, setor e cargo do próprio perfil.';
comment on function public.protect_profile_privileged_fields()
  is 'Bloqueia escalonamento de privilégio por atualização direta de role/status/email/id.';

commit;
