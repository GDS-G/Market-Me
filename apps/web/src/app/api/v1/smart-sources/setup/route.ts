import { normalizeSourceSetup, sourceSetupUuid, SourceSetupInputError } from "@market-me/domain";
import { requireWorkspaceAccess } from "@/server/auth";
import { getSourceSetupRepository } from "@/server/database";
import { readSourceSetupJson, requireSourceSetupOrigin, sourceSetupApiError, sourceSetupResponse } from "@/server/source-setup-api";

export async function POST(request: Request) {
  try {
    requireSourceSetupOrigin(request);
    if (new URL(request.url).search) throw new SourceSetupInputError("Put setup scope in the request body only.");
    const input = normalizeSourceSetup(await readSourceSetupJson(request));
    const { user } = await requireWorkspaceAccess(input.workspaceId, "write");
    const result = await getSourceSetupRepository().create(input, user.id);
    return sourceSetupResponse({ data: result }, result.replayed ? 200 : 201);
  } catch (error) { return sourceSetupApiError(error); }
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some((key) => !["workspaceId", "requestId"].includes(key)) || query.getAll("workspaceId").length !== 1 || query.getAll("requestId").length !== 1) {
      throw new SourceSetupInputError("Provide exactly one workspace and setup request.");
    }
    const workspaceId = sourceSetupUuid(query.get("workspaceId")), requestId = sourceSetupUuid(query.get("requestId"));
    const { user } = await requireWorkspaceAccess(workspaceId, "write");
    const result = await getSourceSetupRepository().getReceipt(workspaceId, requestId, user.id);
    return sourceSetupResponse({ data: result ?? null });
  } catch (error) { return sourceSetupApiError(error); }
}
