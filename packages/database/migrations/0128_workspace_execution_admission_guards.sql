-- Last-mile safeguards also cover older database writers. Application writers
-- take this shared control-row fence before their other resource locks. Deploy
-- control UI, activities and workers together; a schema-only rollout is not UX.
CREATE FUNCTION assert_workspace_execution_admission(target_workspace uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE current_state text;
BEGIN
  SELECT state INTO current_state FROM workspace_execution_control WHERE workspace_id=target_workspace FOR SHARE;
  IF current_state IS NULL OR current_state NOT IN ('open','paused') THEN
    RAISE EXCEPTION 'Workspace execution control unavailable' USING ERRCODE='MM002';
  END IF;
  IF current_state='paused' THEN
    RAISE EXCEPTION 'Workspace execution is paused' USING ERRCODE='MM001';
  END IF;
END;
$$;
CREATE FUNCTION guard_workspace_execution_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_workspace_execution_admission(NEW.workspace_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER publication_execution_admission_guard BEFORE INSERT OR UPDATE OF status,workspace_id ON publication_action
  FOR EACH ROW WHEN(NEW.status='dispatching') EXECUTE FUNCTION guard_workspace_execution_admission();
CREATE TRIGGER ai_execution_admission_guard BEFORE INSERT OR UPDATE OF status,workspace_id ON workspace_ai_text_invocation_attempt
  FOR EACH ROW WHEN(NEW.status='claimed') EXECUTE FUNCTION guard_workspace_execution_admission();
CREATE TRIGGER companion_execution_admission_guard
  BEFORE INSERT OR UPDATE OF status,workspace_id,claim_token_hash,lease_expires_at,attempt_count ON browser_job
  FOR EACH ROW WHEN(NEW.status='claimed') EXECUTE FUNCTION guard_workspace_execution_admission();
