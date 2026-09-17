begin;

create temp table _quark_employee_merge on commit drop as
select
  m.id as keep_id,
  q.id as remove_id,
  q.full_name,
  q.document_number,
  q.registration,
  q.department,
  q.job_title,
  q.status,
  q.external_id,
  q.external_unit_id,
  q.external_unit_name,
  q.external_team_id,
  q.external_team_name,
  q.admission_date,
  q.termination_date,
  q.last_synced_at,
  q.updated_by
from public.employees m
join public.employees q
  on upper(btrim(m.full_name)) = upper(btrim(q.full_name))
where m.source = 'MANUAL'
  and q.source = 'QUARK'
  and m.cpf <> ''
  and m.cpf = lpad(regexp_replace(q.document_number, '[^0-9]', '', 'g'), 11, '0');
update public.employee_documents d
set employee_id = p.keep_id,
    updated_at = now()
from _quark_employee_merge p
where d.employee_id = p.remove_id;

delete from public.employees e
using _quark_employee_merge p
where e.id = p.remove_id;

update public.employees e
set source = 'QUARK',
    external_id = p.external_id,
    external_unit_id = p.external_unit_id,
    external_unit_name = p.external_unit_name,
    external_team_id = p.external_team_id,
    external_team_name = p.external_team_name,
    document_number = case when p.document_number <> '' then p.document_number else e.document_number end,
    full_name = p.full_name,
    registration = case when p.registration <> '' then p.registration else e.registration end,
    department = case when p.department <> '' then p.department else e.department end,
    job_title = case when p.job_title <> '' then p.job_title else e.job_title end,
    status = p.status,
    admission_date = coalesce(p.admission_date, e.admission_date),
    termination_date = p.termination_date,
    last_synced_at = p.last_synced_at,
    updated_by = coalesce(p.updated_by, e.updated_by),
    updated_at = now()
from _quark_employee_merge p
where e.id = p.keep_id;

commit;
