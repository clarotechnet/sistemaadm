-- RH Control: dias automaticos da frota, preservando ajustes manuais e calculo atual.
-- Sem CPFs de colaboradores ou credenciais no arquivo de migration.
BEGIN;
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS rh_frota_private;
REVOKE ALL ON SCHEMA rh_frota_private FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA rh_frota_private TO authenticated,service_role;

CREATE TABLE rh_frota_private.config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  publishable_key text NOT NULL,
  integration_token text NOT NULL DEFAULT replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','')
    CHECK (integration_token ~ '^[0-9a-f]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rh_frota_private.config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rh_frota_private.config FROM PUBLIC,anon,authenticated;
COMMENT ON TABLE rh_frota_private.config IS 'Credencial restrita da conexao Frota; nunca vai para o navegador.';

CREATE TABLE public.benefit_aggregation_fleet_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  competence date NOT NULL CHECK (extract(day FROM competence)=1),
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCESS','ERROR')),
  triggered_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  triggered_by_name text NOT NULL,
  processed_count integer NOT NULL DEFAULT 0,
  manual_preserved_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  unlinked_count integer NOT NULL DEFAULT 0,
  blocked_count integer NOT NULL DEFAULT 0,
  source_as_of date,
  warning_message text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX benefit_fleet_runs_competence_idx ON public.benefit_aggregation_fleet_sync_runs(competence,started_at DESC);
CREATE INDEX benefit_fleet_runs_actor_idx ON public.benefit_aggregation_fleet_sync_runs(triggered_by);

CREATE TABLE public.benefit_aggregation_fleet_days (
  competence date NOT NULL CHECK (extract(day FROM competence)=1),
  aggregation_id uuid NOT NULL REFERENCES public.benefit_aggregation_base(id) ON DELETE CASCADE,
  days integer NOT NULL CHECK (days BETWEEN 0 AND 30),
  run_id uuid NOT NULL REFERENCES public.benefit_aggregation_fleet_sync_runs(id) ON DELETE RESTRICT,
  source_as_of date NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competence,aggregation_id)
);
CREATE INDEX benefit_fleet_days_aggregation_idx ON public.benefit_aggregation_fleet_days(aggregation_id);
CREATE INDEX benefit_fleet_days_run_idx ON public.benefit_aggregation_fleet_days(run_id);
ALTER TABLE public.benefit_aggregation_fleet_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.benefit_aggregation_fleet_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.benefit_aggregation_fleet_days,public.benefit_aggregation_fleet_sync_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.benefit_aggregation_fleet_days,public.benefit_aggregation_fleet_sync_runs TO authenticated;
GRANT ALL ON public.benefit_aggregation_fleet_days,public.benefit_aggregation_fleet_sync_runs TO service_role;
CREATE POLICY benefit_fleet_days_read ON public.benefit_aggregation_fleet_days
FOR SELECT TO authenticated USING ((SELECT public.is_rh_or_admin()));
CREATE POLICY benefit_fleet_runs_read ON public.benefit_aggregation_fleet_sync_runs
FOR SELECT TO authenticated USING ((SELECT public.is_rh_or_admin()));

-- Preserva valores manuais antigos que porventura nao possuam a linha de override.
INSERT INTO public.benefit_aggregation_monthly_overrides(competence,aggregation_id,maintenance_vehicle_days)
SELECT m.competence,m.aggregation_id,m.maintenance_vehicle_days FROM public.benefit_aggregation_monthly m
WHERE m.maintenance_vehicle_days<>0
ON CONFLICT (competence,aggregation_id) DO NOTHING;

CREATE FUNCTION rh_frota_private.select_maintenance_source()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE v_manual integer; v_auto integer;
BEGIN
  SELECT o.maintenance_vehicle_days INTO v_manual
  FROM public.benefit_aggregation_monthly_overrides o
  WHERE o.competence=NEW.competence AND o.aggregation_id=NEW.aggregation_id;
  SELECT f.days INTO v_auto FROM public.benefit_aggregation_fleet_days f
  WHERE f.competence=NEW.competence AND f.aggregation_id=NEW.aggregation_id;
  NEW.maintenance_vehicle_days:=coalesce(v_manual,v_auto,0);
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION rh_frota_private.select_maintenance_source() FROM PUBLIC,anon,authenticated;
-- Ordem alfabetica: escolhe a fonte ANTES do trigger financeiro existente.
CREATE TRIGGER benefit_aggregation_monthly_00_fleet_source
BEFORE INSERT OR UPDATE ON public.benefit_aggregation_monthly
FOR EACH ROW EXECUTE FUNCTION rh_frota_private.select_maintenance_source();

