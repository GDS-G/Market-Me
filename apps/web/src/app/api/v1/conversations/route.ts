import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import {
  conversationThreadQuerySchema,
  conversationThreadWriteSchema,
} from "@/server/conversation-schema";
import { getConversationRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    const parsed = conversationThreadQuerySchema.safeParse(
      Object.fromEntries(
        [...searchParams.entries()].filter(([key]) => key !== "workspaceId"),
      ),
    );
    if (!parsed.success)
      return validationResponse(parsed.error.flatten().fieldErrors);
    const { workspace, user } = await requireWorkspaceAccess(
      searchParams.get("workspaceId") ?? undefined,
    );
    const {
      owner,
      read,
      campaign,
      destination,
      brand,
      account,
      publication,
      activityFrom,
      activityTo,
      ...query
    } = parsed.data;
    const data = await getConversationRepository().listThreads(
      workspace.workspaceId,
      {
        ...query,
        campaignId: campaign,
        destinationId: destination,
        brandProfileId: brand,
        channelConnectionId: account,
        publicationActionId: publication,
        assignedOwnerId:
          owner === "me" ? user.id : owner === "unassigned" ? null : owner,
        unread: read === "unread" ? true : read === "read" ? false : undefined,
        activityFrom: activityFrom
          ? `${activityFrom}T00:00:00.000Z`
          : undefined,
        activityTo: activityTo ? `${activityTo}T23:59:59.999Z` : undefined,
      },
      user.id,
    );
    return Response.json({
      data,
      meta: { count: data.length, limit: parsed.data.limit },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = conversationThreadWriteSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success)
      return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const data = await getConversationRepository().saveThread(
      parsed.data,
      user.id,
    );
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    if (isConversationValidationError(error))
      return repositoryValidationResponse(error);
    return apiError(error);
  }
}

function validationResponse(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the conversation fields.",
        fields,
      },
    },
    { status: 422 },
  );
}

function repositoryValidationResponse(error: {
  issues: { field: string; message: string }[];
}) {
  return validationResponse(
    Object.fromEntries(
      error.issues.map((issue) => [issue.field, [issue.message]]),
    ),
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
