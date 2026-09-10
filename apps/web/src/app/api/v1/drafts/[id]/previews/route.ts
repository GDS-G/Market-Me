import { z } from "zod";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getDraftRepository } from "@/server/database";
import { getServerConfiguration } from "@/server/config";

const previewSchema = z.object({ workspaceId: z.string().uuid(), channelConnectionId: z.string().uuid(), destinationId: z.string().uuid().optional(), linkMode: z.enum(["canonical", "tracked"]).default("canonical"), assetIds: z.array(z.string().uuid()).max(10).default([]) });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    return Response.json({ data: await getDraftRepository().listChannelPreviews(workspace.workspaceId, (await context.params).id) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const parsed = previewSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Select an active channel and an optional published Destination." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getDraftRepository().createChannelPreview({ ...parsed.data, appBaseUrl: getServerConfiguration().appBaseUrl, workspaceId: workspace.workspaceId, draftId: (await context.params).id, actorUserId: user.id });
    return data ? Response.json({ data }, { status: 201 }) : Response.json({ error: { code: "not_found", message: "Draft not found." } }, { status: 404 });
  } catch (error) { return apiError(error); }
}
