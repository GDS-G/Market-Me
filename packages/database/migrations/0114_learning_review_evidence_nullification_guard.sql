-- A Learning Review's optional live evidence pointer may become NULL only when
-- the referenced evidence row is actually being removed by its ON DELETE SET
-- NULL foreign key. Direct detachment would otherwise rewrite retained history.
CREATE OR REPLACE FUNCTION preserve_proved_learning_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Legacy rows are retained decisions too. Their lack of an exact proof must
  -- not allow any other persisted decision field to be rewritten.
  IF (to_jsonb(NEW) - 'evidence_item_id') IS DISTINCT FROM (to_jsonb(OLD) - 'evidence_item_id') THEN
    RAISE EXCEPTION 'Learning Review decisions are immutable' USING ERRCODE = '23514';
  END IF;

  -- PostgreSQL performs the FK SET NULL from an AFTER DELETE referential action,
  -- so the removed parent is no longer visible when this child UPDATE trigger
  -- runs. A direct UPDATE still sees its referenced evidence row and is denied.
  IF NEW.evidence_item_id IS DISTINCT FROM OLD.evidence_item_id
    AND NOT (
      OLD.evidence_item_id IS NOT NULL
      AND NEW.evidence_item_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM evidence_item WHERE id = OLD.evidence_item_id)
    ) THEN
    RAISE EXCEPTION 'Learning Review evidence can change only when its source evidence is deleted' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION preserve_proved_learning_review() IS
  'Keeps Learning Review decisions immutable while allowing only FK-driven evidence detachment after source evidence deletion.';
