ALTER TABLE campaign_step
  ADD COLUMN dependency_delay_seconds integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT campaign_step_dependency_delay_bounds CHECK (
    dependency_delay_seconds BETWEEN 0 AND 31536000
    AND (dependency_delay_seconds = 0 OR cardinality(depends_on) > 0)
  ),
  ADD CONSTRAINT campaign_step_exact_time_finite CHECK (
    schedule_type <> 'exact_time' OR (scheduled_at IS NOT NULL AND isfinite(scheduled_at))
  ),
  ADD CONSTRAINT campaign_step_preferred_window_bounds CHECK (
    schedule_type <> 'preferred_window' OR (
      preferred_window_start IS NOT NULL AND preferred_window_end IS NOT NULL
      AND isfinite(preferred_window_start) AND isfinite(preferred_window_end)
      AND preferred_window_start < preferred_window_end
    )
  );

ALTER TABLE campaign_step_run DROP CONSTRAINT campaign_step_run_status_check;
ALTER TABLE campaign_step_run ADD CONSTRAINT campaign_step_run_status_check CHECK (
  status IN ('planned', 'waiting', 'running', 'succeeded', 'partially_succeeded',
    'temporarily_failed', 'permanently_failed', 'canceled', 'rolled_back', 'manual_resolution', 'schedule_blocked')
);
