import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { WorkspaceAccess } from "@market-me/database";
import { getRepository } from "./database";
import { ACTIVE_WORKSPACE_COOKIE, selectActiveWorkspace } from "./workspace-selection";

// React cache deduplicates the page and shell within one render, never across requests.
export const getActiveWorkspaceSelection = cache(async (userId: string): Promise<{
  workspace: WorkspaceAccess | undefined;
  workspaces: readonly WorkspaceAccess[];
}> => {
  const [workspaces, cookieStore] = await Promise.all([
    getRepository().listWorkspaceAccess(userId),
    cookies(),
  ]);
  return {
    workspace: selectActiveWorkspace(workspaces, cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value),
    workspaces,
  };
});

/** Call only with the user ID from the authenticated session. */
export async function getActiveWorkspace(userId: string): Promise<WorkspaceAccess | undefined> {
  return (await getActiveWorkspaceSelection(userId)).workspace;
}
