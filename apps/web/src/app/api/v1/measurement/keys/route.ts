import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getPublishingRepository } from "@/server/database";
import { measurementKeySchema } from "@/server/publishing-schema";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
      "read",
    );
    return Response.json({
      data: await getPublishingRepository().listMeasurementKeys(
        workspace.workspaceId,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = measurementKeySchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the key name, event scope, and expiration.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    const { user, workspace } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const data = await getPublishingRepository().createMeasurementKey(
      workspace.workspaceId,
      parsed.data.name,
      user.id,
      {
        allowedEventTypes: parsed.data.allowedEventTypes,
        allowedCampaignIds: parsed.data.allowedCampaignIds,
        expiresAt: parsed.data.expiresAt,
      },
    );
    return Response.json(
      { data, warning: "Copy this key now. Market Me stores only its hash." },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
