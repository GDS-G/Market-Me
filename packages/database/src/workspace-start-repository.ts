import type { DatabaseClient } from "./client";
import { workspaceStartSnapshot, workspaceStartUuid, type WorkspaceStartSnapshot } from "./workspace-start-models";

/** Read-only navigation evidence. One SQL statement shares membership/role/count snapshot;
 * it grants no mutation authority and performs no provider, worker or receipt operation. */
export class WorkspaceStartRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getSnapshot(workspaceId: string, actorUserId: string): Promise<WorkspaceStartSnapshot | undefined> {
    const workspace = workspaceStartUuid(workspaceId), actor = workspaceStartUuid(actorUserId);
    const rows = await this.sql`
      SELECT m.workspace_id,m.role,statement_timestamp() AS observed_at,
        s.source_count,s.enabled_source_count,
        p.package_count,p.packages_to_review,p.approved_package_count,p.failed_package_count,
        d.draft_count,d.drafts_to_edit,d.approved_draft_count,
        c.campaign_count,c.draft_only_plan_count,c.other_published_plan_count,
        r.run_count,r.open_run_count,r.attention_run_count,r.completed_run_count,
        da.pending_draft_approvals,wa.pending_workflow_approvals
      FROM active_workspace_membership m
      CROSS JOIN LATERAL (
        SELECT count(*) AS source_count,count(*) FILTER (WHERE enabled) AS enabled_source_count
        FROM smart_source WHERE workspace_id=m.workspace_id
      ) s
      CROSS JOIN LATERAL (
        SELECT count(*) AS package_count,count(*) FILTER (WHERE status IN ('ready','needs_review')) AS packages_to_review,
          count(*) FILTER (WHERE status='approved') AS approved_package_count,count(*) FILTER (WHERE status='failed') AS failed_package_count
        FROM content_package WHERE workspace_id=m.workspace_id
      ) p
      CROSS JOIN LATERAL (
        SELECT count(*) AS draft_count,count(*) FILTER (WHERE status IN ('working','rejected','changes_requested')) AS drafts_to_edit,
          count(*) FILTER (WHERE status='approved') AS approved_draft_count
        FROM content_draft WHERE workspace_id=m.workspace_id AND status<>'archived'
      ) d
      CROSS JOIN LATERAL (
        SELECT count(*) AS campaign_count,
          count(*) FILTER (WHERE cv.status='published' AND cv.autonomy_mode='draft_only') AS draft_only_plan_count,
          count(*) FILTER (WHERE cv.status='published' AND cv.autonomy_mode<>'draft_only') AS other_published_plan_count
        FROM campaign c LEFT JOIN campaign_version cv ON cv.id=c.current_version_id AND cv.campaign_id=c.id
        WHERE c.workspace_id=m.workspace_id AND c.status<>'archived'
      ) c
      CROSS JOIN LATERAL (
        SELECT count(*) AS run_count,count(*) FILTER (WHERE status IN ('awaiting_approval','scheduled','active','paused')) AS open_run_count,
          count(*) FILTER (WHERE status IN ('paused','failed')) AS attention_run_count,count(*) FILTER (WHERE status='completed') AS completed_run_count
        FROM campaign_instance WHERE workspace_id=m.workspace_id
      ) r
      CROSS JOIN LATERAL (
        SELECT count(*) AS pending_draft_approvals FROM content_draft_approval WHERE workspace_id=m.workspace_id AND status='pending'
      ) da
      CROSS JOIN LATERAL (
        SELECT count(*) AS pending_workflow_approvals FROM campaign_approval WHERE workspace_id=m.workspace_id AND status='pending'
      ) wa
      WHERE m.workspace_id=${workspace} AND m.user_id=${actor}`;
    return rows[0] ? workspaceStartSnapshot(rows[0]) : undefined;
  }
}
