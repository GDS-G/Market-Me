import type { AiHostedProviderType } from "@market-me/domain";
import {
  AI_TEXT_CODEC_LIMITS,
  AiTextCodecError,
  buildAiProviderTextRequest,
  parseAiProviderTextResponse,
  type AiProviderTextResponse,
  type AiTextCodecRequest,
} from "./ai-provider-codecs";

export const AI_PROVIDER_TEXT_TRANSPORT_TIMEOUT_MS = 30_000;
export const AI_PROVIDER_TEXT_TRANSPORT_MAX_TIMEOUT_MS = 60_000;

export const AI_PROVIDER_TEXT_TRANSPORT_CONSTRAINTS = Object.freeze([
  "fixed-https-endpoint",
  "header-only-credential",
  "post-json",
  "redirect-error",
  "no-store",
  "bounded-timeout",
  "bounded-response",
  "no-retry",
] as const);

export const AI_PROVIDER_TEXT_TRANSPORT_CONTRACTS = Object.freeze([
  {
    provider: "openai",
    contractKey: "openai-hosted-json",
    contractVersion: "contract-v3",
    codecVersion: "text-codec-v1",
    transportVersion: "fixed-https-text-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    endpointPolicy: "openai-responses-v1",
    sourceReference: "market-me://invocation-contracts/openai-hosted-json/contract-v3",
    sourceHash: "49452d6ab67a23e1b960ae00900e1af15384033bd7863a3c0c683e8b2a393704",
  },
  {
    provider: "anthropic",
    contractKey: "anthropic-hosted-json",
    contractVersion: "contract-v3",
    codecVersion: "text-codec-v1",
    transportVersion: "fixed-https-text-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    endpointPolicy: "anthropic-messages-v1",
    sourceReference: "market-me://invocation-contracts/anthropic-hosted-json/contract-v3",
    sourceHash: "2a2ed66a5672c05db7c95efae74f9dc2ac8a97f463babfbd74f6994e62cc894d",
  },
  {
    provider: "google_generative_ai",
    contractKey: "google-generative-ai-hosted-json",
    contractVersion: "contract-v3",
    codecVersion: "text-codec-v1",
    transportVersion: "fixed-https-text-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    endpointPolicy: "google-generate-content-v1",
    sourceReference: "market-me://invocation-contracts/google-generative-ai-hosted-json/contract-v3",
    sourceHash: "45cfdcd21a0954401de98ad6e57435fb17f0f878698a0958e1d5f4148728b83a",
  },
] as const);

export const AI_PROVIDER_TEXT_IMPLEMENTATION_CONSTRAINTS = Object.freeze([
  "codec-required",
  "transport-required",
  "internal-only",
  "no-public-route",
  "routing-disabled",
] as const);

export const AI_PROVIDER_TEXT_IMPLEMENTATION_CONTRACTS = Object.freeze([
  {
    provider: "openai",
    contractKey: "openai-hosted-json",
    contractVersion: "contract-v4",
    codecVersion: "text-codec-v1",
    transportVersion: "fixed-https-text-v1",
    implementationVersion: "hosted-text-implementation-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    endpointPolicy: "openai-responses-v1",
    sourceReference: "market-me://invocation-contracts/openai-hosted-json/contract-v4",
    sourceHash: "05ac8697e4860be929dfb5087c72aee45f0386a0019920bfdf9f72f007630d33",
  },
  {
    provider: "anthropic",
    contractKey: "anthropic-hosted-json",
    contractVersion: "contract-v4",
    codecVersion: "text-codec-v1",
    transportVersion: "fixed-https-text-v1",
    implementationVersion: "hosted-text-implementation-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    endpointPolicy: "anthropic-messages-v1",
    sourceReference: "market-me://invocation-contracts/anthropic-hosted-json/contract-v4",
    sourceHash: "02b9d5ea3fd2eaec96cf6f2abc0341fbc240fbdc80e3572a103e8c92f7d10605",
  },
  {
    provider: "google_generative_ai",
    contractKey: "google-generative-ai-hosted-json",
    contractVersion: "contract-v4",
    codecVersion: "text-codec-v1",
    transportVersion: "fixed-https-text-v1",
    implementationVersion: "hosted-text-implementation-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    endpointPolicy: "google-generate-content-v1",
    sourceReference: "market-me://invocation-contracts/google-generative-ai-hosted-json/contract-v4",
    sourceHash: "ef12cef6941877fd79638c63103aff8c5083d446091cf5f3da8bcecf9da2435a",
  },
] as const);

