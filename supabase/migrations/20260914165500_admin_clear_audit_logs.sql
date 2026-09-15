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
  if not public.is_admin() then
    raise exception 'Acesso negado';
  end if;

  select * into actor
  from public.profiles
  where id=(select auth.uid()) and status='ATIVO';

  if actor.id is null then
    raise exception 'Administrador ativo não encontrado';
  end if;

  delete from public.audit_logs where id is not null;
  get diagnostics removed_count = row_count;

  insert into public.audit_logs(id,user_id,user_name,operation,module,result,status,created_at)
  values (gen_random_uuid(),actor.id,actor.full_name,'Limpou histórico de auditoria','Histórico',removed_count || ' registro(s) anterior(es) removido(s).','AVISO',now());

  return removed_count;
end;
$$;

revoke all on function public.admin_clear_audit_logs() from public,anon,authenticated;
grant execute on function public.admin_clear_audit_logs() to authenticated;

-- Defesa em profundidade: ninguém apaga audit_logs diretamente pelo cliente.
revoke delete, update, truncate on table public.audit_logs from authenticated;
grant select, insert on table public.audit_logs to authenticated;

