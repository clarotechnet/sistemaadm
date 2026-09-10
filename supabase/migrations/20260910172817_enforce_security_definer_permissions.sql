-- Mantem as funcoes SECURITY DEFINER protegidas mesmo quando migrations
-- anteriores foram executadas manualmente pelo SQL Editor.
-- Funcoes usadas por RLS/RPC continuam disponiveis apenas para authenticated;
-- funcoes exclusivas de triggers nao podem ser chamadas diretamente.

alter function public.handle_new_user() set search_path = '';
alter function public.current_profile_role() set search_path = '';
alter function public.is_active_user() set search_path = '';
alter function public.is_admin() set search_path = '';
alter function public.is_rh_or_admin() set search_path = '';
alter function public.admin_update_profile(uuid, text, text) set search_path = '';

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon, authenticated;
revoke all on function public.is_active_user() from public, anon, authenticated;
revoke all on function public.is_admin() from public, anon, authenticated;
revoke all on function public.is_rh_or_admin() from public, anon, authenticated;
revoke all on function public.admin_update_profile(uuid, text, text) from public, anon, authenticated;

grant execute on function public.current_profile_role() to authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_rh_or_admin() to authenticated;
grant execute on function public.admin_update_profile(uuid, text, text) to authenticated;

-- Este event-trigger existe no banco publicado, mas nao faz parte de toda
-- instalacao local. A checagem deixa a migration portavel e idempotente.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
