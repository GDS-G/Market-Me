import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { conversationRetentionPolicySchema } from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const repository = getConversationRepository();
    const canOperateHolds = ["owner", "admin", "editor", "approver"].includes(
      workspace.role,
    );
    const [
      policy,
      candidates,
      erasureRequests,
      activeLegalHolds,
      legalHoldReleaseRequests,
      recentLegalHoldReleaseDecisions,
    ] = await Promise.all([
      repository.getRetentionPolicy(workspace.workspaceId),
      repository.listRetentionCandidates(workspace.workspaceId),
      repository.listRetentionErasureRequests(workspace.workspaceId),
      canOperateHolds
        ? repository.listActiveLegalHolds(workspace.workspaceId)
        : Promise.resolve([]),
      canOperateHolds
        ? repository.listPendingLegalHoldReleaseRequests(workspace.workspaceId)
        : Promise.resolve([]),
      canOperateHolds
        ? repository.listRecentLegalHoldReleaseDecisions(workspace.workspaceId)
        : Promise.resolve([]),
    ]);
    return Response.json({
      data: {
        policy,
        candidates,
        erasureRequests,
        activeLegalHolds,
        legalHoldReleaseRequests,
        recentLegalHoldReleaseDecisions,
      },
      meta: {
        candidateCount: candidates.length,
        activeLegalHoldCount: activeLegalHolds.length,
        pendingLegalHoldReleaseCount: legalHoldReleaseRequests.length,
        recentLegalHoldReleaseDecisionCount:
          recentLegalHoldReleaseDecisions.length,
        limit: 200,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const parsed = conversationRetentionPolicySchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    const data = await getConversationRepository().saveRetentionPolicy(
      parsed.data,
      user.id,
    );
    return Response.json({ data });
  } catch (error) {
    if (isConversationValidationError(error))
      return validation(
        Object.fromEntries(
          error.issues.map((issue) => [issue.field, [issue.message]]),
        ),
      );
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the conversation retention policy.",
        fields,
      },
    },
    { status: 422 },
  );
}

function isConversationValidationError(error: unknown): error is {
  name: "ConversationValidationError";
  issues: { field: string; message: string }[];
} {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "ConversationValidationError" &&
      "issues" in error &&
      Array.isArray(error.issues),
  );
}
