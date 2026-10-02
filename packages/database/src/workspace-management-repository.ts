import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { normalizeWorkspaceManagementRequest, workspaceManagementUuid, WorkspaceManagementError,
  type ManagedWorkspaceSettings, type WorkspaceManagementReceipt, type WorkspaceManagementRequest } from "./workspace-management-models";

type AuthorityScope = { operation: "create"; organizationId: string } | { operation: "rename"; workspaceId: string };
type ReceiptRow = Omit<WorkspaceManagementReceipt, "createdAt"> & { createdBy: string; canonicalRequest: string; createdAt: string | Date };
const receipt = (row: ReceiptRow): WorkspaceManagementReceipt => ({ organizationId: row.organizationId, workspaceId: row.workspaceId,
  requestId: row.requestId, operation: row.operation, name: row.name, revision: row.revision, createdAt: new Date(row.createdAt).toISOString() });

/** Deliberate empty tenant creation/name edits only; no provisioning or inherited content. */
export class WorkspaceManagementRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getSettings(workspaceId: string, actorUserId: string): Promise<ManagedWorkspaceSettings | undefined> {
    const workspace = workspaceManagementUuid(workspaceId), actor = workspaceManagementUuid(actorUserId);
    return (await this.sql<ManagedWorkspaceSettings[]>`
      SELECT w.id AS workspace_id, w.organization_id, o.name AS organization_name, w.name, w.settings_revision AS revision,
        wm.role IN ('owner','admin') AS can_rename,
        EXISTS (SELECT 1 FROM organization_membership om WHERE om.organization_id=w.organization_id
          AND om.user_id=${actor} AND om.role='owner') AS can_create_workspace
      FROM workspace w JOIN organization o ON o.id=w.organization_id
      JOIN active_workspace_membership wm ON wm.workspace_id=w.id AND wm.user_id=${actor}
      WHERE w.id=${workspace}`)[0];
  }

  async getCreationOrganization(organizationId: string, actorUserId: string): Promise<{ id: string; name: string } | undefined> {
    const organization = workspaceManagementUuid(organizationId), actor = workspaceManagementUuid(actorUserId);
    return (await this.sql<{ id: string; name: string }[]>`SELECT o.id,o.name FROM organization o
      JOIN organization_membership om ON om.organization_id=o.id AND om.user_id=${actor} AND om.role='owner'
      WHERE o.id=${organization}`)[0];
  }

  async mutate(input: unknown, actorUserId: string): Promise<{ receipt: WorkspaceManagementReceipt; replayed: boolean }> {
    const request = normalizeWorkspaceManagementRequest(input), actor = workspaceManagementUuid(actorUserId), canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      const organizationId = await this.lockAuthority(tx, request, actor);
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`workspace-management:${organizationId}:${request.requestId}`},0))`;
      const prior = (await tx<ReceiptRow[]>`SELECT * FROM workspace_management_receipt
        WHERE organization_id=${organizationId} AND request_id=${request.requestId}`)[0];
      if (prior) {
        if (prior.createdBy !== actor || prior.canonicalRequest !== canonical) {
          throw new WorkspaceManagementError("request_conflict", "This request belongs to different workspace settings. Check the original result before starting another.");
        }
        return { receipt: receipt(prior), replayed: true };
      }
      let workspaceId: string, revision: number, previousName: string | undefined;
      if (request.operation === "create") {
        workspaceId = randomUUID(); revision = 1;
        await tx`INSERT INTO workspace(id,organization_id,name,slug)
          VALUES (${workspaceId},${organizationId},${request.name},${`workspace-${workspaceId}`})`;
        await tx`INSERT INTO workspace_membership(workspace_id,user_id,role) VALUES (${workspaceId},${actor},'owner')`;
        await tx`INSERT INTO brand(id,workspace_id,name,is_default) VALUES (${randomUUID()},${workspaceId},${request.name},true)`;
      } else {
        workspaceId = request.workspaceId;
        const current = (await tx<{ name: string; revision: number }[]>`SELECT name,settings_revision AS revision FROM workspace
          WHERE id=${workspaceId} AND organization_id=${organizationId} FOR UPDATE`)[0];
        if (!current) throw new WorkspaceManagementError("not_found", "Choose a workspace you can administer.");
        if (current.revision !== request.expectedRevision || current.revision === 2_147_483_647) {
          throw new WorkspaceManagementError("revision_conflict", "This workspace changed or reached its revision limit. Reload current settings before renaming.");
        }
        if (current.name === request.name) throw new WorkspaceManagementError("invalid_input", "The workspace already has that name. Choose a different display name.");
        previousName = current.name; revision = current.revision + 1;
        await tx`UPDATE workspace SET name=${request.name},settings_revision=${revision},updated_at=clock_timestamp() WHERE id=${workspaceId}`;
      }
      const saved = (await tx<ReceiptRow[]>`INSERT INTO workspace_management_receipt
        (organization_id,request_id,workspace_id,created_by,operation,name,revision,canonical_request)
        VALUES (${organizationId},${request.requestId},${workspaceId},${actor},${request.operation},${request.name},${revision},${canonical}) RETURNING *`)[0]!;
      await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES (${randomUUID()},${workspaceId},${actor},${`workspace.${request.operation === "create" ? "created" : "renamed"}`},'workspace',${workspaceId},
          ${tx.json({ name: request.name, revision, ...(previousName === undefined ? {} : { previousName }) })})`;
      return { receipt: receipt(saved), replayed: false };
    });
  }

  /** Only the original actor with current operation-specific authority can recover a result. */
  async getReceipt(scope: AuthorityScope, requestId: string, actorUserId: string): Promise<WorkspaceManagementReceipt | undefined> {
    const key = workspaceManagementUuid(requestId), actor = workspaceManagementUuid(actorUserId);
    return this.sql.begin(async tx => {
      const organizationId = await this.lockAuthority(tx, scope, actor);
      const row = (await tx<ReceiptRow[]>`SELECT * FROM workspace_management_receipt
        WHERE organization_id=${organizationId} AND request_id=${key} AND created_by=${actor} AND operation=${scope.operation}`)[0];
      if (!row || scope.operation === "rename" && row.workspaceId !== workspaceManagementUuid(scope.workspaceId)) return undefined;
      return receipt(row);
    });
  }

  private async lockAuthority(tx: TransactionSql, scope: AuthorityScope | WorkspaceManagementRequest, actor: string): Promise<string> {
    if (scope.operation === "create") {
      const id = workspaceManagementUuid(scope.organizationId);
      const rows = await tx<{ id: string }[]>`SELECT o.id FROM organization o
        JOIN organization_membership om ON om.organization_id=o.id AND om.user_id=${actor} AND om.role='owner'
        WHERE o.id=${id} FOR SHARE OF o,om`;
      if (!rows[0]) throw new WorkspaceManagementError("access_denied", "Current organization owner access is required to create a workspace.");
      return rows[0].id;
    }
    if (scope.operation !== "rename") throw new WorkspaceManagementError("invalid_input", "Choose a supported workspace operation.");
    const id = workspaceManagementUuid(scope.workspaceId);
    const rows = await tx<{ organizationId: string }[]>`SELECT w.organization_id FROM workspace w
      JOIN active_workspace_membership wm ON wm.workspace_id=w.id AND wm.user_id=${actor} AND wm.role IN ('owner','admin')
      WHERE w.id=${id} FOR SHARE OF wm`;
    if (!rows[0]) throw new WorkspaceManagementError("access_denied", "Current workspace owner or administrator access is required to rename this workspace.");
    return rows[0].organizationId;
  }
}
