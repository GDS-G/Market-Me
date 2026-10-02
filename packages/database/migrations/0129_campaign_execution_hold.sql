ALTER TABLE campaign_step_run DROP CONSTRAINT campaign_step_run_status_check;
ALTER TABLE campaign_step_run ADD CONSTRAINT campaign_step_run_status_check CHECK (
  status IN ('planned','waiting','running','succeeded','partially_succeeded',
    'temporarily_failed','permanently_failed','canceled','rolled_back','manual_resolution','schedule_blocked','execution_held')
);

-- A held, unadmitted retry cannot be declared manually complete. Previously
-- admitted writes settle through their own publication/job/AI records. Resuming
-- requires a fresh running transition; existing admission guards remain final.
CREATE FUNCTION guard_campaign_execution_hold() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='execution_held' AND NEW.status NOT IN ('execution_held','running','waiting','canceled','schedule_blocked') THEN
    RAISE EXCEPTION 'Held execution requires a fresh running admission or cancellation' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_execution_hold_guard BEFORE UPDATE OF status ON campaign_step_run
  FOR EACH ROW EXECUTE FUNCTION guard_campaign_execution_hold();
