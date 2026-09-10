import type { AiHostedProviderType } from "@market-me/domain";

export const AI_PROVIDER_TEXT_CODEC_CONTRACTS = Object.freeze([
  {
    provider: "openai",
    contractKey: "openai-hosted-json",
    contractVersion: "contract-v2",
    codecVersion: "text-codec-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    sourceReference: "market-me://invocation-contracts/openai-hosted-json/contract-v2",
    sourceHash: "fdf80ddbd48af723e312f8672cda0a5ec431cbb616a0c6948a36c649b02c8e9a",
    requestShape: "responses-single-turn-text",
    responseShape: "responses-output-text",
  },
  {
    provider: "anthropic",
    contractKey: "anthropic-hosted-json",
    contractVersion: "contract-v2",
    codecVersion: "text-codec-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    sourceReference: "market-me://invocation-contracts/anthropic-hosted-json/contract-v2",
    sourceHash: "43e6a249a5a6b3045f52b2ef64f53fb1db3fe6d5bd2dd0a7504576a59b7a4ede",
    requestShape: "messages-single-turn-text",
    responseShape: "messages-text-blocks",
  },
  {
    provider: "google_generative_ai",
    contractKey: "google-generative-ai-hosted-json",
    contractVersion: "contract-v2",
    codecVersion: "text-codec-v1",
    requestSchemaVersion: "text-request-v1",
    responseSchemaVersion: "text-response-v1",
    sourceReference: "market-me://invocation-contracts/google-generative-ai-hosted-json/contract-v2",
    sourceHash: "b3c68ab7c1c085ef28093be5d9a464cab35ad7d6900a241233e154a63ec0b879",
    requestShape: "generate-content-single-turn-text",
    responseShape: "generate-content-text-parts",
  },
] as const);

export const AI_PROVIDER_TEXT_CODEC_CONSTRAINTS = Object.freeze([
  "non-streaming",
  "no-tools",
  "no-media",
  "no-transport-authority",
  "bounded-response",
] as const);

export const AI_TEXT_CODEC_LIMITS = Object.freeze({
  modelIdCharacters: 200,
  systemTextCharacters: 20_000,
  userTextCharacters: 200_000,
  maxOutputTokens: 16_384,
  responseBytes: 1_048_576,
  responseTextCharacters: 400_000,
  responseItems: 32,
} as const);

export type AiTextCodecErrorCode =
  | "invalid_request"
  | "unsupported_provider"
  | "response_too_large"
  | "invalid_json"
  | "invalid_response"
  | "output_too_large";

export class AiTextCodecError extends Error {
  readonly code: AiTextCodecErrorCode;

  constructor(code: AiTextCodecErrorCode, message: string) {
    super(message);
    this.name = "AiTextCodecError";
    this.code = code;
  }
}

export interface AiTextCodecRequest {
  provider: AiHostedProviderType;
  modelId: string;
  userText: string;
  systemText?: string;
  maxOutputTokens: number;
}

export interface AiProviderTextRequest {
  provider: AiHostedProviderType;
  modelId: string;
  body: Readonly<Record<string, unknown>>;
  streaming: false;
  tools: false;
  execution: false;
}

export type AiTextStopReason =
  | "completed"
  | "max_output"
  | "refusal"
  | "blocked"
  | "unknown";

export interface AiTextTokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiProviderTextResponse {
  provider: AiHostedProviderType;
  providerResponseId?: string;
  text: string;
  stopReason: AiTextStopReason;
  usage?: AiTextTokenUsage;
  streaming: false;
  toolsUsed: false;
  rawResponseStored: false;
  execution: false;
}

type JsonObject = Record<string, unknown>;

function fail(code: AiTextCodecErrorCode, message: string): never {
  throw new AiTextCodecError(code, message);
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_response", `${label} must be an object.`);
  return value as JsonObject;
}

function boundedArray(value: unknown, label: string, allowEmpty = false): unknown[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) ||
      value.length > AI_TEXT_CODEC_LIMITS.responseItems)
    fail("invalid_response", `${label} has an invalid item count.`);
  return value;
}

function boundedText(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0))
    fail("invalid_response", `${label} must be text.`);
  if (value.length > AI_TEXT_CODEC_LIMITS.responseTextCharacters)
    fail("output_too_large", "Provider text exceeded the codec output limit.");
  return value;
}

function optionalId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= 200
    ? value
    : undefined;
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function usageOrUndefined(usage: AiTextTokenUsage): AiTextTokenUsage | undefined {
  return Object.values(usage).some((value) => value !== undefined) ? usage : undefined;
}