CREATE FUNCTION rh_frota_private.assert_actor()
RETURNS public.profiles LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE v_actor public.profiles;
BEGIN
  SELECT * INTO v_actor FROM public.profiles p WHERE p.id=auth.uid() AND p.status='ATIVO'
    AND p.role IN ('ADMINISTRADOR','RH');
  IF auth.uid() IS NULL OR v_actor.id IS NULL THEN
    RAISE EXCEPTION 'Acesso negado' USING ERRCODE='42501';
  END IF;
  RETURN v_actor;
END;
$fn$;
REVOKE ALL ON FUNCTION rh_frota_private.assert_actor() FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rh_frota_private.fetch_days(p_competence date)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path='' AS $fn$
DECLARE v_config rh_frota_private.config; v_status integer; v_content text; v_result jsonb;
BEGIN
  SELECT * INTO v_config FROM rh_frota_private.config c WHERE c.id AND c.enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conexao com a Frota nao configurada'; END IF;
  PERFORM set_config('http.curlopt_timeout_ms','5000',true);
  PERFORM set_config('http.curlopt_connecttimeout_ms','2000',true);
  SELECT h.status,h.content INTO v_status,v_content FROM extensions.http((
    'POST','https://nnnxoahckszsgtsfbsdx.supabase.co/rest/v1/rpc/fc_export_rh_maintenance',
    ARRAY[extensions.http_header('apikey',v_config.publishable_key),
      extensions.http_header('X-Frota-Integration-Key',v_config.integration_token)],
    'application/json',jsonb_build_object('p_competence',p_competence)::text
  )::extensions.http_request) h;
  IF v_status IS DISTINCT FROM 200 THEN RAISE EXCEPTION 'Frota respondeu HTTP %',v_status; END IF;
  IF v_content IS NULL OR octet_length(v_content)>2000000 THEN RAISE EXCEPTION 'Resposta vazia ou muito grande da Frota'; END IF;
  v_result:=v_content::jsonb;
  IF v_result->>'schema_version' IS DISTINCT FROM '1' OR v_result->>'competence' IS DISTINCT FROM to_char(p_competence,'YYYY-MM')
     OR jsonb_typeof(v_result->'rows') IS DISTINCT FROM 'array'
     OR jsonb_typeof(v_result->'blocked_cpfs') IS DISTINCT FROM 'array'
     OR coalesce(v_result->>'as_of','') !~ '^\d{4}-\d{2}-\d{2}$'
     OR (v_result->>'as_of')::date>(now() AT TIME ZONE 'America/Fortaleza')::date
     OR jsonb_array_length(v_result->'rows')>10000
     OR jsonb_array_length(v_result->'blocked_cpfs')>10000
     OR coalesce(v_result->>'unlinked_count','') !~ '^\d{1,7}$' THEN
    RAISE EXCEPTION 'Resposta invalida da Frota';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') x
    WHERE coalesce(x->>'cpf','') !~ '^[0-9]{11}$' OR coalesce(x->>'days','') !~ '^(0|[1-9]|[12][0-9]|30)$')
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'rows') x GROUP BY x->>'cpf' HAVING count(*)>1)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_result->'blocked_cpfs') x WHERE x IS NULL OR x !~ '^[0-9]{11}$') THEN
    RAISE EXCEPTION 'Dias ou CPFs invalidos na resposta da Frota';
  END IF;
  RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION rh_frota_private.fetch_days(date) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION rh_frota_private.sync_days(p_competence date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_actor public.profiles; v_month date:=date_trunc('month',p_competence)::date;
  v_run uuid; v_data jsonb; v_count integer:=0; v_manual integer:=0; v_unmatched integer:=0;
  v_blocked integer:=0; v_missing integer:=0; v_warning text:='';
BEGIN
  v_actor:=rh_frota_private.assert_actor();
  IF p_competence IS NULL OR v_month>(now() AT TIME ZONE 'America/Fortaleza')::date THEN
    RAISE EXCEPTION 'Competencia invalida ou futura' USING ERRCODE='22023';
  END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('frota-rh:'||v_month::text,0)) THEN
    RAISE EXCEPTION 'Outra atualizacao da Frota esta em andamento' USING ERRCODE='55P03';
  END IF;
  INSERT INTO public.benefit_aggregation_fleet_sync_runs(competence,status,triggered_by,triggered_by_name)
  VALUES(v_month,'RUNNING',v_actor.id,v_actor.full_name) RETURNING id INTO v_run;
  BEGIN
    v_data:=rh_frota_private.fetch_days(v_month);
    -- Reconfere o perfil atual antes de aplicar, depois da consulta de rede.
    PERFORM rh_frota_private.assert_actor();
    v_missing:=greatest(0,coalesce((v_data->>'unlinked_count')::integer,0));
    SELECT count(*)::integer INTO v_unmatched FROM jsonb_array_elements(v_data->'rows') x
      WHERE NOT EXISTS(SELECT 1 FROM public.benefit_aggregation_base b WHERE b.cpf=x->>'cpf');
    SELECT count(*)::integer INTO v_blocked FROM public.benefit_aggregation_base b
      WHERE (v_data->'blocked_cpfs') ? b.cpf;
    WITH incoming AS (
      SELECT x->>'cpf' AS cpf,(x->>'days')::integer AS days FROM jsonb_array_elements(v_data->'rows') x
    ), targets AS (
      SELECT b.id,coalesce(i.days,0) AS days FROM public.benefit_aggregation_base b
      LEFT JOIN incoming i ON i.cpf=b.cpf
      WHERE NOT ((v_data->'blocked_cpfs') ? b.cpf)
        AND (i.cpf IS NOT NULL OR EXISTS(SELECT 1 FROM public.benefit_aggregation_fleet_days f
          WHERE f.competence=v_month AND f.aggregation_id=b.id))
    )
    INSERT INTO public.benefit_aggregation_fleet_days(competence,aggregation_id,days,run_id,source_as_of,synced_at)
    SELECT v_month,t.id,t.days,v_run,(v_data->>'as_of')::date,now() FROM targets t
    ON CONFLICT(competence,aggregation_id) DO UPDATE SET days=EXCLUDED.days,run_id=EXCLUDED.run_id,
      source_as_of=EXCLUDED.source_as_of,synced_at=EXCLUDED.synced_at;
    GET DIAGNOSTICS v_count=ROW_COUNT;
    SELECT count(*)::integer INTO v_manual FROM public.benefit_aggregation_monthly_overrides o
    JOIN public.benefit_aggregation_fleet_days f ON f.competence=o.competence AND f.aggregation_id=o.aggregation_id
    WHERE f.competence=v_month AND f.run_id=v_run;
    UPDATE public.benefit_aggregation_monthly m SET maintenance_vehicle_days=m.maintenance_vehicle_days
    WHERE m.competence=v_month AND EXISTS(SELECT 1 FROM public.benefit_aggregation_fleet_days f
      WHERE f.competence=m.competence AND f.aggregation_id=m.aggregation_id AND f.run_id=v_run);
    IF v_missing>0 THEN v_warning:=v_warning||format('%s retirada(s) antiga(s) precisam de vinculo com o tecnico no Frota. ',v_missing); END IF;
    IF v_blocked>0 THEN v_warning:=v_warning||format('%s colaborador(es) com movimentacao conflitante; dias anteriores preservados. ',v_blocked); END IF;
    IF v_unmatched>0 THEN v_warning:=v_warning||format('%s CPF(s) da Frota nao estao na base de agregamento. ',v_unmatched); END IF;
    UPDATE public.benefit_aggregation_fleet_sync_runs SET status='SUCCESS',processed_count=v_count,
      manual_preserved_count=v_manual,unmatched_count=v_unmatched,unlinked_count=v_missing,blocked_count=v_blocked,
      source_as_of=(v_data->>'as_of')::date,warning_message=nullif(btrim(v_warning),''),completed_at=now() WHERE id=v_run;
    RETURN jsonb_build_object('ok',true,'rows',v_count,'manual_preserved',v_manual,'unlinked',v_missing,
      'unmatched',v_unmatched,'blocked',v_blocked,'warning',nullif(btrim(v_warning),''),'source_as_of',v_data->>'as_of');
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.benefit_aggregation_fleet_sync_runs SET status='ERROR',
      error_message='Nao foi possivel consultar ou validar os dados da Frota. Os dias anteriores foram mantidos.',
      completed_at=now() WHERE id=v_run;
    RETURN jsonb_build_object('ok',false,'error','Nao foi possivel atualizar pela Frota. Os dias anteriores foram mantidos.');
  END;
