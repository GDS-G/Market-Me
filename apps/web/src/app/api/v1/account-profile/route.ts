import { AccountProfileError, accountProfileUuid, normalizeAccountProfileRequest } from "@market-me/database";
import { requireAuthenticatedUser } from "@/server/auth";
import { getAccountProfileRepository } from "@/server/database";
import { accountProfileApiError, accountProfileResponse, readAccountProfileJson, requireAccountProfileOrigin, requireAccountProfileSelf } from "@/server/account-profile-api";

export async function POST(request: Request) {
  try {
    requireAccountProfileOrigin(request);
    const user = await requireAuthenticatedUser(), input = normalizeAccountProfileRequest(await readAccountProfileJson(request));
    requireAccountProfileSelf(input.accountId, user.id);
    const result = await getAccountProfileRepository().save(input, user.id);
    return accountProfileResponse({ data: result.receipt, meta: { replayed: result.replayed } }, result.replayed ? 200 : 201);
  } catch (error) { return accountProfileApiError(error); }
}

/** Private current state or an exact historical receipt; never an account/request directory. */
export async function GET(request: Request) {
  try {
    const user = await requireAuthenticatedUser(), query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== "accountId" && key !== "requestId") || query.getAll("accountId").length !== 1
      || query.has("requestId") && query.getAll("requestId").length !== 1) throw new AccountProfileError("invalid_input", "Ambiguous profile query.");
    const account = accountProfileUuid(query.get("accountId")); requireAccountProfileSelf(account, user.id);
    const key = query.has("requestId") ? accountProfileUuid(query.get("requestId")) : undefined;
    const repository = getAccountProfileRepository();
    const data = key ? await repository.getReceipt(account, key, user.id) : await repository.getProfile(account, user.id);
    if (!data) throw new AccountProfileError("not_found", "No confirmed profile result.");
    return accountProfileResponse({ data });
  } catch (error) { return accountProfileApiError(error); }
}
