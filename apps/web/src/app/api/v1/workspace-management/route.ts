import { normalizeWorkspaceManagementRequest, workspaceManagementUuid, WorkspaceManagementError } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getWorkspaceManagementRepository } from "@/server/database";
import { readWorkspaceManagementJson, requireWorkspaceManagementOrigin, workspaceManagementApiError, workspaceManagementResponse } from "@/server/workspace-management-api";

export async function POST(request: Request) {
  try {
    requireWorkspaceManagementOrigin(request);
    const user = await requireAuthenticatedUser();
    const input = normalizeWorkspaceManagementRequest(await readWorkspaceManagementJson(request));
    const result = await getWorkspaceManagementRepository().mutate(input, user.id);
    return workspaceManagementResponse({ data: result.receipt, meta: { replayed: result.replayed } }, result.replayed ? 200 : 201);
  } catch (error) { return workspaceManagementApiError(error); }
}

/** Actor-private result lookup, never a workspace or request-key directory. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(), query = new URL(request.url).searchParams;
    const operation = query.get("operation");
    if (operation !== "create" && operation !== "rename") throw new WorkspaceManagementError("invalid_input", "Choose one saved workspace operation.");
    const scopeKey = operation === "create" ? "organizationId" : "workspaceId", allowed = ["operation", scopeKey, "requestId"];
    if ([...query.keys()].some(key => !allowed.includes(key)) || allowed.some(key => query.getAll(key).length !== 1)) {
      throw new WorkspaceManagementError("invalid_input", "Choose one workspace scope and request identifier.");
    }
    const scope = workspaceManagementUuid(query.get(scopeKey)), requestId = workspaceManagementUuid(query.get("requestId"));
    const saved = await getWorkspaceManagementRepository().getReceipt(operation === "create"
      ? { operation, organizationId: scope } : { operation, workspaceId: scope }, requestId, user.id);
    return saved ? workspaceManagementResponse({ data: saved }) : workspaceManagementResponse({ error: {
      code: "not_found", message: "No completed workspace request was found yet. An earlier request may still finish." } }, 404);
  } catch (error) { return workspaceManagementApiError(error); }
}
