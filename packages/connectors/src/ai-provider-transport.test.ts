import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { AiTextCodecError } from "./ai-provider-codecs";
import {
  AI_PROVIDER_TEXT_TRANSPORT_CONSTRAINTS,
  AI_PROVIDER_TEXT_TRANSPORT_CONTRACTS,
  AI_PROVIDER_TEXT_IMPLEMENTATION_CONSTRAINTS,
  AI_PROVIDER_TEXT_IMPLEMENTATION_CONTRACTS,
  invokeAiProviderText,
} from "./ai-provider-transport";

const jsonResponse = (value: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

describe("fixed provider text transport", () => {
  it("keeps combined transport contracts source-hashed", () => {
    for (const contract of AI_PROVIDER_TEXT_TRANSPORT_CONTRACTS) {
      const canonical = JSON.stringify({
        provider: contract.provider,
        contractKey: contract.contractKey,
        contractVersion: contract.contractVersion,
        codecVersion: contract.codecVersion,
        transportVersion: contract.transportVersion,
        requestSchemaVersion: contract.requestSchemaVersion,
        responseSchemaVersion: contract.responseSchemaVersion,
        endpointPolicy: contract.endpointPolicy,
        constraints: AI_PROVIDER_TEXT_TRANSPORT_CONSTRAINTS,
      });
      expect(createHash("sha256").update(canonical).digest("hex")).toBe(contract.sourceHash);
    }
  });

  it("keeps internal implementation contracts source-hashed", () => {
    for (const contract of AI_PROVIDER_TEXT_IMPLEMENTATION_CONTRACTS) {
      const canonical = JSON.stringify({
        provider: contract.provider,
        contractKey: contract.contractKey,
        contractVersion: contract.contractVersion,
        codecVersion: contract.codecVersion,
        transportVersion: contract.transportVersion,
        implementationVersion: contract.implementationVersion,
        requestSchemaVersion: contract.requestSchemaVersion,
        responseSchemaVersion: contract.responseSchemaVersion,
        endpointPolicy: contract.endpointPolicy,
        constraints: AI_PROVIDER_TEXT_IMPLEMENTATION_CONSTRAINTS,
      });
      expect(createHash("sha256").update(canonical).digest("hex")).toBe(contract.sourceHash);
    }
  });

  it.each([
    ["openai", "gpt-5", "https://api.openai.com/v1/responses", "authorization", "Bearer secret", {
      id: "resp_1", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "OpenAI" }] }],
    }],
    ["anthropic", "claude-sonnet-4-5", "https://api.anthropic.com/v1/messages", "x-api-key", "secret", {
      id: "msg_1", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Anthropic" }],
    }],
    ["google_generative_ai", "gemini-2.5-flash", "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", "x-goog-api-key", "secret", {
      responseId: "google_1", candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "Google" }] } }],
    }],
  ] as const)("posts one bounded %s request to the fixed endpoint", async (provider, modelId, url, header, headerValue, payload) => {
    const fetchImpl = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => jsonResponse(payload));
    const response = await invokeAiProviderText({
      provider, modelId, userText: "Draft.", maxOutputTokens: 100,
    }, "secret", { fetchImpl });
    expect(response).toMatchObject({ status: "success", response: { provider, execution: false } });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [actualUrl, init] = fetchImpl.mock.calls[0];
    expect(actualUrl).toBe(url);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect((init?.headers as Record<string, string>)[header]).toBe(headerValue);
    expect((init?.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(String(init?.body)).not.toContain("secret");
    expect(String(actualUrl)).not.toContain("secret");
  });

  it.each([
    [401, "credential_rejected"],
    [403, "credential_rejected"],
    [429, "rate_limited"],
    [500, "provider_unavailable"],
    [400, "unexpected_response"],
  ] as const)("normalizes HTTP %i without reading its body", async (status, failure) => {
    const response = await invokeAiProviderText({
      provider: "openai", modelId: "gpt-5", userText: "Draft.", maxOutputTokens: 100,
    }, "secret", { fetchImpl: vi.fn(async () => jsonResponse({ sensitive: true }, status)) });
    expect(response).toMatchObject({ status: "error", failure });
    expect(JSON.stringify(response)).not.toContain("sensitive");
  });

  it("rejects unsafe success bodies and non-JSON content safely", async () => {
    const request = { provider: "openai" as const, modelId: "gpt-5", userText: "Draft.", maxOutputTokens: 100 };
    expect(await invokeAiProviderText(request, "secret", {
      fetchImpl: vi.fn(async () => jsonResponse({ status: "completed", output: [{ type: "function_call" }] })),
    })).toMatchObject({ status: "error", failure: "unexpected_response" });
    expect(await invokeAiProviderText(request, "secret", {
      fetchImpl: vi.fn(async () => new Response("not-json", { headers: { "content-type": "text/plain" } })),
    })).toMatchObject({ status: "error", failure: "unexpected_response" });
  });

  it("enforces declared and streamed response bounds", async () => {
    const request = { provider: "openai" as const, modelId: "gpt-5", userText: "Draft.", maxOutputTokens: 100 };
    expect(await invokeAiProviderText(request, "secret", {
      fetchImpl: vi.fn(async () => jsonResponse({}, 200, { "content-length": "1048577" })),
    })).toMatchObject({ status: "error", failure: "unexpected_response" });
    expect(await invokeAiProviderText(request, "secret", {
      fetchImpl: vi.fn(async () => new Response("x".repeat(1_048_577), { headers: { "content-type": "application/json" } })),
    })).toMatchObject({ status: "error", failure: "unexpected_response" });
  });

  it("normalizes timeout/network failure and bounds credential/timeout input", async () => {
    const request = { provider: "openai" as const, modelId: "gpt-5", userText: "Draft.", maxOutputTokens: 100 };
    expect(await invokeAiProviderText(request, "secret", {
      timeoutMs: 5,
      fetchImpl: vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
      )),
    })).toMatchObject({ status: "error", failure: "provider_unavailable", safeMessage: expect.stringMatching(/timed out/) });
    await expect(invokeAiProviderText(request, " secret", {})).rejects.toBeInstanceOf(AiTextCodecError);
    await expect(invokeAiProviderText(request, "secret", { timeoutMs: 60_001 })).rejects.toBeInstanceOf(AiTextCodecError);
  });
});
