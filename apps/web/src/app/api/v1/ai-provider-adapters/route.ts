import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiProviderAdapterListSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiProviderAdapterListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "A workspace is required to inspect the adapter registry.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    await requireWorkspaceAccess(parsed.data.workspaceId);
    const repository = getAiRepository();
    const [adapters, summary] = await Promise.all([
      repository.listProviderAdapters(),
      repository.getProviderAdapterRegistrySummary(),
    ]);
    return Response.json({
      data: { adapters, summary },
      meta: {
        serverGoverned: true,
        credentials: false,
        mutation: false,
        execution: false,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
