import { normalizeWorkspaceMemberRoleRequest, workspaceMemberRoleUuid, WorkspaceMemberRoleError } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getWorkspaceMemberRoleRepository } from "@/server/database";
import { readMemberRoleJson, requireMemberRoleOrigin, memberRoleApiError, memberRoleResponse } from "@/server/workspace-member-role-api";

export async function POST(request: Request) {
  try {
    requireMemberRoleOrigin(request);
    const user = await requireAuthenticatedUser();
    const input = normalizeWorkspaceMemberRoleRequest(await readMemberRoleJson(request));
    const result = await getWorkspaceMemberRoleRepository().mutate(input, user.id);
    return memberRoleResponse({ data: result.receipt, meta: { replayed: result.replayed } }, result.replayed ? 200 : 201);
  } catch (error) { return memberRoleApiError(error); }
}

/** Original actor's result only; not a directory of permission-change history. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(), query = new URL(request.url).searchParams, allowed = ["workspaceId", "requestId"];
    if ([...query.keys()].some(key => !allowed.includes(key)) || allowed.some(key => query.getAll(key).length !== 1)) {
      throw new WorkspaceMemberRoleError("invalid_input", "Choose one workspace and saved request identifier.");
    }
    const workspace = workspaceMemberRoleUuid(query.get("workspaceId")), key = workspaceMemberRoleUuid(query.get("requestId"));
    const saved = await getWorkspaceMemberRoleRepository().getReceipt(workspace, key, user.id);
    return saved ? memberRoleResponse({ data: saved }) : memberRoleResponse({ error: {
      code: "not_found", message: "No completed member-role request was found yet. An earlier request may still finish." } }, 404);
  } catch (error) { return memberRoleApiError(error); }
}
