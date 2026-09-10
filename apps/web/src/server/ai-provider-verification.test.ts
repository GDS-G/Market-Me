import { describe, expect, it, vi } from "vitest";
import { verifyAiProviderCredential } from "./ai-provider-verification";

describe("hosted AI provider credential verification", () => {
  it.each([
    ["openai", "https://api.openai.com/v1/models", "authorization", "Bearer qa-secret"],
    ["anthropic", "https://api.anthropic.com/v1/models?limit=1", "x-api-key", "qa-secret"],
    ["google_generative_ai", "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", "x-goog-api-key", "qa-secret"],
  ] as const)("uses the fixed %s metadata endpoint and header authentication", async (provider, url, header, value) => {
    const fetchImpl = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => new Response('{"discarded":true}', { status: 200 }));
    await expect(verifyAiProviderCredential(provider, "qa-secret", { fetchImpl })).resolves.toEqual({ status: "verified" });
    const [input, init] = fetchImpl.mock.calls[0]!;
    expect(input).toBe(url);
    expect(String(input)).not.toContain("qa-secret");
    expect(new Headers(init?.headers).get(header)).toBe(value);
    expect(init).toMatchObject({ method: "GET", redirect: "error", cache: "no-store" });
    expect(init?.body).toBeUndefined();
  });

  it("sends Anthropic's required stable API version", async () => {
    const fetchImpl = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => new Response(null, { status: 200 }));
    await verifyAiProviderCredential("anthropic", "qa-secret", { fetchImpl });
    expect(new Headers(fetchImpl.mock.calls[0]![1]?.headers).get("anthropic-version")).toBe("2023-06-01");
  });

  it.each([
    [401, "credential_rejected", "The provider rejected this credential."],
    [429, "rate_limited", "The provider rate-limited verification. Try again later."],
    [503, "provider_unavailable", "The provider verification service is unavailable. Try again later."],
    [400, "unexpected_response", "The provider could not verify this credential."],
  ] as const)("normalizes status %s without provider response data", async (status, failure, lastError) => {
    const fetchImpl = vi.fn(async () => new Response("provider-secret-body", { status }));
    await expect(verifyAiProviderCredential("openai", "qa-secret", { fetchImpl })).resolves.toEqual({ status: "error", failure, lastError });
  });

  it("normalizes network failures without echoing error text", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("qa-secret provider body"); });
    const result = await verifyAiProviderCredential("openai", "qa-secret", { fetchImpl });
    expect(result).toEqual({ status: "error", failure: "provider_unavailable", lastError: "The provider verification service could not be reached." });
    expect(JSON.stringify(result)).not.toContain("qa-secret");
  });

  it("bounds a stalled provider request", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(
      verifyAiProviderCredential("openai", "qa-secret", {
        fetchImpl,
        timeoutMs: 1,
      }),
    ).resolves.toEqual({
      status: "error",
      failure: "provider_unavailable",
      lastError: "Provider verification timed out. Try again later.",
    });
  });
});
