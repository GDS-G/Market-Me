import { z } from "zod";
import { DRAFT_FORMATS } from "@market-me/domain";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getDraftRepository } from "@/server/database";

const schema = z.object({ workspaceId: z.string().uuid(), campaignId: z.string().uuid(), contentPackageId: z.string().uuid(), draftFormat: z.enum(DRAFT_FORMATS).default("channel_neutral") });

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(new URL(request.url).searchParams.get("workspaceId") ?? undefined);
    const data = await getDraftRepository().list(workspace.workspaceId);
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: { code: "validation_failed", message: "Choose a published Campaign and one of its approved Content Packages." } }, { status: 422 });
    const { user, workspace } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getDraftRepository().generate({ ...parsed.data, workspaceId: workspace.workspaceId }, user.id);
    return Response.json({ data }, { status: 201 });
  } catch (error) { return apiError(error); }
}
