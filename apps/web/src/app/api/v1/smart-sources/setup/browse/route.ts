import { SourceSetupInputError } from "@market-me/domain";
import { requireWorkspaceAccess } from "@/server/auth";
import { getServerConfiguration } from "@/server/config";
import { getIngestionService } from "@/server/ingestion";
import { openSourceSetupCursor, sealSourceSetupCursor, sourceSetupBrowseSchema } from "@/server/source-setup-browse";
import { readSourceSetupJson, requireSourceSetupOrigin, sourceSetupApiError, sourceSetupResponse, SourceSetupTransportError } from "@/server/source-setup-api";

export async function POST(request: Request) {
  try {
    requireSourceSetupOrigin(request);
    if (new URL(request.url).search) throw new SourceSetupInputError("Folder browsing accepts settings in the request body only.");
    const parsed = sourceSetupBrowseSchema.safeParse(await readSourceSetupJson(request));
    if (!parsed.success) throw new SourceSetupInputError("Choose a valid connection and folder.");
    const input = parsed.data;
    const { user } = await requireWorkspaceAccess(input.workspaceId, "write");
    const key = getServerConfiguration().connectorTokenEncryptionKey;
    if (!key) throw new SourceSetupTransportError("storage_not_configured", 503, "Storage browsing needs the server's configured connection encryption key.");
    const pageToken = openSourceSetupCursor(input, user.id, key);
    const { connection, connector, accessToken } = await getIngestionService().getConnectionAccessToken(input.workspaceId, input.connectionId);
    if (connection.provider !== input.provider) throw new SourceSetupInputError("This connection belongs to another storage provider.");
    const page = await connector.listFolderPage({ accessToken, providerLocationId: input.locationId, pageToken });
    await requireWorkspaceAccess(input.workspaceId, "write");
    const folders = page.entries.filter((entry) => entry.isFolder).map((entry) => ({
      providerLocationId: input.provider === "sharepoint" ? `${input.locationId.split(":", 1)[0]}:${entry.providerItemId}` : entry.providerItemId,
      name: entry.name,
    }));
    return sourceSetupResponse({ data: { folders, examinedCount: page.entries.length, incompleteSearch: page.incompleteSearch === true,
      nextCursor: sealSourceSetupCursor(input, user.id, page.nextPageToken, key) } });
  } catch (error) { return sourceSetupApiError(error, "browse"); }
}
