begin;

create table if not exists public.benefit_vehicle_registry (
  id uuid primary key default gen_random_uuid(),
  aggregation_id uuid unique references public.benefit_aggregation_base(id) on delete cascade,
  employee_name text not null default '',
  cpf text not null,
  company text not null default '',
  city text not null default '',
  base_value numeric(12,2) not null default 0 check (base_value >= 0),
  plate text not null default '',
  vehicle_year integer check (vehicle_year is null or (vehicle_year between 1900 and 2200)),
  vehicle_model text not null default '',
  source text not null default 'MANUAL' check (source in ('BASE','MANUAL')),
  excluded boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint benefit_vehicle_registry_cpf_check check (cpf ~ '^[0-9]{11}$')
);

create unique index if not exists uq_benefit_vehicle_registry_cpf on public.benefit_vehicle_registry(cpf);
create index if not exists idx_benefit_vehicle_registry_filters on public.benefit_vehicle_registry(company, city, vehicle_year);

create or replace function public.set_benefit_vehicle_audit_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.cpf := regexp_replace(coalesce(new.cpf,''), '[^0-9]', '', 'g');
  if length(new.cpf) <> 11 then raise exception 'CPF inválido'; end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := coalesce(new.created_at, now());
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce((select auth.uid()), new.updated_by, new.created_by);
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_benefit_vehicle_audit_fields() from public, anon, authenticated;
drop trigger if exists benefit_vehicle_registry_set_audit on public.benefit_vehicle_registry;
create trigger benefit_vehicle_registry_set_audit
before insert or update on public.benefit_vehicle_registry
for each row execute function public.set_benefit_vehicle_audit_fields();

alter table public.benefit_vehicle_registry enable row level security;
revoke all on public.benefit_vehicle_registry from anon, authenticated;
grant select, insert, update, delete on public.benefit_vehicle_registry to authenticated;

drop policy if exists benefit_vehicle_registry_select on public.benefit_vehicle_registry;
create policy benefit_vehicle_registry_select on public.benefit_vehicle_registry for select to authenticated using ((select public.is_rh_or_admin()));
drop policy if exists benefit_vehicle_registry_insert on public.benefit_vehicle_registry;
create policy benefit_vehicle_registry_insert on public.benefit_vehicle_registry for insert to authenticated with check ((select public.is_rh_or_admin()));
drop policy if exists benefit_vehicle_registry_update on public.benefit_vehicle_registry;
create policy benefit_vehicle_registry_update on public.benefit_vehicle_registry for update to authenticated using ((select public.is_rh_or_admin())) with check ((select public.is_rh_or_admin()));
drop policy if exists benefit_vehicle_registry_delete on public.benefit_vehicle_registry;
create policy benefit_vehicle_registry_delete on public.benefit_vehicle_registry for delete to authenticated using ((select public.is_rh_or_admin()));

commit;
