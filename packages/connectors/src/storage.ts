import type {
  ChangePage,
  ConnectorFetch,
  FolderPage,
  NormalizedStorageEntry,
  StorageProvider,
} from "./types";

type JsonObject = Record<string, unknown>;

async function fetchJson(request: ConnectorFetch, url: URL | string, accessToken: string): Promise<JsonObject> {
  const response = await request(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
  });
  const payload = (await response.json()) as JsonObject;
  if (!response.ok) throw new Error(`Storage provider request failed with HTTP ${response.status}`);
  return payload;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function googleEntry(file: JsonObject): NormalizedStorageEntry {
  const parents = Array.isArray(file.parents) ? file.parents : [];
  const mimeType = stringValue(file.mimeType) ?? "application/octet-stream";
  return {
    provider: "google_drive",
    providerItemId: String(file.id),
    providerParentId: stringValue(parents[0]),
    name: stringValue(file.name) ?? "Untitled",
    mimeType,
    sizeBytes: numberValue(file.size),
    modifiedAt: stringValue(file.modifiedTime),
    contentHash: stringValue(file.md5Checksum) ? `md5:${file.md5Checksum}` : undefined,
    webUrl: stringValue(file.webViewLink),
    isFolder: mimeType === "application/vnd.google-apps.folder",
  };
}

function graphEntry(provider: "onedrive" | "sharepoint", item: JsonObject): NormalizedStorageEntry {
  const file = item.file && typeof item.file === "object" ? item.file as JsonObject : undefined;
  const folder = item.folder && typeof item.folder === "object";
  const parent = item.parentReference && typeof item.parentReference === "object"
    ? item.parentReference as JsonObject
    : undefined;
  const hashes = file?.hashes && typeof file.hashes === "object" ? file.hashes as JsonObject : undefined;
  const hash = stringValue(hashes?.quickXorHash) ?? stringValue(hashes?.sha1Hash) ?? stringValue(hashes?.sha256Hash);
  return {
    provider,
    providerItemId: String(item.id),
    providerParentId: stringValue(parent?.id),
    name: stringValue(item.name) ?? "Untitled",
    mimeType: folder ? "application/vnd.microsoft.folder" : stringValue(file?.mimeType) ?? "application/octet-stream",
    sizeBytes: numberValue(item.size),
    modifiedAt: stringValue(item.lastModifiedDateTime),
    contentHash: hash ? `graph:${hash}` : undefined,
    providerEtag: stringValue(item.eTag) ?? stringValue(item.cTag),
    webUrl: stringValue(item.webUrl),
    isFolder: Boolean(folder),
  };
}

function assertGraphContinuation(urlValue: string): string {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") {
    throw new Error("Rejected an untrusted Microsoft Graph continuation URL");
  }
  return url.toString();
}

function microsoftLocation(provider: "onedrive" | "sharepoint", value: string): { driveId?: string; itemId: string } {
  if (provider === "onedrive") return { itemId: value };
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("SharePoint locations must use driveId:itemId format");
  }
  return { driveId: value.slice(0, separator), itemId: value.slice(separator + 1) };
}

function microsoftItemBase(provider: "onedrive" | "sharepoint", providerLocationId: string): string {
  const location = microsoftLocation(provider, providerLocationId);
  const itemSegment = location.itemId === "root" ? "root" : `items/${encodeURIComponent(location.itemId)}`;
  return provider === "onedrive"
    ? `https://graph.microsoft.com/v1.0/me/drive/${itemSegment}`
    : `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(location.driveId!)}/${itemSegment}`;
}

