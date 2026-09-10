import { apiError } from "@/server/api-response";
import { AuthorizationError, requireWorkspaceAccess } from "@/server/auth";
import { workspaceInvitationSchema } from "@/server/auth-schema";
import { getRepository } from "@/server/database";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const { workspace } = await requireWorkspaceAccess(workspaceId);
    if (!["owner", "admin"].includes(workspace.role)) throw new AuthorizationError();
    return Response.json({ data: await getRepository().listWorkspaceInvitations(workspaceId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(workspaceId);
    if (!["owner", "admin"].includes(workspace.role)) throw new AuthorizationError();
    const parsed = workspaceInvitationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { error: { code: "validation_error", message: "Provide a valid email, role, and one-to-thirty-day lifetime." } },
        { status: 400 },
      );
    }
    const invitation = await getRepository().createWorkspaceInvitation({
      workspaceId,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000),
    });
    return Response.json({ data: invitation }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
