import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import type { WorkspaceRole, WorkspaceInvitation } from "./models";
import { lockWorkspaceMemberGrant } from "./workspace-member-grant-lock";
import { normalizeWorkspaceMemberRemovalRequest, workspaceMemberLifecycleUuid, workspaceMemberImpactFingerprint,
  WorkspaceMemberLifecycleError, type WorkspaceMemberGrant, type WorkspaceMemberImpact, type WorkspaceMemberRemovalPreview,
  type WorkspaceMemberRemovalReceipt } from "./workspace-member-lifecycle-models";

type MemberRow = WorkspaceMemberGrant & { revokedAt: Date | null };
type ReceiptRow = Omit<WorkspaceMemberRemovalReceipt, "revokedAt" | "expectedRevision"> & {
  createdBy: string; canonicalRequest: string; revokedAt: Date | string;
};
const canManage = (role: WorkspaceRole | undefined) => role === "owner" || role === "admin";
const denied = () => new WorkspaceMemberLifecycleError("access_denied", "Current workspace owner or administrator access is required.");
const missing = () => new WorkspaceMemberLifecycleError("not_found", "No selected member or original removal result was found.");
const projectReceipt = (row: ReceiptRow): WorkspaceMemberRemovalReceipt => ({ workspaceId: row.workspaceId, targetUserId: row.targetUserId,
  requestId: row.requestId, expectedIncarnationId: row.expectedIncarnationId, expectedRevision: row.revision - 1,
  impactFingerprint: row.impactFingerprint, reason: row.reason, previousRole: row.previousRole, revision: row.revision,
  revokedAt: new Date(row.revokedAt).toISOString(), impact: row.impact });

/** Personal accounts, other workspaces, assignments and historical records survive. */
export class WorkspaceMemberLifecycleRepository {
  constructor(private readonly sql: DatabaseClient) {}

  /** A bounded resolution queue, not the latest-200 mixed invitation history.
   * Removing one pending item reveals the next; unrelated grants never need to
   * be revoked merely to reach this member's blocking invitations. */
  async listPendingInvitations(workspaceId: string, targetUserId: string, actorUserId: string): Promise<readonly WorkspaceInvitation[]> {
    const workspace = workspaceMemberLifecycleUuid(workspaceId), target = workspaceMemberLifecycleUuid(targetUserId), actor = workspaceMemberLifecycleUuid(actorUserId);
    return this.sql.begin(async tx => {
      const members = await tx<{ userId: string; role: WorkspaceRole; revokedAt: Date | null }[]>`SELECT user_id,role,revoked_at FROM workspace_membership
        WHERE workspace_id=${workspace} AND user_id IN (${actor},${target}) ORDER BY user_id FOR SHARE`;
      if (!canManage(members.find(row => row.userId === actor && row.revokedAt === null)?.role)) throw denied();
      if (!members.some(row => row.userId === target)) throw missing();
      return tx<WorkspaceInvitation[]>`SELECT id,workspace_id,email,role,status,invited_by,accepted_by,expires_at,accepted_at,revoked_at,created_at
        FROM workspace_invitation WHERE workspace_id=${workspace} AND status='pending' AND expires_at>statement_timestamp()
        AND (invited_by=${target} OR normalized_email=(SELECT normalized_email FROM app_user WHERE id=${target}))
        ORDER BY created_at,id LIMIT 200`;
    });
  }

  async preview(workspaceId: string, targetUserId: string, actorUserId: string): Promise<WorkspaceMemberRemovalPreview> {
    const workspace = workspaceMemberLifecycleUuid(workspaceId), targetId = workspaceMemberLifecycleUuid(targetUserId), actorId = workspaceMemberLifecycleUuid(actorUserId);
    return this.sql.begin(async tx => {
      const rows = await tx<MemberRow[]>`SELECT m.user_id,u.display_name,m.role,m.incarnation_id,m.role_revision AS revision
        FROM active_workspace_membership m JOIN app_user u ON u.id=m.user_id
        WHERE m.workspace_id=${workspace} AND m.user_id IN (${actorId},${targetId}) ORDER BY m.user_id FOR SHARE OF m`;
      const actor = rows.find(row => row.userId === actorId); if (!canManage(actor?.role)) throw denied();
      const target = rows.find(row => row.userId === targetId); this.checkTarget(target, actorId);
      const { impact, observedAt } = await this.impact(tx, workspace, targetId);
      return { workspaceId: workspace, target: target!, impact, observedAt,
        impactFingerprint: workspaceMemberImpactFingerprint(workspace, actor!.incarnationId, target!, impact),
        blocked: impact.pendingIncomingInvitations !== "0" || impact.pendingIssuedInvitations !== "0" };
    });
  }

