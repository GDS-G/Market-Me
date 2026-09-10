import type { AiHostedProviderType } from "@market-me/domain";

export const AI_PROVIDER_VERIFICATION_TIMEOUT_MS = 5_000;

export type AiProviderVerificationFailure =
  | "credential_rejected"
  | "rate_limited"
  | "provider_unavailable"
  | "unexpected_response";

export type AiProviderVerificationResult =
  | { status: "verified" }
  | {
      status: "error";
      failure: AiProviderVerificationFailure;
      lastError: string;
    };

type VerificationFetch = (
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
    url: "https://api.anthropic.com/v1/models?limit=1",
    headers: {
      accept: "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    },
  }),
  google_generative_ai: (apiKey) => ({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
    headers: { accept: "application/json", "x-goog-api-key": apiKey },
  }),
};

export async function verifyAiProviderCredential(
  provider: AiHostedProviderType,
  apiKey: string,
  options: { fetchImpl?: VerificationFetch; timeoutMs?: number } = {},
): Promise<AiProviderVerificationResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? AI_PROVIDER_VERIFICATION_TIMEOUT_MS,
  );
  const request = REQUESTS[provider](apiKey);
  try {
    const response = await fetchImpl(request.url, {
      method: "GET",
      headers: request.headers,
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    await response.body?.cancel().catch(() => undefined);
    if (response.ok) return { status: "verified" };
    if (response.status === 401 || response.status === 403)
      return {
        status: "error",
        failure: "credential_rejected",
        lastError: "The provider rejected this credential.",
      };
    if (response.status === 429)
      return {
        status: "error",
        failure: "rate_limited",
        lastError: "The provider rate-limited verification. Try again later.",
      };
    if (response.status >= 500)
      return {
        status: "error",
        failure: "provider_unavailable",
        lastError: "The provider verification service is unavailable. Try again later.",
      };
    return {
      status: "error",
      failure: "unexpected_response",
      lastError: "The provider could not verify this credential.",
    };
  } catch {
    return {
      status: "error",
      failure: "provider_unavailable",
      lastError: controller.signal.aborted
        ? "Provider verification timed out. Try again later."
        : "The provider verification service could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
