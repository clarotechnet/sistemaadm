insert into public.profiles(id,email,full_name,department,job_title,role,status,created_at,updated_at)
select u.id, lower(coalesce(u.email,'')),
       coalesce(u.raw_user_meta_data->>'full_name', split_part(coalesce(u.email,''),'@',1)),
       coalesce(u.raw_user_meta_data->>'department',''),
       coalesce(u.raw_user_meta_data->>'job_title',''),
       'CONSULTA','AGUARDANDO APROVAÇÃO',u.created_at,now()
from auth.users u
where not exists(select 1 from public.profiles p where p.id=u.id)
on conflict (id) do nothing;

with first_profile as (
  select p.id from public.profiles p
  order by p.created_at asc, p.id asc limit 1
)
update public.profiles p
set role='ADMINISTRADOR', status='ATIVO', updated_at=now()
where p.id=(select id from first_profile)
  and not exists(select 1 from public.profiles x where x.role='ADMINISTRADOR' and x.status='ATIVO');