export type AiProviderTextTransportFailure =
  | "credential_rejected"
  | "rate_limited"
  | "provider_unavailable"
  | "unexpected_response";

export type AiProviderTextTransportResult =
  | { status: "success"; response: AiProviderTextResponse }
  | {
      status: "error";
      failure: AiProviderTextTransportFailure;
      safeMessage: string;
    };

type TransportFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

interface TransportOptions {
  fetchImpl?: TransportFetch;
  timeoutMs?: number;
}

function endpoint(provider: AiHostedProviderType, modelId: string): string {
  if (provider === "openai") return "https://api.openai.com/v1/responses";
  if (provider === "anthropic") return "https://api.anthropic.com/v1/messages";
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
}

function headers(provider: AiHostedProviderType, apiKey: string): HeadersInit {
  const common = { accept: "application/json", "content-type": "application/json" };
  if (provider === "openai") return { ...common, authorization: `Bearer ${apiKey}` };
  if (provider === "anthropic")
    return { ...common, "anthropic-version": "2023-06-01", "x-api-key": apiKey };
  return { ...common, "x-goog-api-key": apiKey };
}

function safeHttpFailure(status: number): Exclude<AiProviderTextTransportResult, { status: "success" }> {
  if (status === 401 || status === 403)
    return { status: "error", failure: "credential_rejected", safeMessage: "The provider rejected this credential." };
  if (status === 429)
    return { status: "error", failure: "rate_limited", safeMessage: "The provider rate-limited this request. Try again later." };
  if (status >= 500)
    return { status: "error", failure: "provider_unavailable", safeMessage: "The provider generation service is unavailable. Try again later." };
  return { status: "error", failure: "unexpected_response", safeMessage: "The provider rejected the bounded generation request." };
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > AI_TEXT_CODEC_LIMITS.responseBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiTextCodecError("response_too_large", "Provider response exceeded the transport byte limit.");
  }
  const contentType = response.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("application/json")) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiTextCodecError("invalid_response", "Provider response was not JSON content.");
  }
  if (!response.body)
    throw new AiTextCodecError("invalid_response", "Provider response had no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > AI_TEXT_CODEC_LIMITS.responseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new AiTextCodecError("response_too_large", "Provider response exceeded the transport byte limit.");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export async function invokeAiProviderText(
  input: AiTextCodecRequest,
  apiKey: string,
  options: TransportOptions = {},
): Promise<AiProviderTextTransportResult> {
  if (typeof apiKey !== "string" || apiKey.length < 1 || apiKey.length > 4_096 || apiKey.trim() !== apiKey)
    throw new AiTextCodecError("invalid_request", "The provider credential is invalid.");
  const timeoutMs = options.timeoutMs ?? AI_PROVIDER_TEXT_TRANSPORT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > AI_PROVIDER_TEXT_TRANSPORT_MAX_TIMEOUT_MS)
    throw new AiTextCodecError("invalid_request", "The provider timeout is outside the transport bounds.");
  const request = buildAiProviderTextRequest(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint(input.provider, request.modelId), {
      method: "POST",
      headers: headers(input.provider, apiKey),
      body: JSON.stringify(request.body),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return safeHttpFailure(response.status);
    }
    const rawJson = await readBoundedText(response);
    return { status: "success", response: parseAiProviderTextResponse(input.provider, rawJson) };
  } catch (error) {
    if (error instanceof AiTextCodecError)
      return { status: "error", failure: "unexpected_response", safeMessage: "The provider returned an unsafe or unsupported response." };
    return {
      status: "error",
      failure: "provider_unavailable",
      safeMessage: controller.signal.aborted
        ? "The provider generation request timed out. Try again later."
        : "The provider generation service could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
