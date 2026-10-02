import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import type { WorkspaceRole } from "./models";
import { normalizeWorkspaceMemberRoleRequest, workspaceMemberRoleUuid, WORKSPACE_MEMBER_ROLE_LIMITS, WorkspaceMemberRoleError,
  type ManagedMemberRole, type ManagedWorkspaceMember, type ManagedWorkspaceMemberPage, type WorkspaceMemberRoleReceipt } from "./workspace-member-role-models";

type ReceiptRow = Omit<WorkspaceMemberRoleReceipt, "createdAt"> & { createdBy: string; canonicalRequest: string; createdAt: string | Date };
type MembershipRow = { userId: string; role: WorkspaceRole; revision: number };
const canManage = (role: WorkspaceRole | undefined) => role === "owner" || role === "admin";
const receipt = (row: ReceiptRow): WorkspaceMemberRoleReceipt => ({ workspaceId: row.workspaceId, targetUserId: row.targetUserId,
  requestId: row.requestId, previousRole: row.previousRole, newRole: row.newRole, revision: row.revision,
  reason: row.reason, createdAt: new Date(row.createdAt).toISOString() });

/** No owner transfer, self-edit, membership creation/removal or organization grant. */
export class WorkspaceMemberRoleRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async listMembers(workspaceId: string, actorUserId: string, page = 1): Promise<ManagedWorkspaceMemberPage> {
    const workspace = workspaceMemberRoleUuid(workspaceId), actor = workspaceMemberRoleUuid(actorUserId);
    if (!Number.isInteger(page) || page < 1 || page > WORKSPACE_MEMBER_ROLE_LIMITS.maxPage) {
      throw new WorkspaceMemberRoleError("invalid_input", "Choose a supported member-list page.");
    }
    return this.sql.begin(async tx => {
      const access = (await tx<{ role: WorkspaceRole }[]>`SELECT role FROM active_workspace_membership
        WHERE workspace_id=${workspace} AND user_id=${actor} FOR SHARE`)[0];
      if (!access) throw new WorkspaceMemberRoleError("access_denied", "Current workspace membership is required to view its team.");
      const permitted = canManage(access.role);
      const rows = await tx<ManagedWorkspaceMember[]>`SELECT wm.user_id,u.display_name,wm.role,wm.role_revision AS revision,
        (${permitted} AND wm.user_id<>${actor} AND wm.role<>'owner') AS can_change_role
        FROM active_workspace_membership wm JOIN app_user u ON u.id=wm.user_id WHERE wm.workspace_id=${workspace}
        ORDER BY wm.created_at,wm.user_id LIMIT ${WORKSPACE_MEMBER_ROLE_LIMITS.pageSize + 1}
        OFFSET ${(page - 1) * WORKSPACE_MEMBER_ROLE_LIMITS.pageSize}`;
      return { workspaceId: workspace, page, more: rows.length > WORKSPACE_MEMBER_ROLE_LIMITS.pageSize,
        canManage: permitted, members: rows.slice(0, WORKSPACE_MEMBER_ROLE_LIMITS.pageSize) };
    });
  }

  async mutate(input: unknown, actorUserId: string): Promise<{ receipt: WorkspaceMemberRoleReceipt; replayed: boolean }> {
    const request = normalizeWorkspaceMemberRoleRequest(input), actor = workspaceMemberRoleUuid(actorUserId), canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      // Immutable user IDs establish one global order, including A->B / B->A
      // changes. Do not hold the actor separately before acquiring the target.
      const members = await tx<MembershipRow[]>`SELECT user_id,role,role_revision AS revision FROM active_workspace_membership
        WHERE workspace_id=${request.workspaceId} AND user_id IN (${actor},${request.targetUserId}) ORDER BY user_id FOR UPDATE`;
      if (!canManage(members.find(member => member.userId === actor)?.role)) {
        throw new WorkspaceMemberRoleError("access_denied", "Current workspace owner or administrator access is required to change member roles.");
      }
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`workspace-member-role:${request.workspaceId}:${request.requestId}`},0))`;
      const prior = (await tx<ReceiptRow[]>`SELECT * FROM workspace_member_role_receipt
        WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`)[0];
      if (prior) {
        if (prior.createdBy !== actor || prior.canonicalRequest !== canonical) {
          throw new WorkspaceMemberRoleError("request_conflict", "This request belongs to different role-change settings. Check the original result before starting another.");
        }
        return { receipt: receipt(prior), replayed: true };
      }
      const target = members.find(member => member.userId === request.targetUserId);
      if (request.targetUserId === actor || target?.role === "owner") {
        throw new WorkspaceMemberRoleError("protected_member", "Your own role and workspace owner roles cannot be changed here.");
      }
      if (!target) throw new WorkspaceMemberRoleError("not_found", "Choose an existing member of this workspace.");
      if (target.revision !== request.expectedRevision || target.revision === 2_147_483_647) {
        throw new WorkspaceMemberRoleError("revision_conflict", "This member changed or reached the revision limit. Reload the current team before changing roles.");
      }
      if (target.role === request.newRole) throw new WorkspaceMemberRoleError("invalid_input", "This member already has that role. Choose a different role.");
      const previousRole = target.role as ManagedMemberRole, revision = target.revision + 1;
      // The SQL trigger, not a client-supplied counter, advances role_revision.
      await tx`UPDATE active_workspace_membership SET role=${request.newRole} WHERE workspace_id=${request.workspaceId} AND user_id=${request.targetUserId}`;
      const saved = (await tx<ReceiptRow[]>`INSERT INTO workspace_member_role_receipt
        (workspace_id,request_id,target_user_id,created_by,previous_role,new_role,revision,reason,canonical_request)
        VALUES (${request.workspaceId},${request.requestId},${request.targetUserId},${actor},${previousRole},${request.newRole},${revision},${request.reason},${canonical}) RETURNING *`)[0]!;
      await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES (${randomUUID()},${request.workspaceId},${actor},'workspace.member_role_changed','workspace_member',${request.targetUserId},
          ${tx.json({ previousRole, newRole: request.newRole, revision, reason: request.reason, sourceInterface: "team_role_editor" })})`;
      return { receipt: receipt(saved), replayed: false };
    });
  }

  /** Original actor plus current administration; missing is not proof of failure. */
  async getReceipt(workspaceId: string, requestId: string, actorUserId: string): Promise<WorkspaceMemberRoleReceipt | undefined> {
    const workspace = workspaceMemberRoleUuid(workspaceId), key = workspaceMemberRoleUuid(requestId), actor = workspaceMemberRoleUuid(actorUserId);
    return this.sql.begin(async tx => {
      await this.lockAuthority(tx, workspace, actor);
      const row = (await tx<ReceiptRow[]>`SELECT * FROM workspace_member_role_receipt
        WHERE workspace_id=${workspace} AND request_id=${key} AND created_by=${actor}`)[0];
      return row ? receipt(row) : undefined;
    });
  }

  private async lockAuthority(tx: TransactionSql, workspace: string, actor: string): Promise<void> {
    const rows = await tx`SELECT user_id FROM active_workspace_membership
      WHERE workspace_id=${workspace} AND user_id=${actor} AND role IN ('owner','admin') FOR SHARE`;
    if (!rows.length) throw new WorkspaceMemberRoleError("access_denied", "Current workspace owner or administrator access is required to recover role changes.");
  }
}
