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
