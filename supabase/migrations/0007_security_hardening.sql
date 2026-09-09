-- Reduz a superfície das funções SECURITY DEFINER e melhora os índices das FKs.
-- Pode ser aplicado depois das migrations 0001-0006 sem perder dados.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
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

create or replace function public.current_profile_role()
returns text language sql stable security definer set search_path='' as $$
  select role from public.profiles where id=(select auth.uid()) and status='ATIVO';
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and status='ATIVO');
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.current_profile_role()='ADMINISTRADOR', false);
$$;

create or replace function public.is_rh_or_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(public.current_profile_role() in ('ADMINISTRADOR','RH'), false);
$$;

create or replace function public.admin_update_profile(target_id uuid, new_role text default null, new_status text default null)
returns jsonb
language plpgsql security definer set search_path='' as $$
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

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_rh_or_admin() from public, anon, authenticated;
revoke all on function public.admin_update_profile(uuid,text,text) from public, anon, authenticated;

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
