CREATE TABLE service_heartbeat (
  service text NOT NULL CHECK (service IN ('ingestion_worker', 'workflow_worker')),
  instance_id uuid NOT NULL,
  version varchar(32) NOT NULL CHECK (length(trim(version)) BETWEEN 1 AND 32),
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz,
  PRIMARY KEY (service, instance_id),
  CHECK (last_seen_at >= started_at),
  CHECK (stopped_at IS NULL OR stopped_at >= started_at)
);

CREATE INDEX service_heartbeat_fresh_idx
  ON service_heartbeat (service, last_seen_at DESC)
  WHERE stopped_at IS NULL;