END;
$fn$;
REVOKE ALL ON FUNCTION rh_frota_private.sync_days(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rh_frota_private.sync_days(date) TO authenticated;
CREATE FUNCTION public.sync_benefit_frota_maintenance(p_competence date)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT rh_frota_private.sync_days(p_competence);
$fn$;
REVOKE ALL ON FUNCTION public.sync_benefit_frota_maintenance(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.sync_benefit_frota_maintenance(date) TO authenticated;

CREATE FUNCTION rh_frota_private.use_frota(p_competence date,p_aggregation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_month date:=date_trunc('month',p_competence)::date;
BEGIN
  PERFORM rh_frota_private.assert_actor();
  IF NOT EXISTS(SELECT 1 FROM public.benefit_aggregation_fleet_days f
    WHERE f.competence=v_month AND f.aggregation_id=p_aggregation_id) THEN
    RAISE EXCEPTION 'Atualize a Frota antes de usar os dias automaticos' USING ERRCODE='22023';
  END IF;
  DELETE FROM public.benefit_aggregation_monthly_overrides o WHERE o.competence=v_month AND o.aggregation_id=p_aggregation_id;
  UPDATE public.benefit_aggregation_monthly m SET maintenance_vehicle_days=m.maintenance_vehicle_days
  WHERE m.competence=v_month AND m.aggregation_id=p_aggregation_id;
END;
$fn$;
REVOKE ALL ON FUNCTION rh_frota_private.use_frota(date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rh_frota_private.use_frota(date,uuid) TO authenticated;
CREATE FUNCTION public.use_benefit_frota_maintenance(p_competence date,p_aggregation_id uuid)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path='' AS $fn$
  SELECT rh_frota_private.use_frota(p_competence,p_aggregation_id);
$fn$;
REVOKE ALL ON FUNCTION public.use_benefit_frota_maintenance(date,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.use_benefit_frota_maintenance(date,uuid) TO authenticated;

CREATE FUNCTION rh_frota_private.status(p_competence date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE v_month date:=date_trunc('month',p_competence)::date; v_last jsonb; v_attempt jsonb;
BEGIN
  PERFORM rh_frota_private.assert_actor();
  SELECT to_jsonb(r) INTO v_last FROM public.benefit_aggregation_fleet_sync_runs r
    WHERE r.competence=v_month AND r.status='SUCCESS' ORDER BY r.completed_at DESC LIMIT 1;
  SELECT to_jsonb(r) INTO v_attempt FROM public.benefit_aggregation_fleet_sync_runs r
    WHERE r.competence=v_month ORDER BY r.started_at DESC LIMIT 1;
  RETURN jsonb_build_object('configured',EXISTS(SELECT 1 FROM rh_frota_private.config c WHERE c.id AND c.enabled),
    'last_success',v_last,'latest_attempt',v_attempt);
END;
$fn$;
REVOKE ALL ON FUNCTION rh_frota_private.status(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION rh_frota_private.status(date) TO authenticated;
CREATE FUNCTION public.benefit_frota_sync_status(p_competence date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $fn$
  SELECT rh_frota_private.status(p_competence);
$fn$;
REVOKE ALL ON FUNCTION public.benefit_frota_sync_status(date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.benefit_frota_sync_status(date) TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;
