import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { contextPackInputSchema, contextPackValidationError } from "@/server/context-pack-schema";
import { getRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? undefined;
    const { workspace } = await requireWorkspaceAccess(workspaceId);
    const data = await getRepository().listContextPacks(workspace.workspaceId);
    return Response.json({ data, meta: { count: data.length, persistence: "postgresql" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = contextPackInputSchema.safeParse(await request.json());
    if (!parsed.success) return contextPackValidationError(parsed.error);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getRepository().createContextPack(parsed.data, user.id);
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