  async remove(input: unknown, actorUserId: string): Promise<{ receipt: WorkspaceMemberRemovalReceipt; replayed: boolean }> {
    const request = normalizeWorkspaceMemberRemovalRequest(input), actorId = workspaceMemberLifecycleUuid(actorUserId), canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      // Preliminary admission minimizes private email lookup. It does not replace
      // the authoritative check after ordered member locks below.
      if (!(await tx`SELECT 1 FROM active_workspace_membership WHERE workspace_id=${request.workspaceId}
        AND user_id=${actorId} AND role IN ('owner','admin')`)[0]) throw denied();
      const [scope] = await tx<{ normalizedEmail: string }[]>`SELECT u.normalized_email FROM app_user u
        JOIN workspace_membership m ON m.user_id=u.id WHERE m.workspace_id=${request.workspaceId} AND m.user_id=${request.targetUserId}`;
      if (!scope) throw missing();
      await lockWorkspaceMemberGrant(tx, request.workspaceId, scope.normalizedEmail);
      // Retained rows include a revoked target so exact history can still replay.
      // Every actor is explicitly required to have a current active grant.
      const rows = await tx<MemberRow[]>`SELECT m.user_id,u.display_name,m.role,m.incarnation_id,m.role_revision AS revision,m.revoked_at
        FROM workspace_membership m JOIN app_user u ON u.id=m.user_id WHERE m.workspace_id=${request.workspaceId}
        AND m.user_id IN (${actorId},${request.targetUserId}) ORDER BY m.user_id FOR UPDATE OF m`;
      const actor = rows.find(row => row.userId === actorId && row.revokedAt === null); if (!canManage(actor?.role)) throw denied();
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["workspace-member-removal-v1", request.workspaceId, request.requestId])},0))`;
      const [prior] = await tx<ReceiptRow[]>`SELECT * FROM workspace_member_removal_receipt
        WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`;
      if (prior) {
        if (prior.createdBy !== actorId || prior.canonicalRequest !== canonical) throw new WorkspaceMemberLifecycleError("request_conflict", "Check the original removal result; this key belongs to a different intent.");
        return { receipt: projectReceipt(prior), replayed: true };
      }
      const target = rows.find(row => row.userId === request.targetUserId && row.revokedAt === null); this.checkTarget(target, actorId);
      if (target!.incarnationId !== request.expectedIncarnationId || target!.revision !== request.expectedRevision) {
        throw new WorkspaceMemberLifecycleError("revision_conflict", "This member's grant changed. Reload its current removal preview.");
      }
      const { impact } = await this.impact(tx, request.workspaceId, request.targetUserId);
      if (workspaceMemberImpactFingerprint(request.workspaceId, actor!.incarnationId, target!, impact) !== request.impactFingerprint) {
        throw new WorkspaceMemberLifecycleError("impact_conflict", "The member's work or your grant changed. Review a fresh impact preview.");
      }
      if (impact.pendingIncomingInvitations !== "0" || impact.pendingIssuedInvitations !== "0") {
        throw new WorkspaceMemberLifecycleError("unresolved_dependencies", "Revoke or resolve this member's pending incoming and issued invitations before removing access.");
      }
      const [changed] = await tx<{ roleRevision: number }[]>`UPDATE workspace_membership SET revoked_at=clock_timestamp()
        WHERE workspace_id=${request.workspaceId} AND user_id=${request.targetUserId} AND revoked_at IS NULL
        AND incarnation_id=${request.expectedIncarnationId} AND role_revision=${request.expectedRevision} RETURNING role_revision`;
      if (!changed) throw new WorkspaceMemberLifecycleError("revision_conflict", "This member's grant changed. Reload its current removal preview.");
      // Copy revoked_at inside SQL: routing it through Date would lose microseconds.
      const [saved] = await tx<ReceiptRow[]>`INSERT INTO workspace_member_removal_receipt
        (workspace_id,request_id,target_user_id,created_by,expected_incarnation_id,previous_role,revision,reason,impact_fingerprint,impact,revoked_at,canonical_request)
        SELECT workspace_id,${request.requestId},user_id,${actorId},incarnation_id,role,role_revision,${request.reason},${request.impactFingerprint},
          ${tx.json(impact)},revoked_at,${canonical} FROM workspace_membership WHERE workspace_id=${request.workspaceId} AND user_id=${request.targetUserId} RETURNING *`;
      await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES (${randomUUID()},${request.workspaceId},${actorId},'workspace.member_access_removed','workspace_member',${request.targetUserId},
          ${tx.json({ requestId: request.requestId, incarnationId: request.expectedIncarnationId, revision: changed.roleRevision,
            previousRole: target!.role, reason: request.reason, impact, sourceInterface: "team_member_removal" })})`;
      return { receipt: projectReceipt(saved!), replayed: false };
    });
  }

  async getReceipt(workspaceId: string, requestId: string, actorUserId: string): Promise<WorkspaceMemberRemovalReceipt | undefined> {
    const workspace = workspaceMemberLifecycleUuid(workspaceId), key = workspaceMemberLifecycleUuid(requestId), actor = workspaceMemberLifecycleUuid(actorUserId);
    return this.sql.begin(async tx => {
      if (!(await tx`SELECT 1 FROM active_workspace_membership WHERE workspace_id=${workspace} AND user_id=${actor}
        AND role IN ('owner','admin') FOR SHARE`)[0]) throw denied();
      const [row] = await tx<ReceiptRow[]>`SELECT * FROM workspace_member_removal_receipt WHERE workspace_id=${workspace} AND request_id=${key} AND created_by=${actor}`;
      return row ? projectReceipt(row) : undefined;
    });
  }

  private checkTarget(target: WorkspaceMemberGrant | undefined, actorId: string): void {
    if (!target) throw missing();
    if (target.userId === actorId || target.role === "owner") throw new WorkspaceMemberLifecycleError("protected_member", "Your own access and all owner memberships are protected here.");
  }

  private async impact(tx: TransactionSql, workspace: string, target: string): Promise<{ impact: WorkspaceMemberImpact; observedAt: string }> {
    const [row] = await tx<(WorkspaceMemberImpact & { observedAt: Date })[]>`SELECT statement_timestamp() AS observed_at,
      (SELECT count(*)::text FROM conversation_thread WHERE workspace_id=${workspace} AND assigned_owner_id=${target} AND status NOT IN ('resolved','archived')) AS assigned_conversations,
      (SELECT count(*)::text FROM conversation_routing_rule WHERE workspace_id=${workspace} AND target_owner_id=${target} AND enabled) AS enabled_routing_rules,
      (SELECT count(*)::text FROM conversation_review_request WHERE workspace_id=${workspace} AND requested_reviewer_id=${target} AND status='open') AS open_conversation_reviews,
      (SELECT count(*)::text FROM campaign_approval WHERE workspace_id=${workspace} AND assigned_reviewer_id=${target} AND status='pending') AS pending_campaign_approvals,
      (SELECT count(*)::text FROM workspace_invitation WHERE workspace_id=${workspace} AND normalized_email=(SELECT normalized_email FROM app_user WHERE id=${target}) AND status='pending' AND expires_at>statement_timestamp()) AS pending_incoming_invitations,
      (SELECT count(*)::text FROM workspace_invitation WHERE workspace_id=${workspace} AND invited_by=${target} AND status='pending' AND expires_at>statement_timestamp()) AS pending_issued_invitations,
      (SELECT count(*)::text FROM smart_source_preparation_binding WHERE workspace_id=${workspace} AND writer_user_id=${target} AND enabled) AS enabled_source_bindings,
      (SELECT count(*)::text FROM source_preparation_command WHERE workspace_id=${workspace} AND writer_user_id=${target} AND status IN ('pending','processing','failed')) AS queued_source_commands,
      (SELECT count(*)::text FROM workspace_ai_text_invocation_intent WHERE workspace_id=${workspace} AND prepared_by=${target} AND status='prepared' AND expires_at>statement_timestamp()) AS prepared_ai_intents,
      (SELECT count(*)::text FROM campaign_instance WHERE workspace_id=${workspace} AND requested_by=${target} AND status IN ('awaiting_approval','scheduled','active','paused')) AS active_campaign_runs,
      (SELECT count(*)::text FROM destination WHERE workspace_id=${workspace} AND owner_user_id=${target} AND status<>'archived') AS owned_destinations`;
    const { observedAt, ...impact } = row!;
    return { impact, observedAt: observedAt.toISOString() };
  }
}
