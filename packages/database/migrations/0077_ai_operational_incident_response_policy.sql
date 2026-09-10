CREATE TABLE workspace_ai_operational_incident_response_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  critical_acknowledgement_minutes integer NOT NULL CHECK (
    critical_acknowledgement_minutes BETWEEN 1 AND 60
  ),
  high_acknowledgement_minutes integer NOT NULL CHECK (
    high_acknowledgement_minutes BETWEEN 1 AND 1440
  ),
  critical_resolution_minutes integer NOT NULL CHECK (
    critical_resolution_minutes BETWEEN 5 AND 10080
    AND critical_resolution_minutes >= critical_acknowledgement_minutes
  ),
  high_resolution_minutes integer NOT NULL CHECK (
    high_resolution_minutes BETWEEN 5 AND 43200
    AND high_resolution_minutes >= high_acknowledgement_minutes
  ),
  runbook_url text NOT NULL CHECK (
    char_length(runbook_url) BETWEEN 12 AND 2000
    AND runbook_url = btrim(runbook_url)
    AND runbook_url ~ '^https://[^[:space:]]+$'
  ),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT
);
