import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_TEXT_CODEC_CONSTRAINTS,
  AI_PROVIDER_TEXT_CODEC_CONTRACTS,
  AI_TEXT_CODEC_LIMITS,
  AiTextCodecError,
  buildAiProviderTextRequest,
  parseAiProviderTextResponse,
} from "./ai-provider-codecs";

describe("reviewed provider text request codecs", () => {
  it("keeps source hashes tied to canonical provider contract descriptors", () => {
    for (const contract of AI_PROVIDER_TEXT_CODEC_CONTRACTS) {
      const canonical = JSON.stringify({
        provider: contract.provider,
        contractKey: contract.contractKey,
        contractVersion: contract.contractVersion,
        codecVersion: contract.codecVersion,
        requestSchemaVersion: contract.requestSchemaVersion,
        responseSchemaVersion: contract.responseSchemaVersion,
        requestShape: contract.requestShape,
        responseShape: contract.responseShape,
        constraints: AI_PROVIDER_TEXT_CODEC_CONSTRAINTS,
      });
      expect(createHash("sha256").update(canonical).digest("hex")).toBe(contract.sourceHash);
    }
  });

  it("builds fixed non-streaming OpenAI Responses input", () => {
    const request = buildAiProviderTextRequest({
      provider: "openai", modelId: "gpt-5", systemText: "Follow brand policy.",
      userText: "Draft a caption.", maxOutputTokens: 500,
    });
    expect(request).toMatchObject({ provider: "openai", streaming: false, tools: false, execution: false });
    expect(request.body).toEqual({
      model: "gpt-5", instructions: "Follow brand policy.", input: "Draft a caption.",
      max_output_tokens: 500, store: false, stream: false,
    });
  });

  it("builds text-block-only Anthropic Messages input", () => {
    expect(buildAiProviderTextRequest({
      provider: "anthropic", modelId: "claude-sonnet-4-5", userText: "Draft.",
      systemText: "Be concise.", maxOutputTokens: 800,
    }).body).toEqual({
      model: "claude-sonnet-4-5", max_tokens: 800,
      system: [{ type: "text", text: "Be concise." }],
      messages: [{ role: "user", content: [{ type: "text", text: "Draft." }] }],
      stream: false,
    });
  });

  it("builds text-only Google generateContent input without transport data", () => {
    expect(buildAiProviderTextRequest({
      provider: "google_generative_ai", modelId: "gemini-2.5-flash", userText: "Draft.",
      maxOutputTokens: 700,
    })).toEqual({
      provider: "google_generative_ai", modelId: "gemini-2.5-flash",
      body: {
        contents: [{ role: "user", parts: [{ text: "Draft." }] }],
        generationConfig: { maxOutputTokens: 700 },
      },
      streaming: false, tools: false, execution: false,
    });
  });

  it.each([
    { provider: "openai" as const, modelId: " bad", userText: "x", maxOutputTokens: 1 },
    { provider: "openai" as const, modelId: "gpt-5", userText: "", maxOutputTokens: 1 },
    { provider: "anthropic" as const, modelId: "claude", userText: "x", maxOutputTokens: 0 },
    { provider: "google_generative_ai" as const, modelId: "gemini", userText: "x", maxOutputTokens: AI_TEXT_CODEC_LIMITS.maxOutputTokens + 1 },
  ])("rejects an out-of-contract request", (input) => {
    expect(() => buildAiProviderTextRequest(input)).toThrow(AiTextCodecError);
  });
});

describe("bounded provider text response codecs", () => {
  it("aggregates OpenAI output text while ignoring reasoning items", () => {
    const response = parseAiProviderTextResponse("openai", JSON.stringify({
      id: "resp_1", status: "completed",
      output: [
        { type: "reasoning", summary: [] },
        { type: "message", role: "assistant", content: [
          { type: "output_text", text: "Draft " },
          { type: "output_text", text: "ready." },
        ] },
      ],
      usage: { input_tokens: 12, output_tokens: 4, total_tokens: 16 },
    }));
    expect(response).toMatchObject({
      provider: "openai", providerResponseId: "resp_1", text: "Draft ready.",
      stopReason: "completed", usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      toolsUsed: false, rawResponseStored: false, execution: false,
    });
  });

  it("normalizes OpenAI refusals and bounded incomplete output", () => {
    expect(parseAiProviderTextResponse("openai", JSON.stringify({
      status: "completed", output: [{ type: "message", role: "assistant", content: [
        { type: "refusal", refusal: "I cannot help with that." },
      ] }],
    }))).toMatchObject({ stopReason: "refusal", text: "I cannot help with that." });
    expect(parseAiProviderTextResponse("openai", JSON.stringify({
      status: "incomplete", incomplete_details: { reason: "max_output_tokens" },
      output: [{ type: "message", role: "assistant", content: [
        { type: "output_text", text: "Partial" },
      ] }],
    }))).toMatchObject({ stopReason: "max_output", text: "Partial" });
  });

  it("normalizes Anthropic text blocks and usage", () => {
    const response = parseAiProviderTextResponse("anthropic", JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", stop_reason: "end_turn",
      content: [{ type: "text", text: "Draft" }, { type: "text", text: " ready." }],
      usage: { input_tokens: 8, output_tokens: 3 },
    }));
    expect(response).toMatchObject({
      provider: "anthropic", text: "Draft ready.", stopReason: "completed",
      usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
    });
  });

  it("normalizes one Google candidate and a prompt block", () => {
    expect(parseAiProviderTextResponse("google_generative_ai", JSON.stringify({
      responseId: "response-1",
      candidates: [{ finishReason: "STOP", content: { role: "model", parts: [
        { text: "Draft" }, { text: " ready." },
      ] } }],
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3, totalTokenCount: 12 },
    }))).toMatchObject({
      providerResponseId: "response-1", text: "Draft ready.", stopReason: "completed",
      usage: { inputTokens: 9, outputTokens: 3, totalTokens: 12 },
    });
    expect(parseAiProviderTextResponse("google_generative_ai", JSON.stringify({
      candidates: [], promptFeedback: { blockReason: "SAFETY" },
    }))).toMatchObject({ text: "", stopReason: "blocked" });
  });

  it.each([
    ["openai", { status: "completed", output: [{ type: "function_call" }] }],
    ["openai", { status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }, { type: "refusal", refusal: "no" }] }] }],
    ["anthropic", { type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "tool_1" }] }],
    ["google_generative_ai", { candidates: [{ finishReason: "STOP", content: { parts: [{ functionCall: { name: "x" } }] } }] }],
    ["google_generative_ai", { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "a" }] } }, { finishReason: "STOP", content: { parts: [{ text: "b" }] } }] }],
  ] as const)("rejects unexpected %s response structures", (provider, payload) => {
    expect(() => parseAiProviderTextResponse(provider, JSON.stringify(payload))).toThrow(AiTextCodecError);
  });

  it("rejects malformed and oversized response text before parsing", () => {
    expect(() => parseAiProviderTextResponse("openai", "not-json")).toThrowError(/valid JSON/);
    expect(() => parseAiProviderTextResponse(
      "openai", " ".repeat(AI_TEXT_CODEC_LIMITS.responseBytes + 1),
    )).toThrowError(/byte limit/);
  });
});
