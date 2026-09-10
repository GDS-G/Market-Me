import { apiError } from "@/server/api-response";
import { requireWorkspaceAccess } from "@/server/auth";
import { getRelationshipRepository } from "@/server/database";
import { relationshipWriteSchema } from "@/server/relationship-schema";

export async function GET(request: Request) {
  try {
    const { workspace } = await requireWorkspaceAccess(
      new URL(request.url).searchParams.get("workspaceId") ?? undefined,
    );
    const data = await getRelationshipRepository().listRelationships(
      workspace.workspaceId,
    );
    return Response.json({ data, meta: { count: data.length } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = relationshipWriteSchema.safeParse(await request.json());
    if (!parsed.success)
      return validationResponse(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(
      parsed.data.workspaceId,
      "write",
    );
    const data = await getRelationshipRepository().saveRelationship(
      parsed.data,
      user.id,
    );
    return Response.json({ data }, { status: 201 });
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
        message: "Check the relationship fields.",
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
