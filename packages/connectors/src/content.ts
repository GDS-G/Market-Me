import type { ConnectorFetch, DownloadedContent } from "./types";

function googleExportMimeType(mimeType: string): string | undefined {
  if (mimeType === "application/vnd.google-apps.document" || mimeType === "application/vnd.google-apps.presentation") return "text/plain";
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "text/csv";
  return undefined;
}

async function boundedResponse(response: Response, fallbackMimeType: string, maxBytes: number): Promise<DownloadedContent> {
  if (!response.ok) throw new Error(`Content download failed with HTTP ${response.status}`);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error("Provider content exceeds the configured byte limit");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new Error("Provider content exceeds the configured byte limit");
  return {
    bytes,
    mimeType: response.headers.get("content-type")?.split(";")[0] || fallbackMimeType,
  };
}

export async function downloadGoogleContent(
  request: ConnectorFetch,
  input: { accessToken: string; providerItemId: string; mimeType: string; maxBytes: number },
): Promise<DownloadedContent> {
  const exportMimeType = googleExportMimeType(input.mimeType);
  const path = exportMimeType
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.providerItemId)}/export?mimeType=${encodeURIComponent(exportMimeType)}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.providerItemId)}?alt=media&supportsAllDrives=true`;
  const response = await request(path, {
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      ...(exportMimeType ? {} : { range: `bytes=0-${input.maxBytes - 1}` }),
    },
  });
  return boundedResponse(response, exportMimeType ?? input.mimeType, input.maxBytes);
}

function microsoftContentUrl(
  provider: "onedrive" | "sharepoint",
  providerItemId: string,
  providerLocationId?: string,
): string {
  if (provider === "onedrive") {
    return `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(providerItemId)}/content`;
  }
  const separator = providerLocationId?.indexOf(":") ?? -1;
  if (!providerLocationId || separator <= 0) throw new Error("SharePoint content download requires driveId:itemId location context");
  const driveId = providerLocationId.slice(0, separator);
  return `https://graph.microsoft.com/v1.0/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(providerItemId)}/content`;
}

export async function downloadMicrosoftContent(
  request: ConnectorFetch,
  provider: "onedrive" | "sharepoint",
  input: { accessToken: string; providerItemId: string; providerLocationId?: string; mimeType: string; maxBytes: number },
): Promise<DownloadedContent> {
  const response = await request(microsoftContentUrl(provider, input.providerItemId, input.providerLocationId), {
    redirect: "manual",
    headers: { authorization: `Bearer ${input.accessToken}` },
  });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (!location) throw new Error("Microsoft content redirect omitted Location");
    const downloadUrl = new URL(location);
    if (downloadUrl.protocol !== "https:") throw new Error("Microsoft content redirect must use HTTPS");
    const download = await request(downloadUrl, { headers: { range: `bytes=0-${input.maxBytes - 1}` } });
    return boundedResponse(download, input.mimeType, input.maxBytes);
  }
  return boundedResponse(response, input.mimeType, input.maxBytes);
}
