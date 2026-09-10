"use server";

import { cookies, headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuthenticatedUser } from "./auth";
import { getRepository } from "./database";
import { getServerConfiguration } from "./config";
import {
  ACTIVE_WORKSPACE_COOKIE,
  ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS,
  isWorkspaceSwitchOriginAllowed,
  workspaceSwitchReturnPath,
  type WorkspaceSwitchState,
} from "./workspace-selection";

export async function switchActiveWorkspace(
  _previousState: WorkspaceSwitchState,
  formData: FormData,
): Promise<WorkspaceSwitchState> {
  // Next also rejects cross-origin Server Action POSTs; require the configured origin here.
  const requestHeaders = await headers();
  if (!isWorkspaceSwitchOriginAllowed(requestHeaders.get("origin"), getServerConfiguration().appBaseUrl)) {
    return { error: "Workspace switching requires a request from this application." };
  }
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  const parsed = z.uuid().safeParse(formData.get("workspaceId"));
  if (!parsed.success || formData.getAll("workspaceId").length !== 1) {
    return { error: "Choose a workspace you can access." };
  }
  // Re-read membership on the POST; the rendered option list can be stale or forged.
  const workspace = await getRepository().getWorkspaceAccess(user.id, parsed.data);
  if (!workspace) return { error: "Choose a workspace you can access." };
  (await cookies()).set(ACTIVE_WORKSPACE_COOKIE, workspace.workspaceId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS,
  });
  revalidatePath("/", "layout");
  redirect(workspaceSwitchReturnPath(formData.get("returnPath")), RedirectType.replace);
}
