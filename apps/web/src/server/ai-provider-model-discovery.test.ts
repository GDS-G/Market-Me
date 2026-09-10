import { describe, expect, it, vi } from "vitest";
import { discoverAiProviderModels, parseProviderModels } from "./ai-provider-model-discovery";

describe("hosted provider model discovery", () => {
  it("normalizes OpenAI model identity without owner metadata", () => {
    expect(parseProviderModels("openai", { data: [{ id: "gpt-example", created: 1_700_000_000, owned_by: "private-owner" }] })).toEqual([
      { modelId: "gpt-example", providerCreatedAt: "2023-11-14T22:13:20.000Z" },
    ]);
  });

  it("normalizes bounded Anthropic model metadata", () => {
    expect(parseProviderModels("anthropic", { data: [{ id: "claude-example", display_name: "Claude Example", created_at: "2026-01-01T00:00:00Z", max_input_tokens: 200000, max_tokens: 8192 }] })).toEqual([
      { modelId: "claude-example", displayName: "Claude Example", inputTokenLimit: 200000, outputTokenLimit: 8192, providerCreatedAt: "2026-01-01T00:00:00.000Z" },
    ]);
  });

  it("prefers Google's base model ID and retains bounded limits", () => {
    expect(parseProviderModels("google_generative_ai", { models: [{ name: "models/gemini-example-001", baseModelId: "gemini-example", displayName: "Gemini Example", inputTokenLimit: 1000000, outputTokenLimit: 8192 }] })).toEqual([
      { modelId: "gemini-example-001", displayName: "Gemini Example", inputTokenLimit: 1000000, outputTokenLimit: 8192 },
    ]);
  });

  it("uses header-only authentication and a bounded successful response", async () => {
    const fetchImpl = vi.fn<
      (input: string | URL | Request, init?: RequestInit) => Promise<Response>
    >(async () => Response.json({ data: [{ id: "gpt-example" }] }));
    const result = await discoverAiProviderModels("openai", "qa-secret", { fetchImpl });
    expect(result).toEqual({ status: "success", models: [{ modelId: "gpt-example" }] });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).not.toContain("qa-secret");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer qa-secret");
    expect(init?.body).toBeUndefined();
  });

  it("rejects an oversized declared response without exposing its body", async () => {
    const fetchImpl = vi.fn(async () => new Response("secret-provider-body", { status: 200, headers: { "content-length": "1048577" } }));
    await expect(discoverAiProviderModels("openai", "qa-secret", { fetchImpl })).resolves.toEqual({
      status: "error",
      lastError: "The provider model inventory could not be read safely.",
    });
  });

  it("rejects duplicate identifiers and unbounded lists", () => {
    expect(() => parseProviderModels("openai", { data: [{ id: "same" }, { id: "same" }] })).toThrow();
    expect(() => parseProviderModels("openai", { data: Array.from({ length: 1001 }, (_, index) => ({ id: `m-${index}` })) })).toThrow();
  });

  it("fails closed instead of storing a partial paginated inventory", () => {
    expect(() => parseProviderModels("anthropic", { data: [{ id: "claude-example" }], has_more: true })).toThrow();
    expect(() => parseProviderModels("google_generative_ai", { models: [{ name: "models/gemini-example" }], nextPageToken: "more" })).toThrow();
  });
});
