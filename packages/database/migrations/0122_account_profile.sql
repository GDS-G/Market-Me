-- Application display labels only. Provider identity, email and memberships are unchanged.
ALTER TABLE app_user ADD COLUMN profile_revision integer NOT NULL DEFAULT 1 CHECK (profile_revision > 0);

CREATE FUNCTION guard_account_profile_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.display_name IS DISTINCT FROM OLD.display_name THEN
    IF OLD.profile_revision = 2147483647 OR NEW.profile_revision <> OLD.profile_revision + 1
      OR char_length(NEW.display_name) NOT BETWEEN 1 AND 120
      OR NEW.display_name <> btrim(NEW.display_name) OR NEW.display_name ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Account names require a bounded label and next revision' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.profile_revision IS DISTINCT FROM OLD.profile_revision THEN
    RAISE EXCEPTION 'Account profile revisions require a display-name change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_profile_revision_guard BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION guard_account_profile_revision();

CREATE TABLE account_profile_receipt (
  account_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  revision integer NOT NULL CHECK (revision > 0),
  changed boolean NOT NULL,
  canonical_request text NOT NULL CHECK (octet_length(canonical_request) <= 4096),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, request_id),
  CHECK ((jsonb_typeof(canonical_request::jsonb) = 'object'
    AND canonical_request::jsonb->>'accountId' = account_id::text
    AND canonical_request::jsonb->>'requestId' = request_id::text
    AND canonical_request::jsonb->>'displayName' = display_name
    AND canonical_request::jsonb->'expectedRevision' = to_jsonb(revision - CASE WHEN changed THEN 1 ELSE 0 END)
    AND revision - CASE WHEN changed THEN 1 ELSE 0 END > 0
    AND canonical_request::jsonb - ARRAY['accountId','requestId','expectedRevision','displayName'] = '{}'::jsonb) IS TRUE)
);

CREATE FUNCTION protect_account_profile_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM app_user WHERE id=NEW.account_id
      AND display_name=NEW.display_name AND profile_revision=NEW.revision) THEN
      RAISE EXCEPTION 'Account receipt must match its committed name and revision' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM app_user WHERE id=OLD.account_id) THEN
      RAISE EXCEPTION 'Account profile receipts must be retained' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Account profile receipts are immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER account_profile_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON account_profile_receipt
  FOR EACH ROW EXECUTE FUNCTION protect_account_profile_receipt();
