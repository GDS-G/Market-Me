import { normalizeWorkspaceMemberRemovalRequest, workspaceMemberLifecycleUuid, WorkspaceMemberLifecycleError } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getWorkspaceMemberLifecycleRepository } from "@/server/database";
import { readMemberRemovalJson, requireMemberRemovalOrigin, memberRemovalApiError, memberRemovalResponse } from "@/server/workspace-member-lifecycle-api";

export async function POST(request: Request) {
  try {
    requireMemberRemovalOrigin(request);
    const user = await requireAuthenticatedUser(), input = normalizeWorkspaceMemberRemovalRequest(await readMemberRemovalJson(request));
    const result = await getWorkspaceMemberLifecycleRepository().remove(input, user.id);
    return memberRemovalResponse({ data: result.receipt, meta: { replayed: result.replayed } }, result.replayed ? 200 : 201);
  } catch (error) { return memberRemovalApiError(error); }
}

/** One nonmutating current preview OR the original actor's exact historical receipt. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(), query = new URL(request.url).searchParams;
    const choice = query.has("targetUserId") ? "targetUserId" : "requestId", allowed = ["workspaceId", choice];
    if ([...query.keys()].some(key => !allowed.includes(key)) || allowed.some(key => query.getAll(key).length !== 1)) {
      throw new WorkspaceMemberLifecycleError("invalid_input", "Choose exactly one member preview or original request.");
    }
    const workspace = workspaceMemberLifecycleUuid(query.get("workspaceId")), key = workspaceMemberLifecycleUuid(query.get(choice));
    const repository = getWorkspaceMemberLifecycleRepository();
    if (choice === "targetUserId") return memberRemovalResponse({ data: await repository.preview(workspace, key, user.id) });
    const saved = await repository.getReceipt(workspace, key, user.id);
    if (!saved) throw new WorkspaceMemberLifecycleError("not_found", "No original receipt yet.");
    return memberRemovalResponse({ data: saved });
  } catch (error) { return memberRemovalApiError(error); }
}
