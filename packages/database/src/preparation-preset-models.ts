import { normalizeCampaignPreparationSettings, type CampaignPreparationSettings } from "./campaign-preparation-template";

export const PREPARATION_PRESET_LIMITS = Object.freeze({ title: 120, notes: 2_000, requestBytes: 32_768, list: 50, history: 20 });
const ERROR_BRAND = Symbol.for("@market-me/database/PreparationPresetError/v1");
export class PreparationPresetError extends Error {
  readonly [ERROR_BRAND] = true;
  constructor(readonly code: "invalid_input" | "access_denied" | "not_found" | "request_conflict" | "revision_conflict"
    | "archived" | "reference_unavailable" | "policy_conflict", message: string) {
    super(message); this.name = "PreparationPresetError";
  }
}
export function isPreparationPresetError(error: unknown): error is PreparationPresetError {
  return error instanceof Error && Reflect.get(error, ERROR_BRAND) === true;
}
export interface PreparationPresetVersion {
  workspaceId: string; presetId: string; versionNumber: number; title: string; notes: string;
  configuration: CampaignPreparationSettings; configurationHash: string; createdAt: string;
  /** Optional historical clone origin, never approval or execution authority. */
  copiedFrom: { presetId: string; versionNumber: number } | null;
}
export interface PreparationPresetSummary {
  workspaceId: string; id: string; revision: number; archived: boolean; latestVersionNumber: number;
  title: string; notes: string; updatedAt: string;
}
export interface PreparationPresetReceipt {
  workspaceId: string; requestId: string; operation: "create" | "revise" | "clone" | "archive" | "restore";
  presetId: string; versionNumber: number; revision: number; archived: boolean; title: string; createdAt: string;
}
interface RequestScope { workspaceId: string; requestId: string }
interface VersionValues { title: string; notes: string; configuration: CampaignPreparationSettings }
export type PreparationPresetRequest =
  | RequestScope & VersionValues & { operation: "create" }
  | RequestScope & VersionValues & { operation: "revise"; presetId: string; expectedRevision: number }
  | RequestScope & { operation: "clone"; presetId: string; expectedRevision: number; versionNumber: number; title: string }
  | RequestScope & { operation: "archive"; presetId: string; expectedRevision: number }
  | RequestScope & { operation: "restore"; presetId: string; expectedRevision: number };

function invalid(message: string): never { throw new PreparationPresetError("invalid_input", message); }
export function preparationPresetUuid(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())) {
    invalid("Choose a valid workspace, preset or request identifier.");
  }
  return value.trim().toLowerCase();
}
export function preparationPresetInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2_147_483_647) invalid("Choose a positive saved revision or version.");
  return value;
}
function text(value: unknown, max: number, title = false): string {
  if (typeof value !== "string") invalid("Provide text for the preset title and notes.");
  let result = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  if (title) result = result.replace(/\s+/gu, " ");
  if (result.length > max || title && !result || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(result)) {
    invalid(`Use a ${title ? "nonempty " : ""}preset label of at most ${max} characters without control characters.`);
  }
  return result;
}

/** Strict canonical mutation envelope; ordinary JSON values only, no inherited authority. */
export function normalizePreparationPresetRequest(input: unknown): PreparationPresetRequest {
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) invalid("Provide ordinary JSON preset settings.");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Reflect.ownKeys(descriptors).some((field) => typeof field !== "string" || !("value" in descriptors[field]!) || !descriptors[field]!.enumerable)) {
    invalid("Preset settings cannot contain accessors or hidden fields.");
  }
  const raw = input as Record<string, unknown>;
  if (typeof raw.operation !== "string" || !["create", "revise", "clone", "archive", "restore"].includes(raw.operation)) invalid("Choose a supported preset operation.");
  const operation = raw.operation as PreparationPresetRequest["operation"];
  const fields = new Set(["operation", "workspaceId", "requestId",
    ...(operation !== "create" ? ["presetId", "expectedRevision"] : []),
    ...(["create", "revise"].includes(operation) ? ["title", "notes", "configuration"] : []),
    ...(operation === "clone" ? ["versionNumber", "title"] : [])]);
  if (Object.keys(raw).some((field) => !fields.has(field))) invalid("The preset contains unsupported fields or authority.");
  const scope = { workspaceId: preparationPresetUuid(raw.workspaceId), requestId: preparationPresetUuid(raw.requestId) };
  let normalized: PreparationPresetRequest;
  if (operation === "create" || operation === "revise") {
    const values = { title: text(raw.title, PREPARATION_PRESET_LIMITS.title, true), notes: text(raw.notes === undefined ? "" : raw.notes, PREPARATION_PRESET_LIMITS.notes),
      configuration: normalizeCampaignPreparationSettings(raw.configuration) };
    normalized = operation === "create" ? { operation, ...scope, ...values }
      : { operation, ...scope, presetId: preparationPresetUuid(raw.presetId), expectedRevision: preparationPresetInteger(raw.expectedRevision), ...values };
  } else {
    const saved = { ...scope, presetId: preparationPresetUuid(raw.presetId), expectedRevision: preparationPresetInteger(raw.expectedRevision) };
    normalized = operation === "clone" ? { operation, ...saved, versionNumber: preparationPresetInteger(raw.versionNumber), title: text(raw.title, PREPARATION_PRESET_LIMITS.title, true) }
      : { operation, ...saved };
  }
  if (Buffer.byteLength(JSON.stringify(normalized), "utf8") > PREPARATION_PRESET_LIMITS.requestBytes) invalid("The preset request exceeds the bounded settings limit.");
  return Object.freeze(normalized);
}
