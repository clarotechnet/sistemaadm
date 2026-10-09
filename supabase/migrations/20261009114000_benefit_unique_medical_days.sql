begin;

-- Quark pode retornar atestados com IDs distintos sobre a mesma faixa de datas.
-- Correção do cálculo futuro e dos fechamentos existentes.
CREATE OR REPLACE FUNCTION public.save_benefit_aggregation_month(p_actor uuid, p_competence date, p_events jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  actor public.profiles;
  month_start date := date_trunc('month', p_competence)::date;
  month_end date := (date_trunc('month', p_competence) + interval '1 month - 1 day')::date;
  item jsonb;
  base_row public.benefit_aggregation_base;
  event_type_value text;
  cpf_value text;
  start_value date;
  end_value date;
  days_value numeric;
  hours_value numeric;
  inserted_events integer := 0;
  monthly_count integer := 0;
begin
  if jsonb_typeof(p_events) <> 'array' then raise exception 'Eventos inválidos'; end if;
  select * into actor from public.profiles where id = p_actor and status = 'ATIVO';
  if actor.id is null or actor.role not in ('ADMINISTRADOR','RH') then raise exception 'Acesso negado'; end if;
  update public.benefit_aggregation_base b
     set employee_id = e.id, updated_at = now()
    from public.employees e
   where b.employee_id is null and b.cpf = e.cpf;

  delete from public.benefit_aggregation_events where competence = month_start;
  delete from public.benefit_aggregation_monthly where competence = month_start;

  for item in select value from jsonb_array_elements(p_events)
  loop
    cpf_value := regexp_replace(coalesce(item->>'cpf',''), '[^0-9]', '', 'g');
    event_type_value := upper(btrim(coalesce(item->>'event_type','')));
    if length(cpf_value) <> 11 or event_type_value not in ('FALTA','ATESTADO','FERIAS') then continue; end if;

    select * into base_row
      from public.benefit_aggregation_base
     where cpf = cpf_value
     limit 1;
    if base_row.id is null then continue; end if;

    start_value := case when coalesce(item->>'start_date','') ~ '^\d{4}-\d{2}-\d{2}$'
                        then (item->>'start_date')::date else month_start end;
    end_value := case when coalesce(item->>'end_date','') ~ '^\d{4}-\d{2}-\d{2}$'
                      then (item->>'end_date')::date else start_value end;
    start_value := greatest(start_value, month_start);
    end_value := least(end_value, month_end);
    if end_value < start_value then continue; end if;

    days_value := greatest(
      0,
      coalesce(
        nullif(item->>'days','')::numeric,
        (end_value - start_value + 1)::numeric
      )
    );
    hours_value := greatest(0, coalesce(nullif(item->>'hours','')::numeric, 0));

    insert into public.benefit_aggregation_events(
      competence, aggregation_id, employee_id, cpf, event_type, source, source_event_id,
      start_date, end_date, days, hours, description
    ) values (
      month_start, base_row.id, base_row.employee_id, cpf_value, event_type_value, 'QUARK',
      nullif(btrim(item->>'source_event_id'),''),
      start_value, end_value, least(days_value, 30), hours_value, btrim(coalesce(item->>'description',''))
    );

    inserted_events := inserted_events + 1;
  end loop;

  -- Cada dia civil só conta uma vez por tipo, mesmo com eventos Quark distintos/sobrepostos.
  -- Eventos originais continuam preservados para auditoria.
  with unique_event_days as (
    select distinct e.aggregation_id, e.event_type, calendar.day::date as event_day
      from public.benefit_aggregation_events e
      cross join lateral generate_series(e.start_date, e.end_date, interval '1 day') as calendar(day)
     where e.competence = month_start
       and e.event_type in ('ATESTADO', 'FERIAS')
  ),
  unique_event_totals as (
    select aggregation_id,
      least(30::numeric, count(*) filter (where event_type='ATESTADO')::numeric) as medical_days,
      least(30::numeric, count(*) filter (where event_type='FERIAS')::numeric) as vacation_days
      from unique_event_days
     group by aggregation_id
  ),
  event_totals as (
    select e.aggregation_id,
      least(30::numeric, coalesce(sum(e.days) filter (where e.event_type='FALTA'),0)) as absence_days,
      coalesce(u.medical_days,0) as medical_days,
      coalesce(u.vacation_days,0) as vacation_days
      from public.benefit_aggregation_events e
      left join unique_event_totals u on u.aggregation_id=e.aggregation_id
     where e.competence = month_start
     group by e.aggregation_id, u.medical_days, u.vacation_days
  ),
  prepared as (
    select
      b.id as aggregation_id,
      b.employee_id,
      b.cpf,
      b.employee_name,
      b.company,
      b.city,
      b.base_value,
      e.status,
      e.admission_date,
      e.termination_date,
      coalesce(t.absence_days,0) as absence_days,
      coalesce(t.medical_days,0) as medical_days,
      coalesce(t.vacation_days,0) as vacation_days,
      case
        when e.admission_date is not null and e.admission_date > month_end then 0::numeric
        when e.termination_date is not null and e.termination_date < month_start then 0::numeric
        when b.employee_id is null then 30::numeric
        else greatest(
          0::numeric,
          30::numeric
          - case
              when e.admission_date between month_start and month_end
              then least(30, greatest(0, extract(day from e.admission_date)::integer - 1))
              else 0
            end
          - case
              when e.termination_date between month_start and month_end
              then greatest(0, 30 - least(30, extract(day from e.termination_date)::integer))
              else 0
            end
        )
      end as employment_days
    from public.benefit_aggregation_base b
    left join public.employees e on e.id = b.employee_id
    left join event_totals t on t.aggregation_id = b.id
  )
  insert into public.benefit_aggregation_monthly(
    competence, aggregation_id, employee_id, cpf, employee_name, company, city, base_value,
    employment_status, admission_date, termination_date, absence_days, medical_days, vacation_days,
    employment_days, payable_days, amount_due, calculation_note, synced_at
  )
  select
    month_start,
    aggregation_id,
    employee_id,
    cpf,
    employee_name,
    company,
    city,
    base_value,
    case when status in ('ATIVO','DESLIGADO') then status else 'NAO_LOCALIZADO' end,
    admission_date,
    termination_date,
    absence_days,
    medical_days,
    vacation_days,
    employment_days,
    greatest(
      0::numeric,
      employment_days
      - vacation_days
      - case when (absence_days + medical_days) > 3 then (absence_days + medical_days) else 0 end
    ),
    case
      when vacation_days > 0 or employment_days < 30 then
        round(
          round(base_value / 30::numeric, 2)
          * greatest(
              0::numeric,
              employment_days
              - vacation_days
              - case when (absence_days + medical_days) > 3 then (absence_days + medical_days) else 0 end
            ),
          2
        )
      when (absence_days + medical_days) > 3 then
        greatest(
          0::numeric,
          base_value - round(round(base_value / 30::numeric, 2) * (absence_days + medical_days), 2)
        )
      else base_value
    end,
    case
      when vacation_days > 0 or employment_days < 30
        then 'Proporcional por férias/admissão/desligamento; faltas + atestados só descontam quando somam mais de 3 dias.'
      when (absence_days + medical_days) > 3
        then 'Faltas + atestados ultrapassaram 3 dias; desconto aplicado sobre todos os dias acumulados usando o valor diário arredondado.'
      when (absence_days + medical_days) > 0
        then 'Faltas + atestados somam até 3 dias; sem desconto conforme a regra do benefício.'
      else 'Valor base integral.'
    end,
    now()
  from prepared;

  get diagnostics monthly_count = row_count;

  return jsonb_build_object(
    'events', inserted_events,
    'rows', monthly_count,
    'competence', to_char(month_start,'YYYY-MM')
  );
end;
$function$;


-- Conserta somente competências já gravadas com contagem divergente.
-- UPDATE dispara o trigger existente, recalculando payable_days/amount_due
-- e preservando manutenção de veículo, emprego e demais ocorrências.
with calendar_days as (
  select distinct e.competence, e.aggregation_id, e.event_type, days.day::date as day
    from public.benefit_aggregation_events e
    cross join lateral generate_series(e.start_date,e.end_date,interval '1 day') as days(day)
   where e.event_type in ('ATESTADO','FERIAS')
),
corrected as (
  select competence,aggregation_id,
         least(30::numeric,count(*) filter(where event_type='ATESTADO')::numeric) as medical_days,
         least(30::numeric,count(*) filter(where event_type='FERIAS')::numeric) as vacation_days
    from calendar_days
   group by competence,aggregation_id
)
update public.benefit_aggregation_monthly m
   set medical_days = c.medical_days, vacation_days = c.vacation_days
  from corrected c
 where m.competence=c.competence and m.aggregation_id=c.aggregation_id
   and (m.medical_days is distinct from c.medical_days
     or m.vacation_days is distinct from c.vacation_days);

comment on function public.save_benefit_aggregation_month(uuid,date,jsonb)
  is 'Salva eventos Quark preservando IDs para auditoria; conta datas únicas de atestados e férias por empregado, evitando duplicação de dias sobrepostos.';

commit;
