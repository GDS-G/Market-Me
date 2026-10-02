import Link from "next/link";
import { isAccountSessionError } from "@market-me/database";
import { AuthenticationError } from "@/server/auth";
import { requireAccountSessionActor } from "@/server/account-session-auth";
import { getAccountSessionRepository } from "@/server/database";
import { parseAccountSessionSnapshot, type AccountSessionList } from "./account-session-contract";
import { AccountSessionsPanel } from "./account-sessions-panel";

/** Server-only context never crosses the client prop boundary. Failure is isolated from other settings. */
export async function AccountSessionsSection({ accountId, cursor }: { accountId: string; cursor?: string }) {
  let snapshot: AccountSessionList | undefined, authentication = false;
  try {
    const actor = await requireAccountSessionActor();
    if (actor.accountId !== accountId) throw new AuthenticationError();
    snapshot = parseAccountSessionSnapshot(await getAccountSessionRepository().list(accountId, actor, cursor), accountId);
  } catch (error) {
    authentication = error instanceof AuthenticationError || isAccountSessionError(error) && error.code === "authentication_required";
  }
  if (snapshot) return <AccountSessionsPanel snapshot={snapshot} />;
  return <div role="alert"><p>{authentication ? "Your current sign-in session changed or expired. Sign in again to manage sessions."
      : "Your session list could not be confirmed. Reload the newest list before selecting a session. No sign-out request was sent."}</p>
      <Link href={authentication ? "/login" : "/settings"}>{authentication ? "Sign in again" : "Reload newest sessions"}</Link></div>;
}
