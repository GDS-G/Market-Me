import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRelationshipRepository } from "@/server/database";
import { relationshipIdentityCandidateScanSchema } from "@/server/relationship-schema";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const data = await getRelationshipRepository().listIdentitySuggestions(
      workspace.workspaceId,
    );
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = relationshipIdentityCandidateScanSchema.safeParse(
      await request.json(),
    );
    if (!parsed.success) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "Check the identity-candidate scan fields.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        { status: 422 },
      );
    }
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const data = await getRelationshipRepository().scanIdentityCandidates(
      parsed.data.workspaceId,
      user.id,
    );
    return Response.json({ data });
  } catch (error) {
    if (isRelationshipValidationError(error)) {
      return Response.json(
        {
          error: {
            code: "validation_failed",
            message: "The identity-candidate scan could not run.",
            fields: Object.fromEntries(
              error.issues.map((issue) => [issue.field, [issue.message]]),
            ),
          },
        },
        { status: 422 },
      );
    }
    return apiError(error);
  }
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