export async function listGoogleFolderPage(
  request: ConnectorFetch,
  input: { accessToken: string; providerLocationId: string; pageToken?: string },
): Promise<FolderPage> {
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  const safeFolderId = input.providerLocationId.replaceAll("'", "\\'");
  url.searchParams.set("q", `'${safeFolderId}' in parents and trashed = false`);
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("spaces", "drive");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("fields", "nextPageToken,incompleteSearch,files(id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink,parents,trashed)");
  if (input.pageToken) url.searchParams.set("pageToken", input.pageToken);
  const payload = await fetchJson(request, url, input.accessToken);
  return {
    entries: (Array.isArray(payload.files) ? payload.files : []).map((file) => googleEntry(file as JsonObject)),
    nextPageToken: stringValue(payload.nextPageToken),
    incompleteSearch: payload.incompleteSearch === true,
  };
}

export async function listGoogleChangePage(
  request: ConnectorFetch,
  input: { accessToken: string; cursor?: string },
): Promise<ChangePage> {
  if (!input.cursor) {
    const start = await fetchJson(request, "https://www.googleapis.com/drive/v3/changes/startPageToken?supportsAllDrives=true", input.accessToken);
    return { entries: [], deletedProviderItemIds: [], newCursor: stringValue(start.startPageToken) };
  }
  const url = new URL("https://www.googleapis.com/drive/v3/changes");
  url.searchParams.set("pageToken", input.cursor);
  url.searchParams.set("pageSize", "200");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("restrictToMyDrive", "false");
  url.searchParams.set("fields", "nextPageToken,newStartPageToken,changes(fileId,removed,time,file(id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink,parents,trashed))");
  const payload = await fetchJson(request, url, input.accessToken);
  const changes = Array.isArray(payload.changes) ? payload.changes as JsonObject[] : [];
  const removed = changes.filter((change) => change.removed === true).map((change) => String(change.fileId));
  const entries = changes
    .filter((change) => change.removed !== true && change.file && typeof change.file === "object")
    .map((change) => googleEntry(change.file as JsonObject));
  return {
    entries,
    deletedProviderItemIds: removed,
    nextPageToken: stringValue(payload.nextPageToken),
    newCursor: stringValue(payload.newStartPageToken),
  };
}

export async function listMicrosoftFolderPage(
  request: ConnectorFetch,
  provider: "onedrive" | "sharepoint",
  input: { accessToken: string; providerLocationId: string; pageToken?: string },
): Promise<FolderPage> {
  const urlValue = input.pageToken
    ? assertGraphContinuation(input.pageToken)
    : `${microsoftItemBase(provider, input.providerLocationId)}/children?$select=id,name,size,lastModifiedDateTime,webUrl,eTag,cTag,file,folder,parentReference&$top=200`;
  const payload = await fetchJson(request, urlValue, input.accessToken);
  return {
    entries: (Array.isArray(payload.value) ? payload.value : []).map((item) => graphEntry(provider, item as JsonObject)),
    nextPageToken: stringValue(payload["@odata.nextLink"]),
  };
}

export async function listMicrosoftChangePage(
  request: ConnectorFetch,
  provider: "onedrive" | "sharepoint",
  input: { accessToken: string; providerLocationId?: string; cursor?: string },
): Promise<ChangePage> {
  if (!input.providerLocationId && !input.cursor) throw new Error("A provider location is required to start Microsoft delta");
  const urlValue = input.cursor
    ? assertGraphContinuation(input.cursor)
    : `${microsoftItemBase(provider, input.providerLocationId!)}/delta?$select=id,name,size,lastModifiedDateTime,webUrl,eTag,cTag,file,folder,parentReference,deleted`;
  const payload = await fetchJson(request, urlValue, input.accessToken);
  const values = Array.isArray(payload.value) ? payload.value as JsonObject[] : [];
  return {
    entries: values.filter((item) => !(item.deleted && typeof item.deleted === "object")).map((item) => graphEntry(provider, item)),
    deletedProviderItemIds: values.filter((item) => item.deleted && typeof item.deleted === "object").map((item) => String(item.id)),
    nextPageToken: stringValue(payload["@odata.nextLink"]),
    newCursor: stringValue(payload["@odata.deltaLink"]),
  };
}

export function providerLocationFormat(provider: StorageProvider): string {
  return provider === "sharepoint" ? "driveId:itemId" : "provider item ID";
}
