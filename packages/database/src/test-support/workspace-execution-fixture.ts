import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../client";
import { WorkspaceExecutionControlRepository } from "../workspace-execution-control-repository";
import type { WorkspaceExecutionState } from "../workspace-execution-control-models";

/** Current authority and revision, for synthetic integration workspaces only. */
export async function setFixtureExecutionState(sql: DatabaseClient, workspaceId: string, actorUserId: string, state: WorkspaceExecutionState) {
  const repository = new WorkspaceExecutionControlRepository(sql), current = await repository.getSnapshot(workspaceId, actorUserId);
  if (!current.canManage) throw new Error("Synthetic fixture requires current workspace administration");
  return repository.mutate({ workspaceId, requestId: randomUUID(), expectedActorIncarnationId: current.actorIncarnationId,
    expectedRevision: current.revision, state, reason: "Synthetic admission and settlement verification" }, actorUserId);
}
