ALTER TABLE mailchimp_report_collection_state
  ADD COLUMN last_webhook_delivery_hash char(64),
  ADD COLUMN last_webhook_timestamp bigint,
  ADD COLUMN last_webhook_received_at timestamptz,
  ADD COLUMN webhook_wakeup_count bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT mailchimp_report_collection_webhook_hash_check CHECK (last_webhook_delivery_hash IS NULL OR last_webhook_delivery_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT mailchimp_report_collection_webhook_timestamp_check CHECK (last_webhook_timestamp IS NULL OR last_webhook_timestamp >= 0),
  ADD CONSTRAINT mailchimp_report_collection_webhook_pair_check CHECK ((last_webhook_delivery_hash IS NULL) = (last_webhook_timestamp IS NULL) AND (last_webhook_timestamp IS NULL) = (last_webhook_received_at IS NULL)),
  ADD CONSTRAINT mailchimp_report_collection_webhook_count_check CHECK (webhook_wakeup_count >= 0);
