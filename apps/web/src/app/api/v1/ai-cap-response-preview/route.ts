import { apiError } from "@/server/api-response";
import { aiCapResponsePreviewSchema, defaultWorkspaceAiPolicy } from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";
import { planAiCapResponse } from "@market-me/generation";

export async function POST(request: Request) {
  try {
    const parsed = aiCapResponsePreviewSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { workspace } = await requireWorkspaceAccess(parsed.data.workspaceId);
    const repository = getAiRepository();
    const [reservation, storedPolicy, adapters] = await Promise.all([
      repository.getSpendReservation(
        workspace.workspaceId,
        parsed.data.deniedReservationId,
      ),
      repository.getPolicy(workspace.workspaceId),
      repository.listProviderAdapters(),
    ]);
    if (!reservation || reservation.status !== "denied")
      return validation({
        deniedReservationId: ["A same-workspace denied reservation is required."],
      });
    const policy =
      storedPolicy ?? defaultWorkspaceAiPolicy(workspace.workspaceId);
    return Response.json({
      data: planAiCapResponse(
        {
          reservation,
          maximumPrivacyClass: policy.maximumPrivacyClass,
        },
        adapters.filter((adapter) => !adapter.requiresPaidReservation),
      ),
      meta: { execution: false, providerCall: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "A cap response can be previewed only for a denied reservation.",
        fields,
      },
    },
    { status: 422 },
  );
}
