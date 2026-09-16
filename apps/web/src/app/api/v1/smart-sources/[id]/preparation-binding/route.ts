import { z } from "zod";
import { requireWorkspaceAccess } from "@/server/auth";
import { getSourcePreparationRepository } from "@/server/database";
import {
  readSourcePreparationJson,
  sourcePreparationApiError,
  sourcePreparationOriginError,
  sourcePreparationResponse,
} from "@/server/source-preparation-api";
import {
  sourcePreparationBindingBody,
  sourcePreparationBindingPath,
  sourcePreparationBindingQuery,
  sourcePreparationQuery,
} from "@/server/source-preparation-schema";
import { sourcePreparationBindingView } from "@/server/source-preparation-view";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const path = sourcePreparationBindingPath.parse(await context.params);
    const query = sourcePreparationBindingQuery.parse(sourcePreparationQuery(request));
    const { user, workspace } = await requireWorkspaceAccess(query.workspaceId);
    const binding = await getSourcePreparationRepository().getSourcePreparationBindingForSource(
      workspace.workspaceId, path.id, user.id,
    );
    return binding
      ? sourcePreparationResponse({ data: sourcePreparationBindingView(binding) })
      : sourcePreparationResponse({ error: { code: "binding_unavailable", message: "No preparation binding is configured for this Smart Source." } }, 404);
  } catch (error) {
    return sourcePreparationApiError(error);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const originError = sourcePreparationOriginError(request);
  if (originError) return originError;
  try {
    const path = sourcePreparationBindingPath.parse(await context.params);
    const query = sourcePreparationBindingQuery.parse(sourcePreparationQuery(request));
    const input = sourcePreparationBindingBody.parse(await readSourcePreparationJson(request));
    if (query.workspaceId !== input.workspaceId) {
      throw new z.ZodError([{ code: "custom", path: ["workspaceId"], message: "The request workspace does not match its body." }]);
    }
    const { user, workspace } = await requireWorkspaceAccess(input.workspaceId, "write");
    const binding = await getSourcePreparationRepository().saveSourcePreparationBinding({
      ...input,
      workspaceId: workspace.workspaceId,
      smartSourceId: path.id,
    }, user.id);
    return sourcePreparationResponse({ data: sourcePreparationBindingView(binding) });
  } catch (error) {
    return sourcePreparationApiError(error);
  }
}
