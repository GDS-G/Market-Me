import { preparationUuid } from "./campaign-preparation-request";

/** A current-selection hint, never workspace or mutation authority. */
export function campaignInspectionPath(workspaceId: string, campaignId: string): string {
  return `/campaigns/${preparationUuid.parse(campaignId).toLowerCase()}?${new URLSearchParams({ workspaceId: preparationUuid.parse(workspaceId).toLowerCase() })}`;
}
