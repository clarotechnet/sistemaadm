insert into public.roles(name,description) values
('ADMINISTRADOR','Acesso total ao RH Control'),
('RH','Operação de folha, benefícios, PDFs, relatórios e histórico'),
('CONSULTA','Acesso de consulta a relatórios e ao próprio histórico')
on conflict (name) do update set description=excluded.description;

insert into public.permissions(key,description) values
('users.manage','Gerenciar usuários, papéis e aprovações'),
('payroll.manage','Importar e processar folha de pagamento'),
('benefits.manage','Processar benefícios e comparativos'),
('pdf.manage','Processar ferramentas de PDF'),
('reports.read','Consultar relatórios'),
('audit.read','Consultar histórico de auditoria'),
('settings.manage','Gerenciar configurações administrativas')
on conflict (key) do update set description=excluded.description;
insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r cross join public.permissions p
where r.name='ADMINISTRADOR'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p
  on p.key in ('payroll.manage','benefits.manage','pdf.manage','reports.read','audit.read')
where r.name='RH'
on conflict do nothing;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id from public.roles r join public.permissions p
  on p.key in ('reports.read','audit.read')
where r.name='CONSULTA'
on conflict do nothing;
