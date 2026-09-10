import { getWebhookService } from "@/server/ingestion";

const MAX_BODY_BYTES = 256 * 1024;

interface GraphNotification {
  subscriptionId?: unknown;
  clientState?: unknown;
  id?: unknown;
  changeType?: unknown;
  lifecycleEvent?: unknown;
  resource?: unknown;
  tenantId?: unknown;
}

function optionalString(value: unknown, maxLength = 2048): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : undefined;
}

export async function POST(request: Request) {
  const validationToken = new URL(request.url).searchParams.get("validationToken");
  if (validationToken !== null) {
    if (validationToken.length > 4096) return new Response(null, { status: 400 });
    return new Response(validationToken, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const bodyText = await request.text();
    if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    const payload = JSON.parse(bodyText) as { value?: unknown };
    const notifications = Array.isArray(payload.value) ? payload.value as GraphNotification[] : [];
    const service = getWebhookService();
    await Promise.all(notifications.slice(0, 100).map(async (notification) => {
      const subscriptionId = optionalString(notification.subscriptionId, 256);
      const clientState = optionalString(notification.clientState, 512);
      if (!subscriptionId || !clientState) return false;
      return service.acceptMicrosoftNotification({
        subscriptionId,
        clientState,
        id: optionalString(notification.id, 512),
        changeType: optionalString(notification.changeType, 128),
        lifecycleEvent: optionalString(notification.lifecycleEvent, 128),
        resource: optionalString(notification.resource),
        tenantId: optionalString(notification.tenantId, 256),
      });
    }));
    return new Response(null, { status: 202 });
  } catch (error) {
    console.error("Microsoft Graph webhook enqueue failed", error);
    return new Response(null, { status: 503 });
  }
}
