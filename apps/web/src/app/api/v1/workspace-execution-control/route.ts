import { normalizeWorkspaceExecutionControlRequest, workspaceExecutionControlUuid, WorkspaceExecutionControlError } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getWorkspaceExecutionControlRepository } from "@/server/database";
import { executionControlApiError, executionControlResponse, readExecutionControlJson, requireExecutionControlOrigin } from "@/server/workspace-execution-control-api";

export async function POST(request: Request) {
  try {
    requireExecutionControlOrigin(request);
    const user = await requireAuthenticatedUser(), input = normalizeWorkspaceExecutionControlRequest(await readExecutionControlJson(request));
    const result = await getWorkspaceExecutionControlRepository().mutate(input, user.id);
    return executionControlResponse({ data: result.receipt, meta: { replayed: result.replayed } }, result.replayed ? 200 : 201);
  } catch (error) { return executionControlApiError(error); }
}
/** Current member state OR one original creator-private receipt; never a mutation. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(), query = new URL(request.url).searchParams;
    const allowed = query.has("requestId") ? ["workspaceId", "requestId"] : ["workspaceId"];
    if ([...query.keys()].some(key => !allowed.includes(key)) || allowed.some(key => query.getAll(key).length !== 1)) {
      throw new WorkspaceExecutionControlError("invalid_input", "Choose one current workspace or original request.");
    }
    const workspace = workspaceExecutionControlUuid(query.get("workspaceId")), repository = getWorkspaceExecutionControlRepository();
    if (!query.has("requestId")) return executionControlResponse({ data: await repository.getSnapshot(workspace, user.id) });
    const receipt = await repository.getReceipt(workspace, workspaceExecutionControlUuid(query.get("requestId")), user.id);
    if (!receipt) throw new WorkspaceExecutionControlError("not_found", "No original receipt yet.");
    return executionControlResponse({ data: receipt });
  } catch (error) { return executionControlApiError(error); }
}
