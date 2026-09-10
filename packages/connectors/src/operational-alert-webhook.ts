import { createHmac, timingSafeEqual } from "node:crypto";

export const OPERATIONAL_ALERT_WEBHOOK_LIMITS = Object.freeze({
  maximumPayloadBytes: 32_768,
  defaultTimeoutMs: 10_000,
});

export interface OperationalAlertWebhookRequest {
  endpointUrl: string;
  signingSecret: string;
  eventId: string;
  occurredAt: string;
  payload: Readonly<Record<string, unknown>>;
}

export type OperationalAlertWebhookResult =
  | { status: "delivered"; responseStatus: number }
  | {
      status: "failed";
      retryable: boolean;
      responseStatus?: number;
      safeError: string;
    };

export class OperationalAlertWebhookConfigurationError extends Error {
  constructor(public readonly field: "endpointUrl" | "allowedHosts", message: string) {
    super(message);
    this.name = "OperationalAlertWebhookConfigurationError";
  }
}

export function parseOperationalAlertAllowedHosts(value: string | undefined): readonly string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean))];
}

export function validateOperationalAlertEndpoint(
  endpointUrl: string,
  allowedHosts: readonly string[],
): URL {
  if (!allowedHosts.length)
    throw new OperationalAlertWebhookConfigurationError(
      "allowedHosts", "Operational alert endpoint hosts are not configured for this deployment.",
    );
  let endpoint: URL;
  try {
    endpoint = new URL(endpointUrl);
  } catch {
    throw new OperationalAlertWebhookConfigurationError("endpointUrl", "Enter a valid HTTPS webhook URL.");
  }
  const allowed = new Set(allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean));
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password ||
      endpoint.port || endpoint.search || endpoint.hash || !allowed.has(endpoint.hostname.toLowerCase()))
    throw new OperationalAlertWebhookConfigurationError(
      "endpointUrl",
      "Use an HTTPS URL on an allowlisted host without credentials, a custom port, query, or fragment.",
    );
  return endpoint;
}

export function operationalAlertEndpointOrigin(endpointUrl: string): string {
  return new URL(endpointUrl).origin;
}

export function signOperationalAlertWebhook(
  rawBody: string,
  timestamp: string,
  signingSecret: string,
): string {
  return createHmac("sha256", signingSecret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export function verifyOperationalAlertWebhookSignature(
  rawBody: string,
  timestamp: string,
  signature: string,
  signingSecret: string,
): boolean {
  const expected = `v1=${signOperationalAlertWebhook(rawBody, timestamp, signingSecret)}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function deliverOperationalAlertWebhook(
  input: OperationalAlertWebhookRequest,
  options: {
    allowedHosts: readonly string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<OperationalAlertWebhookResult> {
  const endpoint = validateOperationalAlertEndpoint(input.endpointUrl, options.allowedHosts);
  const rawBody = JSON.stringify(input.payload);
  if (Buffer.byteLength(rawBody) > OPERATIONAL_ALERT_WEBHOOK_LIMITS.maximumPayloadBytes)
    return { status: "failed", retryable: false, safeError: "Alert payload exceeded the delivery limit." };
  const timestamp = input.occurredAt;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(), options.timeoutMs ?? OPERATIONAL_ALERT_WEBHOOK_LIMITS.defaultTimeoutMs,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "idempotency-key": input.eventId,
        "x-market-me-event-id": input.eventId,
        "x-market-me-timestamp": timestamp,
        "x-market-me-signature": `v1=${signOperationalAlertWebhook(rawBody, timestamp, input.signingSecret)}`,
      },
      body: rawBody,
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.status >= 200 && response.status <= 299)
      return { status: "delivered", responseStatus: response.status };
    if (response.status >= 300 && response.status <= 399)
      return { status: "failed", retryable: false, responseStatus: response.status,
        safeError: "Webhook redirects are not permitted." };
    const retryable = response.status === 408 || response.status === 425 ||
      response.status === 429 || response.status >= 500;
    return {
      status: "failed", retryable, responseStatus: response.status,
      safeError: retryable
        ? "Webhook receiver was temporarily unavailable."
        : "Webhook receiver rejected the alert.",
    };
  } catch (error) {
    return {
      status: "failed",
      retryable: true,
      safeError: error instanceof Error && error.name === "AbortError"
        ? "Webhook delivery timed out."
        : "Webhook delivery could not be confirmed.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
