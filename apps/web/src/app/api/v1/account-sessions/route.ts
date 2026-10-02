import { AccountSessionError, accountSessionUuid, normalizeAccountSessionRequest } from "@market-me/database";
import { requireAccountSessionActor } from "@/server/account-session-auth";
import { getAccountSessionRepository } from "@/server/database";
import { accountSessionApiError, accountSessionResponse, readAccountSessionJson, requireAccountSessionOrigin, requireAccountSessionSelf } from "@/server/account-session-api";

export async function POST(request: Request) {
  try {
    requireAccountSessionOrigin(request);
    const actor = await requireAccountSessionActor(), input = normalizeAccountSessionRequest(await readAccountSessionJson(request));
    requireAccountSessionSelf(input.accountId, actor.accountId);
    const result = await getAccountSessionRepository().revoke(input, actor);
    return accountSessionResponse({ data: result.receipt, meta: { replayed: result.replayed } }, result.replayed ? 200 : 201);
  } catch (error) { return accountSessionApiError(error); }
}
export async function GET(request: Request) {
  try {
    const actor = await requireAccountSessionActor(), query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !["accountId", "requestId", "cursor"].includes(key)) || query.getAll("accountId").length !== 1
      || query.has("requestId") && (query.getAll("requestId").length !== 1 || query.has("cursor"))
      || query.has("cursor") && query.getAll("cursor").length !== 1) throw new AccountSessionError("invalid_input", "Ambiguous session query.");
    const accountId = accountSessionUuid(query.get("accountId")); requireAccountSessionSelf(accountId, actor.accountId);
    const key = query.has("requestId") ? accountSessionUuid(query.get("requestId")) : undefined;
    const repository = getAccountSessionRepository();
    const data = key ? await repository.getReceipt(accountId, key, actor) : await repository.list(accountId, actor, query.get("cursor") ?? undefined);
    if (!data) throw new AccountSessionError("not_found", "No confirmed receipt.");
    return accountSessionResponse({ data });
  } catch (error) { return accountSessionApiError(error); }
}
