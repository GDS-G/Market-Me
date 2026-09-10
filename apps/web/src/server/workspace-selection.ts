import type { WorkspaceAccess } from "@market-me/database";

export const ACTIVE_WORKSPACE_COOKIE = "mm_active_workspace";
export const ACTIVE_WORKSPACE_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export interface WorkspaceSwitchState {
  error?: string;
}

/** A cookie selects among current memberships; it never grants workspace access. */
export function selectActiveWorkspace(
  workspaces: readonly WorkspaceAccess[],
  workspaceHint?: string,
): WorkspaceAccess | undefined {
  return workspaces.find((workspace) => workspace.workspaceId === workspaceHint) ?? workspaces[0];
}

const WORKSPACE_SECTION_PATHS = new Set([
  "/", "/smart-sources", "/context-packs", "/content-packages", "/drafts",
  "/campaigns", "/approvals", "/calendar", "/conversations", "/ai-settings",
  "/audience", "/destinations", "/integrations", "/companion", "/team", "/settings",
]);

/** Switching leaves record IDs, filters, and query strings in the previous workspace. */
export function workspaceSwitchReturnPath(value: FormDataEntryValue | null): string {
  return typeof value === "string" && WORKSPACE_SECTION_PATHS.has(value) ? value : "/";
}

export function isWorkspaceSwitchOriginAllowed(origin: string | null, appBaseUrl: string): boolean {
  if (!origin) return false;
  try {
    const configured = new URL(appBaseUrl);
    const requested = new URL(origin);
    return ["http:", "https:"].includes(configured.protocol)
      && origin === requested.origin
      && requested.origin === configured.origin;
  } catch {
    return false;
  }
}
