-- Public, random identifiers are not bearer tokens. Existing tokens and timestamps are untouched.
ALTER TABLE app_session ADD COLUMN session_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX app_session_public_id_idx ON app_session(session_id);
CREATE INDEX app_session_account_created_idx ON app_session(user_id,created_at DESC,session_id DESC);

CREATE FUNCTION guard_app_session_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.token_hash IS DISTINCT FROM OLD.token_hash OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Session identity is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER app_session_identity_guard BEFORE UPDATE ON app_session
  FOR EACH ROW EXECUTE FUNCTION guard_app_session_identity();

CREATE TABLE account_session_receipt (
  account_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  target_session_id uuid NOT NULL,
  actor_session_id uuid NOT NULL,
  revoked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  canonical_request text NOT NULL CHECK (octet_length(canonical_request)<=2048),
  PRIMARY KEY(account_id,request_id),
  CHECK (target_session_id<>actor_session_id),
  CHECK ((jsonb_typeof(canonical_request::jsonb)='object'
    AND canonical_request::jsonb->'accountId'=to_jsonb(account_id::text)
    AND canonical_request::jsonb->'requestId'=to_jsonb(request_id::text)
    AND canonical_request::jsonb->'targetSessionId'=to_jsonb(target_session_id::text)
    AND canonical_request::jsonb-ARRAY['accountId','requestId','targetSessionId']='{}'::jsonb) IS TRUE)
);
CREATE FUNCTION protect_account_session_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF EXISTS (SELECT 1 FROM app_session WHERE session_id=NEW.target_session_id)
      OR NOT EXISTS (SELECT 1 FROM app_session WHERE session_id=NEW.actor_session_id AND user_id=NEW.account_id) THEN
      RAISE EXCEPTION 'Session receipt requires its actor and removed target' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM app_user WHERE id=OLD.account_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'Session receipts are retained and immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER account_session_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON account_session_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_account_session_receipt();
