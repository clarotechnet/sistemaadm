-- Serializa manutencao manual, recriacao QuarkRH e sincronizacao Frota por mes.
-- Sem dados de colaboradores. Nao altera valores ou a formula financeira.
BEGIN;
CREATE FUNCTION rh_frota_private.lock_monthly_competence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE v_month date;
BEGIN
  IF TG_OP='DELETE' THEN v_month:=OLD.competence; ELSE v_month:=NEW.competence; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('frota-rh:'||v_month::text,0));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$fn$;
REVOKE ALL ON FUNCTION rh_frota_private.lock_monthly_competence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER benefit_aggregation_monthly_00_fleet_lock
BEFORE INSERT OR UPDATE OR DELETE ON public.benefit_aggregation_monthly
FOR EACH ROW EXECUTE FUNCTION rh_frota_private.lock_monthly_competence();
COMMIT;
