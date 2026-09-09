create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen timestamptz not null default now()
);

create index if not exists idx_user_presence_last_seen
  on public.user_presence(last_seen desc);

alter table public.user_presence enable row level security;
revoke all on public.user_presence from anon, authenticated;
grant select, insert, update, delete on public.user_presence to authenticated;

drop policy if exists presence_select on public.user_presence;
drop policy if exists presence_insert on public.user_presence;
drop policy if exists presence_update on public.user_presence;
drop policy if exists presence_delete on public.user_presence;

create policy presence_select on public.user_presence for select to authenticated
using (public.is_admin() or user_id = auth.uid());
create policy presence_insert on public.user_presence for insert to authenticated
with check (user_id = auth.uid() and public.is_active_user());

create policy presence_update on public.user_presence for update to authenticated
using (user_id = auth.uid() and public.is_active_user())
with check (user_id = auth.uid() and public.is_active_user());

create policy presence_delete on public.user_presence for delete to authenticated
using (user_id = auth.uid());

comment on table public.user_presence is
  'Heartbeat de sessão para indicar usuários online no painel administrativo.';
