ALTER TABLE ingestion_event DROP CONSTRAINT IF EXISTS ingestion_event_status_check;
ALTER TABLE ingestion_event ADD CONSTRAINT ingestion_event_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'ignored', 'failed'));
