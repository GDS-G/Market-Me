import { preparationPresetUuid, PreparationPresetError } from "@market-me/database";
import { requireWorkspaceAccess } from "@/server/auth";
import { getPreparationPresetRepository } from "@/server/database";
import { presetApiError, presetResponse } from "@/server/preparation-preset-api";

/** A bounded values chooser, never a private request-key or configuration directory. */
export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !["workspaceId", "page"].includes(key))
      || query.getAll("workspaceId").length !== 1 || query.getAll("page").length > 1) {
      throw new PreparationPresetError("invalid_input", "Choose one workspace and preset page.");
    }
    const workspaceId = preparationPresetUuid(query.get("workspaceId"));
    const rawPage = query.get("page") ?? "1";
    if (!/^[1-9][0-9]{0,3}$/.test(rawPage) || Number(rawPage) > 2_000) {
      throw new PreparationPresetError("invalid_input", "Choose a preset page from 1 to 2000.");
    }
    const page = Number(rawPage);
    const { user } = await requireWorkspaceAccess(workspaceId, "write");
    const result = await getPreparationPresetRepository().list(workspaceId, user.id, page);
    return presetResponse({ data: {
      workspaceId, page, more: result.more,
      items: result.items.map(item => ({ id: item.id, revision: item.revision,
        versionNumber: item.latestVersionNumber, title: item.title, archived: item.archived })),
    } });
  } catch (error) { return presetApiError(error); }
}
