import { AI_ASSISTANT_ACTIONS, type AiAssistantAssignment } from "@market-me/domain";
import { selectAiAssistant } from "@market-me/generation";
import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { aiAssistantAssignmentsSchema } from "@/server/ai-schema";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const assignments = await getAiRepository().listAssistantAssignments(
      workspace.workspaceId,
    );
    return Response.json({
      data: assignmentResponse(assignments),
      meta: { execution: false, providerSelection: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = aiAssistantAssignmentsSchema.safeParse(await request.json());
    if (!parsed.success)
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Choose one compatible assistant per action.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const assignments = await getAiRepository().replaceAssistantAssignments(
      parsed.data,
      user.id,
    );
    return Response.json({
      data: assignmentResponse(assignments),
      meta: { execution: false, providerSelection: false },
    });
  } catch (error) {
    return apiError(error);
  }
}

function assignmentResponse(
  assignments: readonly AiAssistantAssignment[],
) {
  const byAction = new Map(
    assignments.map((assignment) => [assignment.action, assignment.profileId]),
  );
  return {
    assignments,
    selections: AI_ASSISTANT_ACTIONS.map((action) =>
      selectAiAssistant(action, byAction.get(action)),
    ),
  };
}
