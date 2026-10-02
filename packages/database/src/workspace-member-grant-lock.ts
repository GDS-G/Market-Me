import type { TransactionSql } from "postgres";
import { workspaceMemberLifecycleUuid } from "./workspace-member-lifecycle-models";

/** Acquire before invitation/member row locks. This serializes one potential grant,
 * not every operation in a workspace. The key is never a public credential. */
export async function lockWorkspaceMemberGrant(tx: TransactionSql, workspaceId: string, normalizedEmail: string): Promise<void> {
  const workspace = workspaceMemberLifecycleUuid(workspaceId);
  if (!normalizedEmail || normalizedEmail !== normalizedEmail.trim().toLowerCase()) throw new Error("Expected a normalized member email.");
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["workspace-member-grant-v1", workspace, normalizedEmail])},0))`;
}