function result(
  provider: AiHostedProviderType,
  responseId: unknown,
  text: string,
  stopReason: AiTextStopReason,
  usage?: AiTextTokenUsage,
): AiProviderTextResponse {
  if (text.length > AI_TEXT_CODEC_LIMITS.responseTextCharacters)
    fail("output_too_large", "Provider text exceeded the codec output limit.");
  return {
    provider,
    ...(optionalId(responseId) ? { providerResponseId: optionalId(responseId) } : {}),
    text,
    stopReason,
    ...(usage ? { usage } : {}),
    streaming: false,
    toolsUsed: false,
    rawResponseStored: false,
    execution: false,
  };
}

function validateRequest(input: AiTextCodecRequest): void {
  if (!(["openai", "anthropic", "google_generative_ai"] as const).includes(input.provider))
    fail("unsupported_provider", "The provider does not have a reviewed text codec.");
  if (typeof input.modelId !== "string" || input.modelId !== input.modelId.trim() ||
      input.modelId.length === 0 || input.modelId.length > AI_TEXT_CODEC_LIMITS.modelIdCharacters ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(input.modelId))
    fail("invalid_request", "The model identifier is invalid.");
  if (typeof input.userText !== "string" || input.userText.length === 0 ||
      input.userText.length > AI_TEXT_CODEC_LIMITS.userTextCharacters)
    fail("invalid_request", "User text is outside the codec bounds.");
  if (input.systemText !== undefined &&
      (typeof input.systemText !== "string" || input.systemText.length === 0 ||
       input.systemText.length > AI_TEXT_CODEC_LIMITS.systemTextCharacters))
    fail("invalid_request", "System text is outside the codec bounds.");
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1 ||
      input.maxOutputTokens > AI_TEXT_CODEC_LIMITS.maxOutputTokens)
    fail("invalid_request", "The output token limit is outside the codec bounds.");
}

export function buildAiProviderTextRequest(input: AiTextCodecRequest): AiProviderTextRequest {
  validateRequest(input);
  let body: Record<string, unknown>;
  if (input.provider === "openai") {
    body = {
      model: input.modelId,
      ...(input.systemText ? { instructions: input.systemText } : {}),
      input: input.userText,
      max_output_tokens: input.maxOutputTokens,
      store: false,
      stream: false,
    };
  } else if (input.provider === "anthropic") {
    body = {
      model: input.modelId,
      max_tokens: input.maxOutputTokens,
      ...(input.systemText
        ? { system: [{ type: "text", text: input.systemText }] }
        : {}),
      messages: [{ role: "user", content: [{ type: "text", text: input.userText }] }],
      stream: false,
    };
  } else {
    body = {
      ...(input.systemText
        ? { systemInstruction: { parts: [{ text: input.systemText }] } }
        : {}),
      contents: [{ role: "user", parts: [{ text: input.userText }] }],
      generationConfig: { maxOutputTokens: input.maxOutputTokens },
    };
  }
  return {
    provider: input.provider,
    modelId: input.modelId,
    body,
    streaming: false,
    tools: false,
    execution: false,
  };
}

