alter table public.payroll_records add column if not exists audit_data jsonb;
comment on column public.payroll_records.audit_data is 'Detalhes opcionais da planilha para conferência. NULL identifica importações legadas sem estes detalhes.';

-- Preserve the deployed RPC's business rules (including invalidating old plan
-- comparisons). Extend only its existing recordset; keep the same signature.
do $migration$
declare
  original text;
  updated text;
begin
  select replace(pg_get_functiondef('public.save_payroll_month(text,text,bigint,jsonb,jsonb)'::regprocedure), E'\r', '') into original;
  if position('audit_data' in original) = 0 then
    updated := replace(original, 'health_columns,dental_columns,source_sheet', 'health_columns,dental_columns,source_sheet,audit_data');
    updated := replace(updated, 'coalesce(x.source_sheet,'''')', 'coalesce(x.source_sheet,''''),x.audit_data');
    updated := replace(updated, 'source_sheet text', 'source_sheet text,audit_data jsonb');
    if updated = original or position('x.audit_data' in updated) = 0 then
      raise exception 'Estrutura inesperada em save_payroll_month. Revise antes de aplicar.';
    end if;
    execute updated;
  end if;
end;
$migration$;

create table if not exists public.payroll_audit_reviews (
  current_import_id uuid not null references public.payroll_imports(id) on delete cascade,
  previous_competence text not null default '',
  revision_key text not null check (length(revision_key)=64),
  employee_key text not null,
  rule_code text not null,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','EM_ANALISE','JUSTIFICADA','CORRIGIDA','IGNORADA')),
  notes text not null default '' check (length(notes)<=4000),
  updated_by uuid not null default auth.uid() references public.profiles(id),
  updated_by_name text not null default '',
  updated_at timestamptz not null default now(),
  primary key (current_import_id,previous_competence,revision_key,employee_key,rule_code),
  check (status not in ('JUSTIFICADA','CORRIGIDA','IGNORADA') or length(btrim(notes))>=3)
);
create index if not exists idx_payroll_audit_reviews_actor on public.payroll_audit_reviews(updated_by);
alter table public.payroll_audit_reviews enable row level security;
revoke all on public.payroll_audit_reviews from anon, authenticated;
grant select,insert,update on public.payroll_audit_reviews to authenticated;

create policy payroll_audit_reviews_read on public.payroll_audit_reviews for select to authenticated
using ((select public.is_rh_or_admin()));
create policy payroll_audit_reviews_insert on public.payroll_audit_reviews for insert to authenticated
with check ((select public.is_rh_or_admin()) and updated_by=(select auth.uid()));
create policy payroll_audit_reviews_update on public.payroll_audit_reviews for update to authenticated
using ((select public.is_rh_or_admin()))
with check ((select public.is_rh_or_admin()) and updated_by=(select auth.uid()));

create or replace function public.stamp_payroll_audit_review() returns trigger
language plpgsql security invoker set search_path='' as $function$
begin
  new.updated_by := auth.uid();
  select full_name into new.updated_by_name from public.profiles where id=auth.uid();
  new.updated_at := now();
  return new;
end;
$function$;
revoke all on function public.stamp_payroll_audit_review() from public,anon,authenticated;
create trigger stamp_payroll_audit_review before insert or update on public.payroll_audit_reviews
for each row execute function public.stamp_payroll_audit_review();
comment on table public.payroll_audit_reviews is 'Tratamento de achados por revisão de folha, sem copiar ou alterar valores financeiros.';
