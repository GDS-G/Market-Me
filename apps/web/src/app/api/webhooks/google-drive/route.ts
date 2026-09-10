import { getWebhookService } from "@/server/ingestion";

function header(request: Request, name: string, maxLength = 2048): string {
  const value = request.headers.get(name)?.trim() ?? "";
  return value.length <= maxLength ? value : "";
}

export async function POST(request: Request) {
  try {
    const accepted = await getWebhookService().acceptGoogleNotification({
      providerSubscriptionId: header(request, "x-goog-channel-id", 128),
      clientState: header(request, "x-goog-channel-token", 512),
      messageNumber: header(request, "x-goog-message-number", 64),
      resourceState: header(request, "x-goog-resource-state", 64),
      resourceId: header(request, "x-goog-resource-id", 512) || undefined,
      resourceUri: header(request, "x-goog-resource-uri") || undefined,
      changed: header(request, "x-goog-changed", 512) || undefined,
    });
    return new Response(null, { status: accepted ? 202 : 204 });
  } catch (error) {
    console.error("Google Drive webhook enqueue failed", error);
    return new Response(null, { status: 503 });
  }
}
