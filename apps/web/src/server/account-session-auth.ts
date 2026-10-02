import "server-only";
import { cookies } from "next/headers";
import type { AccountSessionActor } from "@market-me/database";
import { AuthenticationError, hashOpaqueToken, SESSION_COOKIE } from "./auth";
import { getRepository } from "./database";

/** Internal only: never pass this object to a client component or Response.json. */
export async function requireAccountSessionActor(): Promise<AccountSessionActor> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) throw new AuthenticationError();
  const tokenHash = hashOpaqueToken(token), user = await getRepository().getSession(tokenHash);
  if (!user) throw new AuthenticationError();
  return { accountId: user.id, tokenHash };
}
