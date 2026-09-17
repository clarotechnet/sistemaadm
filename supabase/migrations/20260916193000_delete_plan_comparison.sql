create or replace function public.delete_payroll_comparison(
  p_payroll_import_id uuid,
  p_kind text
) returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if not public.is_rh_or_admin() then
    raise exception 'Acesso negado';
  end if;
  if p_kind not in ('health','dental') then
    raise exception 'Tipo de comparativo inválido';
  end if;

  delete from public.payroll_comparisons
  where payroll_import_id=p_payroll_import_id
    and kind=p_kind;

  return found;
end;
$$;

revoke all on function public.delete_payroll_comparison(uuid,text)
from public,anon,authenticated;
grant execute on function public.delete_payroll_comparison(uuid,text)
to authenticated;
