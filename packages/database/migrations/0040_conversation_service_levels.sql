CREATE TABLE IF NOT EXISTS conversation_service_level_policy (
  workspace_id uuid PRIMARY KEY REFERENCES workspace(id) ON DELETE CASCADE,
  timezone text NOT NULL,
  business_days_mask integer NOT NULL DEFAULT 62,
  business_start_time time NOT NULL DEFAULT '09:00',
  business_end_time time NOT NULL DEFAULT '17:00',
  unknown_target_minutes integer NOT NULL DEFAULT 480,
  low_target_minutes integer NOT NULL DEFAULT 480,
  normal_target_minutes integer NOT NULL DEFAULT 240,
  high_target_minutes integer NOT NULL DEFAULT 60,
  critical_target_minutes integer NOT NULL DEFAULT 15,
  at_risk_before_minutes integer NOT NULL DEFAULT 15,
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_service_level_timezone_check
    CHECK (length(btrim(timezone)) BETWEEN 1 AND 100),
  CONSTRAINT conversation_service_level_days_check
    CHECK (business_days_mask BETWEEN 1 AND 127),
  CONSTRAINT conversation_service_level_hours_check
    CHECK (business_start_time < business_end_time),
  CONSTRAINT conversation_service_level_targets_check CHECK (
    unknown_target_minutes BETWEEN 1 AND 10080
    AND low_target_minutes BETWEEN 1 AND 10080
    AND normal_target_minutes BETWEEN 1 AND 10080
    AND high_target_minutes BETWEEN 1 AND 10080
    AND critical_target_minutes BETWEEN 1 AND 10080
    AND at_risk_before_minutes BETWEEN 0 AND 1440
  ),
  FOREIGN KEY (workspace_id, created_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id, updated_by)
    REFERENCES workspace_membership(workspace_id, user_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION conversation_add_business_minutes(
  started_at timestamptz,
  policy_timezone text,
  business_days_mask integer,
  business_start_time time,
  business_end_time time,
  target_minutes integer
) RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  local_cursor timestamp := started_at AT TIME ZONE policy_timezone;
  local_day date := local_cursor::date;
  window_start timestamp;
  window_end timestamp;
  available_minutes integer;
  remaining_minutes integer := target_minutes;
  day_offset integer;
BEGIN
  IF remaining_minutes <= 0 THEN
    RETURN started_at;
  END IF;

  FOR day_offset IN 0..370 LOOP
    IF (business_days_mask & (1 << extract(dow FROM local_day)::integer)) <> 0 THEN
      window_start := local_day + business_start_time;
      window_end := local_day + business_end_time;
      IF local_cursor < window_start THEN
        local_cursor := window_start;
      END IF;
      IF local_cursor < window_end THEN
        available_minutes := floor(extract(epoch FROM (window_end - local_cursor)) / 60);
        IF remaining_minutes <= available_minutes THEN
          RETURN (local_cursor + remaining_minutes * interval '1 minute')
            AT TIME ZONE policy_timezone;
        END IF;
        remaining_minutes := remaining_minutes - available_minutes;
      END IF;
    END IF;
    local_day := local_day + 1;
    local_cursor := local_day::timestamp;
  END LOOP;

  RAISE EXCEPTION 'service-level target exceeds bounded business calendar';
END;
$$;
