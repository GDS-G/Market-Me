import type { TransactionSql } from "postgres";
import type { DatabaseClient } from "./client";
import { WorkspaceExecutionControlError, type WorkspaceExecutionState } from "./workspace-execution-control-models";

/**
 * First resource lock in an outbound admission transaction. Held until commit or
 * rollback, shared with other admissions and conflicting with a state transition.
 * Never use this gate for recovery or settlement of already-admitted work.
 */
export async function lockWorkspaceExecutionAdmission(transaction: TransactionSql, workspaceId: string): Promise<void> {
  const [control] = await transaction<{ state: WorkspaceExecutionState }[]>`
    SELECT state FROM workspace_execution_control WHERE workspace_id=${workspaceId} FOR SHARE
  `;
  assertOpen(control?.state);
}

/** Read-only early activity gate; never a replacement for the admission lock. */
export async function assertWorkspaceExecutionOpen(sql: DatabaseClient, workspaceId: string): Promise<void> {
  const [control] = await sql<{ state: WorkspaceExecutionState }[]>`SELECT state FROM workspace_execution_control WHERE workspace_id=${workspaceId}`;
  assertOpen(control?.state);
}

function assertOpen(state: WorkspaceExecutionState | undefined) {
  if (state !== "open" && state !== "paused") {
    throw new WorkspaceExecutionControlError("control_unavailable", "Workspace execution state is unavailable. No new work was admitted.");
  }
  if (state === "paused") {
    throw new WorkspaceExecutionControlError("execution_paused", "Workspace execution is paused. No new work was admitted.");
  }
}
