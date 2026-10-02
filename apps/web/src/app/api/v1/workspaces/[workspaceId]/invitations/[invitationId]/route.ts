import { WorkspaceMemberLifecycleError, workspaceMemberLifecycleUuid } from "@market-me/database";
import { memberRemovalApiError, memberRemovalResponse, requireMemberRemovalOrigin } from "@/server/workspace-member-lifecycle-api";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; invitationId: string }> },
) {
  try {
    requireMemberRemovalOrigin(request);
    const raw = await params, workspaceId = workspaceMemberLifecycleUuid(raw.workspaceId), invitationId = workspaceMemberLifecycleUuid(raw.invitationId);
    const { user, workspace } = await requireWorkspaceAccess(workspaceId);
    if (!["owner", "admin"].includes(workspace.role)) throw new AuthorizationError();
    const invitation = await getRepository().revokeWorkspaceInvitation({
      workspaceId,
      invitationId,
      revokedBy: user.id,
    });
    if (!invitation) {
      return memberRemovalResponse({ error: { code: "invitation_not_pending", message: "The invitation is no longer pending. Reload the current list." } }, 409);
    }
    return memberRemovalResponse({ data: invitation });
  } catch (error) {
    return memberRemovalApiError(error instanceof AuthorizationError ? new WorkspaceMemberLifecycleError("access_denied", "Denied") : error);
  }
}
