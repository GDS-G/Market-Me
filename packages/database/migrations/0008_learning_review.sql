CREATE TABLE IF NOT EXISTS learning_review (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  content_package_id uuid NOT NULL REFERENCES content_package(id) ON DELETE CASCADE,
  evidence_item_id uuid REFERENCES evidence_item(id) ON DELETE SET NULL,
  actor_user_id uuid NOT NULL REFERENCES app_user(id),
  action text NOT NULL CHECK (action IN ('accepted', 'rejected', 'corrected', 'conflict_resolved', 'package_approved')),
  original_claim text,
  corrected_claim text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_review_package_time_idx
  ON learning_review(content_package_id, created_at DESC);
