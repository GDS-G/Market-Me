import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import type { WorkspaceRole } from "./models";
import {
  normalizeWorkspaceExecutionControlRequest, workspaceExecutionControlUuid,
  WorkspaceExecutionControlError, WORKSPACE_EXECUTION_CONTROL_LIMITS,
  type WorkspaceExecutionControlReceipt, type WorkspaceExecutionControlSnapshot,
  type WorkspaceExecutionState,
} from "./workspace-execution-control-models";

type MemberRow = { role: WorkspaceRole; incarnationId: string };
type ControlRow = { workspaceId: string; state: WorkspaceExecutionState; revision: number; reason: string; updatedAt: Date | string };
type ReceiptRow = Omit<WorkspaceExecutionControlReceipt, "changedAt"> & {
  createdBy: string; canonicalRequest: string; changedAt: Date | string;
};
const canManage = (role: WorkspaceRole) => role === "owner" || role === "admin";
const denied = () => new WorkspaceExecutionControlError("access_denied", "Current workspace administration is required.");
const receipt = (row: ReceiptRow): WorkspaceExecutionControlReceipt => ({
  workspaceId: row.workspaceId, requestId: row.requestId,
  expectedActorIncarnationId: row.expectedActorIncarnationId, expectedRevision: row.expectedRevision,
  state: row.state, reason: row.reason, previousState: row.previousState,
  revision: row.revision, changedAt: new Date(row.changedAt).toISOString(),
});

/** Control-plane persistence only. Every dispatch boundary must independently fence admission. */
export class WorkspaceExecutionControlRepository {
  constructor(private readonly sql: DatabaseClient) {}

  async getSnapshot(workspaceId: string, actorUserId: string): Promise<WorkspaceExecutionControlSnapshot> {
    const workspace = workspaceExecutionControlUuid(workspaceId), actor = workspaceExecutionControlUuid(actorUserId);
    return this.sql.begin(async tx => {
      const member = await this.lockMember(tx, workspace, actor);
      const row = (await tx<ControlRow[]>`SELECT workspace_id,state,revision,reason,updated_at
        FROM workspace_execution_control WHERE workspace_id=${workspace} FOR SHARE`)[0];
      if (!row) throw new WorkspaceExecutionControlError("control_unavailable", "Current execution state is unavailable. No new work should be admitted.");
      const current = { workspaceId: row.workspaceId, state: row.state, revision: row.revision, changedAt: new Date(row.updatedAt).toISOString() };
      return canManage(member.role) ? { ...current, canManage: true, actorIncarnationId: member.incarnationId, reason: row.reason }
        : { ...current, canManage: false };
    });
  }

  async mutate(input: unknown, actorUserId: string): Promise<{ receipt: WorkspaceExecutionControlReceipt; replayed: boolean }> {
    const request = normalizeWorkspaceExecutionControlRequest(input), actor = workspaceExecutionControlUuid(actorUserId);
    const canonical = JSON.stringify(request);
    return this.sql.begin(async tx => {
      const member = await this.lockMember(tx, request.workspaceId, actor);
      if (!canManage(member.role)) throw denied();
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["workspace-execution-control-v1", request.workspaceId, request.requestId])},0))`;
      const prior = (await tx<ReceiptRow[]>`SELECT * FROM workspace_execution_control_receipt
        WHERE workspace_id=${request.workspaceId} AND request_id=${request.requestId}`)[0];
      if (prior) {
        if (prior.createdBy !== actor || prior.canonicalRequest !== canonical) {
          throw new WorkspaceExecutionControlError("request_conflict", "This request identifier belongs to another transition. Check the original result.");
        }
        return { receipt: receipt(prior), replayed: true };
      }
      if (member.incarnationId !== request.expectedActorIncarnationId) {
        throw new WorkspaceExecutionControlError("revision_conflict", "Your workspace grant changed. Review current execution state again.");
      }
      const current = (await tx<ControlRow[]>`SELECT workspace_id,state,revision,reason,updated_at FROM workspace_execution_control
        WHERE workspace_id=${request.workspaceId} FOR UPDATE`)[0];
      if (!current) throw new WorkspaceExecutionControlError("control_unavailable", "Current execution state is unavailable. No transition was confirmed.");
      if (current.revision !== request.expectedRevision || current.revision >= WORKSPACE_EXECUTION_CONTROL_LIMITS.revision) {
        throw new WorkspaceExecutionControlError("revision_conflict", "Execution state changed. Review the current state before another transition.");
      }
      if (current.state === request.state) throw new WorkspaceExecutionControlError("state_conflict", "The workspace already has the selected execution state.");
      await tx`UPDATE workspace_execution_control SET state=${request.state},revision=revision+1,reason=${request.reason},
        updated_by=${actor},updated_by_incarnation_id=${member.incarnationId},updated_at=clock_timestamp()
        WHERE workspace_id=${request.workspaceId}`;
      // Keep exact PostgreSQL timestamps inside SQL, never round-trip through Date.
      const saved = (await tx<ReceiptRow[]>`INSERT INTO workspace_execution_control_receipt
        (workspace_id,request_id,created_by,expected_actor_incarnation_id,expected_revision,previous_state,state,revision,reason,changed_at,canonical_request)
        SELECT workspace_id,${request.requestId},${actor},${member.incarnationId},${request.expectedRevision},${current.state},state,revision,reason,updated_at,${canonical}
        FROM workspace_execution_control WHERE workspace_id=${request.workspaceId} RETURNING *`)[0]!;
      await tx`INSERT INTO audit_event(id,workspace_id,actor_user_id,event_type,subject_type,subject_id,data)
        VALUES(${randomUUID()},${request.workspaceId},${actor},${request.state === "paused" ? "workspace.execution_paused" : "workspace.execution_reopened"},
          'workspace_execution_control',${request.workspaceId},${tx.json({ requestId: request.requestId, previousState: current.state,
            state: request.state, revision: saved.revision, actorIncarnationId: member.incarnationId, reason: request.reason })})`;
      return { receipt: receipt(saved), replayed: false };
    });
  }

  async getReceipt(workspaceId: string, requestId: string, actorUserId: string): Promise<WorkspaceExecutionControlReceipt | undefined> {
    const workspace = workspaceExecutionControlUuid(workspaceId), key = workspaceExecutionControlUuid(requestId), actor = workspaceExecutionControlUuid(actorUserId);
    return this.sql.begin(async tx => {
      const member = await this.lockMember(tx, workspace, actor);
      if (!canManage(member.role)) throw denied();
      const row = (await tx<ReceiptRow[]>`SELECT * FROM workspace_execution_control_receipt
        WHERE workspace_id=${workspace} AND request_id=${key} AND created_by=${actor}`)[0];
      return row ? receipt(row) : undefined;
    });
  }

  private async lockMember(tx: TransactionSql, workspace: string, actor: string): Promise<MemberRow> {
    const row = (await tx<MemberRow[]>`SELECT role,incarnation_id FROM active_workspace_membership
      WHERE workspace_id=${workspace} AND user_id=${actor} FOR SHARE`)[0];
    if (!row) throw denied();
    return row;
  }
}
