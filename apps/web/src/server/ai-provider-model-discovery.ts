import type { AiHostedProviderType } from "@market-me/domain";

export const AI_PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS = 10_000;
export const AI_PROVIDER_MODEL_RESPONSE_MAX_BYTES = 1_048_576;
export const AI_PROVIDER_MODEL_COUNT_MAX = 1_000;

export interface DiscoveredAiProviderModel {
  modelId: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  providerCreatedAt?: string;
}

export type AiProviderModelDiscoveryResult =
  | { status: "success"; models: DiscoveredAiProviderModel[] }
  | { status: "error"; lastError: string };

type DiscoveryFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const REQUESTS: Readonly<
  Record<AiHostedProviderType, (apiKey: string) => { url: string; headers: HeadersInit }>
> = {
  openai: (apiKey) => ({
    url: "https://api.openai.com/v1/models",
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
  }),
  anthropic: (apiKey) => ({
    url: "https://api.anthropic.com/v1/models?limit=1000",
    headers: { accept: "application/json", "anthropic-version": "2023-06-01", "x-api-key": apiKey },
  }),
  google_generative_ai: (apiKey) => ({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
    headers: { accept: "application/json", "x-goog-api-key": apiKey },
  }),
};

export async function discoverAiProviderModels(
  provider: AiHostedProviderType,
  apiKey: string,
  options: { fetchImpl?: DiscoveryFetch; timeoutMs?: number } = {},
): Promise<AiProviderModelDiscoveryResult> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? AI_PROVIDER_MODEL_DISCOVERY_TIMEOUT_MS,
  );
  const request = REQUESTS[provider](apiKey);
  try {
    const response = await (options.fetchImpl ?? fetch)(request.url, {
      method: "GET",
      headers: request.headers,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { status: "error", lastError: safeHttpError(response.status) };
    }
    const payload = await readBoundedJson(response);
    const models = parseProviderModels(provider, payload);
    if (models.length < 1)
      return { status: "error", lastError: "The provider returned no usable model records." };
    return { status: "success", models };
  } catch {
    return {
      status: "error",
      lastError: controller.signal.aborted
        ? "Provider model discovery timed out. Try again later."
        : "The provider model inventory could not be read safely.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function parseProviderModels(
  provider: AiHostedProviderType,
  payload: unknown,
): DiscoveredAiProviderModel[] {
  if (!payload || typeof payload !== "object") throw new Error("Invalid provider payload");
  const candidate = payload as Record<string, unknown>;
  if (provider === "anthropic" && candidate.has_more === true)
    throw new Error("Anthropic model inventory requires pagination");
  if (
    provider === "google_generative_ai" &&
    typeof candidate.nextPageToken === "string" &&
    candidate.nextPageToken.length > 0
  )
    throw new Error("Google model inventory requires pagination");
  const values = provider === "google_generative_ai" ? candidate.models : candidate.data;
  if (!Array.isArray(values) || values.length > AI_PROVIDER_MODEL_COUNT_MAX)
    throw new Error("Invalid provider model list");
  const models = values.map((value) => parseModel(provider, value));
  if (new Set(models.map((model) => model.modelId)).size !== models.length)
    throw new Error("Duplicate provider model identifier");
  return models.sort((left, right) => left.modelId.localeCompare(right.modelId));
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > AI_PROVIDER_MODEL_RESPONSE_MAX_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Provider response is too large");
  }
  if (!response.body) throw new Error("Provider response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > AI_PROVIDER_MODEL_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Provider response is too large");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function parseModel(
  provider: AiHostedProviderType,
  value: unknown,
): DiscoveredAiProviderModel {
  if (!value || typeof value !== "object") throw new Error("Invalid provider model");
  const model = value as Record<string, unknown>;
  const rawId = provider === "google_generative_ai"
    ? stringValue(model.name)?.replace(/^models\//, "") ?? stringValue(model.baseModelId)
    : stringValue(model.id);
  if (!rawId || rawId.length > 512 || rawId.trim() !== rawId)
    throw new Error("Invalid provider model identifier");
  const displayName = provider === "anthropic"
    ? optionalBoundedString(model.display_name, 200)
    : provider === "google_generative_ai"
      ? optionalBoundedString(model.displayName, 200)
      : undefined;
  const inputTokenLimit = provider === "anthropic"
    ? optionalSafeInteger(model.max_input_tokens)
    : provider === "google_generative_ai"
      ? optionalSafeInteger(model.inputTokenLimit)
      : undefined;
  const outputTokenLimit = provider === "anthropic"
    ? optionalSafeInteger(model.max_tokens)
    : provider === "google_generative_ai"
      ? optionalSafeInteger(model.outputTokenLimit)
      : undefined;
  const openAiCreated = optionalUnixSeconds(model.created);
  const providerCreatedAt = provider === "openai" && openAiCreated !== undefined
    ? new Date(openAiCreated * 1000).toISOString()
    : provider === "anthropic" && typeof model.created_at === "string" && !Number.isNaN(Date.parse(model.created_at))
      ? new Date(model.created_at).toISOString()
      : undefined;
  return {
    modelId: rawId,
    ...(displayName ? { displayName } : {}),
    ...(inputTokenLimit ? { inputTokenLimit } : {}),
    ...(outputTokenLimit ? { outputTokenLimit } : {}),
    ...(providerCreatedAt ? { providerCreatedAt } : {}),
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function optionalBoundedString(value: unknown, maximum: number) {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum && value.trim() === value
    ? value
    : undefined;
}

function optionalSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 100_000_000
    ? value
    : undefined;
}

function optionalUnixSeconds(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000_000_000
    ? value
    : undefined;
}

function safeHttpError(status: number) {
  if (status === 401 || status === 403) return "The provider rejected this credential.";
  if (status === 429) return "The provider rate-limited model discovery. Try again later.";
  if (status >= 500) return "The provider model service is unavailable. Try again later.";
  return "The provider could not return a model inventory.";
}
