import { apiError } from "@/server/api-response";
import {
  aiTextInvocationIntentListSchema,
  aiTextInvocationIntentPrepareSchema,
} from "@/server/ai-schema";
import { requireWorkspaceAccess } from "@/server/auth";
import { getAiRepository } from "@/server/database";

export async function GET(request: Request) {
  try {
    const parsed = aiTextInvocationIntentListSchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId);
    return Response.json({
      data: await getAiRepository().listWorkspaceTextInvocationIntents(
        parsed.data.workspaceId, user.id,
      ),
    });
  } catch (error) {
    if (isValidationError(error)) return policyValidation(error);
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const parsed = aiTextInvocationIntentPrepareSchema.safeParse(await request.json());
    if (!parsed.success) return validation(parsed.error.flatten().fieldErrors);
    const { user } = await requireWorkspaceAccess(parsed.data.workspaceId, "write");
    return Response.json({
      data: await getAiRepository().prepareWorkspaceTextInvocationIntent(parsed.data, user.id),
    }, { status: 201 });
  } catch (error) {
    if (isValidationError(error)) return policyValidation(error);
    return apiError(error);
  }
}

function validation(fields: Record<string, string[] | undefined>) {
  return Response.json({ error: { code: "validation_failed", message: "The text invocation intent is not valid.", fields } }, { status: 422 });
}

function policyValidation(error: { issues: { field: string; message: string }[] }) {
  return validation(Object.fromEntries(error.issues.map((issue) => [issue.field, [issue.message]])));
}

function isValidationError(error: unknown): error is { issues: { field: string; message: string }[] } {
  return Boolean(error && typeof error === "object" && "name" in error && error.name === "AiPolicyValidationError" && "issues" in error && Array.isArray(error.issues));
}
