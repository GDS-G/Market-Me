ALTER TABLE conversation_thread
  ADD COLUMN IF NOT EXISTS sentiment text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS intent text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS classification_updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS classification_updated_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_sentiment_check'
  ) THEN
    ALTER TABLE conversation_thread ADD CONSTRAINT conversation_thread_sentiment_check
      CHECK (sentiment IN ('unknown', 'positive', 'neutral', 'negative', 'mixed'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_intent_check'
  ) THEN
    ALTER TABLE conversation_thread ADD CONSTRAINT conversation_thread_intent_check
      CHECK (intent IN (
        'unknown', 'praise', 'question', 'support', 'availability', 'sales',
        'complaint', 'collaboration', 'media_inquiry', 'other'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_urgency_check'
  ) THEN
    ALTER TABLE conversation_thread ADD CONSTRAINT conversation_thread_urgency_check
      CHECK (urgency IN ('unknown', 'low', 'normal', 'high', 'critical'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'conversation_thread_classification_evidence_check'
  ) THEN
    ALTER TABLE conversation_thread ADD CONSTRAINT conversation_thread_classification_evidence_check
      CHECK (
        (classification_updated_by IS NULL AND classification_updated_at IS NULL)
        OR (classification_updated_by IS NOT NULL AND classification_updated_at IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS conversation_thread_workspace_classification_idx
  ON conversation_thread(workspace_id, urgency, intent, sentiment, updated_at DESC);
