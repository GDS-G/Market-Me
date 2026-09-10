import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRelationshipRepository } from "@/server/database";
import { relationshipIdentityLinkWriteSchema } from "@/server/relationship-schema";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const data = await getRelationshipRepository().getIdentityResolution(
      workspace.workspaceId,
      (await context.params).id,
    );
    return data
      ? Response.json({ data })
      : Response.json(
          { error: { code: "not_found", message: "Relationship not found." } },
          { status: 404 },
        );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const parsed = relationshipIdentityLinkWriteSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success)
      return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const data = await getRelationshipRepository().saveIdentityLink(
      {
        ...parsed.data,
        relationshipId: (await context.params).id,
      },
      user.id,
    );
    return data
      ? Response.json({ data }, { status: 201 })
      : Response.json(
          { error: { code: "not_found", message: "Relationship not found." } },
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
        message: "Check the identity-link fields.",
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
