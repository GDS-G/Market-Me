import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { AuthenticatedUser, WorkspaceAccess, WorkspaceRole } from "@market-me/database";
import { getRepository } from "./database";
import { getActiveWorkspace } from "./active-workspace";
import { ACTIVE_WORKSPACE_COOKIE } from "./workspace-selection";

export const SESSION_COOKIE = "mm_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export async function createUserSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await getRepository().createSession({ tokenHash: hashOpaqueToken(token), userId, expiresAt });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteUserSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await getRepository().deleteSession(hashOpaqueToken(token));
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(ACTIVE_WORKSPACE_COOKIE);
}

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | undefined> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return undefined;
  return getRepository().getSession(hashOpaqueToken(token));
}

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication required");
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor() {
    super("You do not have access to this workspace");
    this.name = "AuthorizationError";
  }
}

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser();
  if (!user) throw new AuthenticationError();
  return user;
}

const WRITE_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "editor"];
const APPROVE_ROLES: readonly WorkspaceRole[] = ["owner", "admin", "approver"];

export async function requireWorkspaceAccess(
  workspaceId?: string,
  mode: "read" | "write" | "approve" = "read",
): Promise<{ user: AuthenticatedUser; workspace: WorkspaceAccess }> {
  const user = await requireAuthenticatedUser();
  const repository = getRepository();
  const workspace = workspaceId
    ? await repository.getWorkspaceAccess(user.id, workspaceId)
    : await getActiveWorkspace(user.id);
  if (!workspace) throw new AuthorizationError();
  if (mode === "write" && !WRITE_ROLES.includes(workspace.role)) throw new AuthorizationError();
  if (mode === "approve" && !APPROVE_ROLES.includes(workspace.role)) throw new AuthorizationError();
  return { user, workspace };
}
