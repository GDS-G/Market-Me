import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { getRepository } from "@/server/database";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; invitationId: string }> },
) {
  try {
    const { workspaceId, invitationId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(workspaceId);
    if (!["owner", "admin"].includes(workspace.role)) throw new AuthorizationError();
    const invitation = await getRepository().revokeWorkspaceInvitation({
      workspaceId,
      invitationId,
      revokedBy: user.id,
    });
    if (!invitation) {
      return Response.json({ error: { code: "invitation_not_pending", message: "The invitation is not pending." } }, { status: 409 });
    }
    return Response.json({ data: invitation });
  } catch (error) {
    return apiError(error);
  }
}
