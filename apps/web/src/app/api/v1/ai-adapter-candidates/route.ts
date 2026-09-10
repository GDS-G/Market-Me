import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiAdapterCandidateListSchema, aiAdapterCandidateSubmitSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiAdapterCandidateListSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({
      data: await getAiRepository().listWorkspaceAdapterCandidates(parsed.data.workspaceId, user.id),
      meta: { workspaceGoverned: true, routingAvailable: false, adapterActivation: false, execution: false },
    });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = aiAdapterCandidateSubmitSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().submitWorkspaceAdapterCandidate(parsed.data, user.id),
      meta: { status: "pending", routingAvailable: false, adapterActivation: false, execution: false },
    }, { status: 201 });
  } catch (error) { return apiError(error); }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({ error: { code: "validation_failed", message: "Check the adapter-candidate fields.", fields } }, { status: 422 });
}