function parseOpenAi(root: JsonObject): AiProviderTextResponse {
  if (root.error !== undefined) fail("invalid_response", "OpenAI returned an error object.");
  const status = root.status;
  if (status !== "completed" && status !== "incomplete")
    fail("invalid_response", "OpenAI returned a non-final response.");
  const texts: string[] = [];
  const refusals: string[] = [];
  for (const rawItem of boundedArray(root.output, "OpenAI output")) {
    const item = object(rawItem, "OpenAI output item");
    if (item.type === "reasoning") continue;
    if (item.type !== "message" || item.role !== "assistant")
      fail("invalid_response", "OpenAI returned an unsupported output item.");
    for (const rawPart of boundedArray(item.content, "OpenAI message content")) {
      const part = object(rawPart, "OpenAI content part");
      if (part.type === "output_text") texts.push(boundedText(part.text, "OpenAI output text"));
      else if (part.type === "refusal") refusals.push(boundedText(part.refusal, "OpenAI refusal"));
      else fail("invalid_response", "OpenAI returned unsupported message content.");
    }
  }
  if ((texts.length === 0) === (refusals.length === 0))
    fail("invalid_response", "OpenAI must return either text or a refusal.");
  const usage = root.usage === undefined ? undefined : object(root.usage, "OpenAI usage");
  const normalizedUsage = usageOrUndefined({
    inputTokens: tokenCount(usage?.input_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
    totalTokens: tokenCount(usage?.total_tokens),
  });
  let stopReason: AiTextStopReason = "completed";
  if (refusals.length) stopReason = "refusal";
  else if (status === "incomplete") {
    const details = root.incomplete_details === undefined
      ? undefined
      : object(root.incomplete_details, "OpenAI incomplete details");
    stopReason = details?.reason === "max_output_tokens" ? "max_output" : "unknown";
  }
  return result("openai", root.id, (texts.length ? texts : refusals).join(""), stopReason, normalizedUsage);
}

function parseAnthropic(root: JsonObject): AiProviderTextResponse {
  if (root.type === "error" || root.error !== undefined)
    fail("invalid_response", "Anthropic returned an error object.");
  if (root.type !== "message" || root.role !== "assistant")
    fail("invalid_response", "Anthropic returned an invalid message envelope.");
  const texts: string[] = [];
  for (const rawPart of boundedArray(root.content, "Anthropic content")) {
    const part = object(rawPart, "Anthropic content block");
    if (part.type !== "text")
      fail("invalid_response", "Anthropic returned unsupported content.");
    texts.push(boundedText(part.text, "Anthropic output text"));
  }
  const stop = root.stop_reason;
  const stopReason: AiTextStopReason = stop === "end_turn" || stop === "stop_sequence"
    ? "completed"
    : stop === "max_tokens" || stop === "model_context_window_exceeded"
      ? "max_output"
      : stop === "refusal"
        ? "refusal"
        : "unknown";
  if (stop === "tool_use" || stop === "pause_turn")
    fail("invalid_response", "Anthropic returned a tool or continuation response.");
  const usage = root.usage === undefined ? undefined : object(root.usage, "Anthropic usage");
  const inputTokens = tokenCount(usage?.input_tokens);
  const outputTokens = tokenCount(usage?.output_tokens);
  const normalizedUsage = usageOrUndefined({
    inputTokens,
    outputTokens,
    totalTokens: inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined,
  });
  return result("anthropic", root.id, texts.join(""), stopReason, normalizedUsage);
}

function googleStopReason(value: unknown): AiTextStopReason {
  if (value === "STOP" || value === "FINISH_REASON_UNSPECIFIED") return "completed";
  if (value === "MAX_TOKENS") return "max_output";
  if (["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "IMAGE_SAFETY"].includes(String(value)))
    return "blocked";
  return "unknown";
}

function parseGoogle(root: JsonObject): AiProviderTextResponse {
  if (root.error !== undefined) fail("invalid_response", "Google returned an error object.");
  const candidates = boundedArray(root.candidates, "Google candidates", true);
  const feedback = root.promptFeedback === undefined
    ? undefined
    : object(root.promptFeedback, "Google prompt feedback");
  if (candidates.length === 0) {
    if (typeof feedback?.blockReason !== "string")
      fail("invalid_response", "Google returned no candidate or block reason.");
    return result("google_generative_ai", root.responseId, "", "blocked", googleUsage(root));
  }
  if (candidates.length !== 1)
    fail("invalid_response", "Google returned multiple candidates for a single-candidate request.");
  const candidate = object(candidates[0], "Google candidate");
  const content = object(candidate.content, "Google candidate content");
  if (content.role !== undefined && content.role !== "model")
    fail("invalid_response", "Google returned an invalid content role.");
  const texts: string[] = [];
  for (const rawPart of boundedArray(content.parts, "Google content parts")) {
    const part = object(rawPart, "Google content part");
    if (part.thought === true || typeof part.text !== "string" ||
        Object.hasOwn(part, "functionCall") || Object.hasOwn(part, "executableCode"))
      fail("invalid_response", "Google returned unsupported content.");
    texts.push(boundedText(part.text, "Google output text"));
  }
  return result(
    "google_generative_ai",
    root.responseId,
    texts.join(""),
    googleStopReason(candidate.finishReason),
    googleUsage(root),
  );
}

function googleUsage(root: JsonObject): AiTextTokenUsage | undefined {
  const usage = root.usageMetadata === undefined
    ? undefined
    : object(root.usageMetadata, "Google usage metadata");
  return usageOrUndefined({
    inputTokens: tokenCount(usage?.promptTokenCount),
    outputTokens: tokenCount(usage?.candidatesTokenCount),
    totalTokens: tokenCount(usage?.totalTokenCount),
  });
}

export function parseAiProviderTextResponse(
  provider: AiHostedProviderType,
  rawJson: string,
): AiProviderTextResponse {
  if (!(["openai", "anthropic", "google_generative_ai"] as const).includes(provider))
    fail("unsupported_provider", "The provider does not have a reviewed text codec.");
  if (typeof rawJson !== "string") fail("invalid_json", "Provider response must be JSON text.");
  if (new TextEncoder().encode(rawJson).byteLength > AI_TEXT_CODEC_LIMITS.responseBytes)
    fail("response_too_large", "Provider response exceeded the codec byte limit.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    fail("invalid_json", "Provider response was not valid JSON.");
  }
  const root = object(parsed, "Provider response");
  if (provider === "openai") return parseOpenAi(root);
  if (provider === "anthropic") return parseAnthropic(root);
  return parseGoogle(root);
}
