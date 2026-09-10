import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRelationshipRepository } from "@/server/database";
import { relationshipIdentityLinkDecisionSchema } from "@/server/relationship-schema";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; linkId: string }> },
) {
  try {
    const parsed = relationshipIdentityLinkDecisionSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success)
      return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const { id, linkId } = await context.params;
    const data = await getRelationshipRepository().reviewIdentityLink(
      {
        ...parsed.data,
        relationshipId: id,
        linkId,
      },
      user.id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          { error: { code: "not_found", message: "Identity link not found." } },
          { status: 404 },
        );
  } catch (error) {
    if (isRelationshipValidationError(error)) {
      return validationResponse(
        Object.fromEntries(
          error.issues.map((issue) => [issue.field, [issue.message]]),
        ),
      );
    }
    return apiError(error);
  }
}

function validationResponse(fields: Record<string, string[] | undefined>) {
  return Response.json(
    {
      error: {
        code: "validation_failed",
        message: "Check the identity-link decision.",
        fields,
      },
    },
    { status: 422 },
  );
}

function isRelationshipValidationError(
  error: unknown,
): error is {
  name: "RelationshipValidationError";
  issues: { field: string; message: string }[];
} {
  return Boolean(
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "RelationshipValidationError" &&
    "issues" in error &&
    Array.isArray(error.issues),
  );
}
