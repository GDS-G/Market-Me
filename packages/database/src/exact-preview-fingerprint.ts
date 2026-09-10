import { createHash } from "node:crypto";
import { types } from "node:util";

export const EXACT_PREVIEW_FINGERPRINT_VERSION = 1;
export const EXACT_PREVIEW_RENDERER_CONTRACT = "stored-channel-preview-text-v1";
export const EXACT_PREVIEW_FINGERPRINT_DOMAIN = "market-me:exact-preview:v1\n";
export const EXACT_PREVIEW_FINGERPRINT_PREFIX = "mm-preview-v1:sha256:";

/** Fixed v1 resource bounds. Depth counts from the root object at zero. */
export const EXACT_PREVIEW_FINGERPRINT_LIMITS = Object.freeze({
  depth: 32,
  nodes: 50_000,
  stringCodeUnits: 262_144,
  canonicalBytes: 1_048_576,
});

export type ExactPreviewProvider = "discord_webhook" | "slack_webhook" | "mastodon_account";
export type ExactPreviewRawJson = null | boolean | number | string
  | readonly ExactPreviewRawJson[] | { readonly [key: string]: ExactPreviewRawJson };
export type ExactPreviewRawJsonObject = { readonly [key: string]: ExactPreviewRawJson };
export type ExactPreviewConnectionV1 = {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: "active" | "error" | "revoked";
} & (
  { readonly provider: "discord_webhook"; readonly identity: { readonly webhookId: string; readonly channelId: string; readonly guildId: string | null } }
  | { readonly provider: "slack_webhook"; readonly identity: { readonly teamId: string; readonly serviceId: string; readonly host: string } }
  | { readonly provider: "mastodon_account"; readonly identity: { readonly accountId: string; readonly instanceOrigin: string; readonly host: string } }
);

export interface ExactPreviewSnapshotV1 {
  readonly schemaVersion: typeof EXACT_PREVIEW_FINGERPRINT_VERSION;
  readonly rendererContract: typeof EXACT_PREVIEW_RENDERER_CONTRACT;
  readonly lineage: {
    readonly workspaceId: string;
    readonly campaignId: string;
    readonly sourceCampaignVersionId: string;
    readonly generationId: string;
    readonly previewId: string;
    readonly contentDraftId: string;
    readonly contentDraftVersionId: string;
  };
  readonly preview: {
    readonly provider: ExactPreviewProvider;
    readonly channelConnectionId: string;
    readonly destinationId: string | null;
    readonly linkMode: "canonical" | "tracked";
    readonly status: "ready" | "blocked";
    readonly renderedSubject: string | null;
    readonly renderedContent: string;
    readonly subjectCount: number | null;
    readonly subjectLimit: number | null;
    readonly characterCount: number;
    readonly characterLimit: number | null;
    readonly validationIssues: readonly { readonly code: string; readonly message: string }[];
    readonly capabilityVersion: string;
    readonly capabilityObservedAtUtcMicros: string;
    readonly capabilitySnapshot: ExactPreviewRawJsonObject;
    readonly createdBy: string;
    readonly createdAtUtcMicros: string;
    readonly assets: readonly [];
  };
  readonly connection: ExactPreviewConnectionV1;
  readonly destination: null | {
    readonly id: string;
    readonly workspaceId: string;
    readonly provider: string;
    readonly status: "draft" | "published" | "unavailable" | "expired" | "replaced" | "archived";
    readonly canonicalUrl: string;
  };
  readonly trackedLink: null | {
    readonly id: string;
    readonly workspaceId: string;
    readonly destinationId: string;
    readonly draftChannelPreviewId: string;
    readonly campaignInstanceId: string | null;
    readonly campaignStepRunId: string | null;
    readonly slug: string;
    readonly canonicalUrl: string;
    readonly utmParameters: Readonly<Record<string, string>>;
    readonly status: "active" | "disabled" | "expired";
    readonly expiresAtUtcMicros: string | null;
    readonly publicRedirectUrl: string;
  };
}

export interface ExactPreviewFingerprintResult {
  readonly token: string;
  readonly canonicalSnapshot: string;
  readonly snapshot: ExactPreviewSnapshotV1;
}
export interface ExactPreviewFingerprintIssue {
  readonly field: string;
  readonly code: "invalid_json" | "invalid_schema" | "unsupported_version" | "unsupported_renderer"
    | "invalid_reference" | "invalid_timestamp" | "invalid_number" | "invalid_url" | "limit_exceeded";
  readonly message: string;
}
export class ExactPreviewFingerprintValidationError extends Error {
  readonly issues: readonly ExactPreviewFingerprintIssue[];
  constructor(issue: ExactPreviewFingerprintIssue) {
    super(issue.message);
    this.name = "ExactPreviewFingerprintValidationError";
    this.issues = Object.freeze([Object.freeze(issue)]);
  }
}

type JsonObject = { readonly [key: string]: ExactPreviewRawJson };
const providers = ["discord_webhook", "slack_webhook", "mastodon_account"] as const;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function invalid(field: string, code: ExactPreviewFingerprintIssue["code"], message: string): never {
  throw new ExactPreviewFingerprintValidationError({ field, code, message });
}

function validUnicode(value: string, field: string): void {
  if (value.length > EXACT_PREVIEW_FINGERPRINT_LIMITS.stringCodeUnits) invalid(field, "limit_exceeded", "Snapshot string exceeds the v1 limit.");
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(field, "invalid_json", "Snapshot strings must contain valid Unicode scalar values.");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid(field, "invalid_json", "Snapshot strings must contain valid Unicode scalar values.");
  }
}

/** Copies descriptors, never reads a caller property/getter or calls toJSON. */
function detachedJson(input: unknown): ExactPreviewRawJson {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;
  const charge = (amount: number, field: string) => {
    bytes += amount;
    if (bytes > EXACT_PREVIEW_FINGERPRINT_LIMITS.canonicalBytes) invalid(field, "limit_exceeded", "Canonical snapshot exceeds the v1 byte limit.");
  };
  function copy(value: unknown, field: string, depth: number): ExactPreviewRawJson {
    if (++nodes > EXACT_PREVIEW_FINGERPRINT_LIMITS.nodes || depth > EXACT_PREVIEW_FINGERPRINT_LIMITS.depth) {
      invalid(field, "limit_exceeded", "Snapshot exceeds the v1 node/depth limit.");
    }
    if (value === null || typeof value === "boolean") { charge(value === null ? 4 : value ? 4 : 5, field); return value; }
    if (typeof value === "string") { validUnicode(value, field); charge(Buffer.byteLength(JSON.stringify(value), "utf8"), field); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid(field, "invalid_number", "Snapshot numbers must be finite IEEE-754 values.");
      charge(JSON.stringify(value).length, field);
      return value;
    }
    if (typeof value !== "object" || types.isProxy(value)) invalid(field, "invalid_json", "Provide ordinary JSON values without proxies or executable properties.");
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) invalid(field, "invalid_json", "Snapshot containers must be ordinary JSON objects or arrays.");
    if (ancestors.has(value)) invalid(field, "invalid_json", "Snapshot JSON must not contain cycles.");
    ancestors.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length > EXACT_PREVIEW_FINGERPRINT_LIMITS.nodes) invalid(field, "limit_exceeded", "Snapshot container exceeds the v1 node limit.");
      if (keys.some((key) => typeof key === "symbol")) invalid(field, "invalid_json", "Snapshot JSON cannot contain symbol properties.");
      if (array) {
        const length = descriptors.length!.value as number;
        if (length > EXACT_PREVIEW_FINGERPRINT_LIMITS.nodes) invalid(field, "limit_exceeded", "Snapshot array exceeds the v1 node limit.");
        if (keys.length !== length + 1 || keys.some((key) => key !== "length"
          && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) {
          invalid(field, "invalid_json", "Snapshot arrays must be dense and have no extra properties.");
        }
        charge(2 + Math.max(0, length - 1), field);
        const result: ExactPreviewRawJson[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid(field, "invalid_json", "Snapshot array entries must be ordinary enumerable values.");
          result.push(copy(descriptor.value, `${field}.${index}`, depth + 1));
        }
        return Object.freeze(result);
      }
      charge(2 + Math.max(0, keys.length - 1) + keys.length, field);
      const result: Record<string, ExactPreviewRawJson> = {};
      for (const key of keys as string[]) {
        validUnicode(key, field);
        charge(Buffer.byteLength(JSON.stringify(key), "utf8"), field);
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || !descriptor.enumerable) invalid(`${field}.${key}`, "invalid_json", "Snapshot object properties must be ordinary enumerable values.");
        Object.defineProperty(result, key, { value: copy(descriptor.value, `${field}.${key}`, depth + 1), enumerable: true });
      }
      return Object.freeze(result);
    } finally { ancestors.delete(value); }
  }
  return copy(input, "$", 0);
}

function object(value: ExactPreviewRawJson, field: string, fields?: readonly string[]): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field, "invalid_schema", "Expected a snapshot object.");
  const result = value as JsonObject;
  if (fields && (Object.keys(result).length !== fields.length || fields.some((key) => !Object.hasOwn(result, key)))) {
    invalid(field, "invalid_schema", "Snapshot object must contain exactly the required v1 fields, with explicit nulls.");
  }
  return result;
}
function string(value: ExactPreviewRawJson, field: string, nonempty = false): void {
  if (typeof value !== "string" || (nonempty && !value.trim())) invalid(field, "invalid_schema", "Expected a snapshot string with the required content.");
}
function choice(value: ExactPreviewRawJson, field: string, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(field, "invalid_schema", "Unsupported snapshot value.");
}
function uuid(value: ExactPreviewRawJson, field: string): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) invalid(field, "invalid_reference", "Use an exact canonical lowercase nonzero UUID reference.");
}
function count(value: ExactPreviewRawJson, field: string, minimum = 0): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > 2_147_483_647) invalid(field, "invalid_number", "Snapshot count must be a bounded database integer.");
}
function timestamp(value: ExactPreviewRawJson, field: string): void {
  if (typeof value !== "string") invalid(field, "invalid_timestamp", "Use a six-digit UTC timestamp string.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/u.exec(value);
  if (!match) invalid(field, "invalid_timestamp", "Use a six-digit UTC timestamp string.");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year! < 1 || month! < 1 || month! > 12 || day! < 1 || day! > days[month! - 1]!
    || hour! > 23 || minute! > 59 || second! > 59) invalid(field, "invalid_timestamp", "Snapshot timestamp is outside the valid finite Gregorian UTC range.");
}
function url(value: ExactPreviewRawJson, field: string): void {
  if (typeof value !== "string" || !/^https?:\/\//iu.test(value) || /\s/u.test(value)) invalid(field, "invalid_url", "Use an exact nonempty absolute HTTP(S) URL without whitespace.");
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || parsed.username || parsed.password) throw new Error("invalid");
  } catch { invalid(field, "invalid_url", "Use an exact absolute HTTP(S) URL without credentials."); }
}
function nullable(value: ExactPreviewRawJson, field: string, check: (value: ExactPreviewRawJson, field: string) => void): void {
  if (value !== null) check(value, field);
}

function validateSnapshot(value: ExactPreviewRawJson): void {
  const root = object(value, "$", ["schemaVersion", "rendererContract", "lineage", "preview", "connection", "destination", "trackedLink"]);
  if (root.schemaVersion !== EXACT_PREVIEW_FINGERPRINT_VERSION) invalid("$.schemaVersion", "unsupported_version", "Unsupported exact-preview fingerprint version.");
  if (root.rendererContract !== EXACT_PREVIEW_RENDERER_CONTRACT) invalid("$.rendererContract", "unsupported_renderer", "Unsupported exact-preview renderer contract.");
  const lineageFields = ["workspaceId", "campaignId", "sourceCampaignVersionId", "generationId", "previewId", "contentDraftId", "contentDraftVersionId"];
  const lineage = object(root.lineage, "$.lineage", lineageFields);
  for (const key of lineageFields) uuid(lineage[key], `$.lineage.${key}`);
  const preview = object(root.preview, "$.preview", ["provider", "channelConnectionId", "destinationId", "linkMode", "status", "renderedSubject", "renderedContent",
    "subjectCount", "subjectLimit", "characterCount", "characterLimit", "validationIssues", "capabilityVersion", "capabilityObservedAtUtcMicros",
    "capabilitySnapshot", "createdBy", "createdAtUtcMicros", "assets"]);
  choice(preview.provider, "$.preview.provider", providers);
  uuid(preview.channelConnectionId, "$.preview.channelConnectionId");
  nullable(preview.destinationId, "$.preview.destinationId", uuid);
  choice(preview.linkMode, "$.preview.linkMode", ["canonical", "tracked"]);
  choice(preview.status, "$.preview.status", ["ready", "blocked"]);
  nullable(preview.renderedSubject, "$.preview.renderedSubject", string);
  string(preview.renderedContent, "$.preview.renderedContent");
  nullable(preview.subjectCount, "$.preview.subjectCount", count);
  nullable(preview.subjectLimit, "$.preview.subjectLimit", (item, field) => count(item, field, 1));
  count(preview.characterCount, "$.preview.characterCount");
  nullable(preview.characterLimit, "$.preview.characterLimit", (item, field) => count(item, field, 1));
  if (!Array.isArray(preview.validationIssues)) invalid("$.preview.validationIssues", "invalid_schema", "Expected a validation issue array.");
  for (const [index, issue] of preview.validationIssues.entries()) {
    const record = object(issue, `$.preview.validationIssues.${index}`, ["code", "message"]);
    string(record.code, `$.preview.validationIssues.${index}.code`, true);
    string(record.message, `$.preview.validationIssues.${index}.message`, true);
  }
  string(preview.capabilityVersion, "$.preview.capabilityVersion", true);
  timestamp(preview.capabilityObservedAtUtcMicros, "$.preview.capabilityObservedAtUtcMicros");
  object(preview.capabilitySnapshot, "$.preview.capabilitySnapshot");
  uuid(preview.createdBy, "$.preview.createdBy");
  timestamp(preview.createdAtUtcMicros, "$.preview.createdAtUtcMicros");
  if (!Array.isArray(preview.assets) || preview.assets.length) invalid("$.preview.assets", "invalid_schema", "Exact-preview v1 supports an explicit empty attachment array only.");
  const connection = object(root.connection, "$.connection", ["id", "workspaceId", "provider", "status", "identity"]);
  uuid(connection.id, "$.connection.id");
  uuid(connection.workspaceId, "$.connection.workspaceId");
  choice(connection.provider, "$.connection.provider", providers);
  choice(connection.status, "$.connection.status", ["active", "error", "revoked"]);
  const identityKeys = connection.provider === "discord_webhook" ? ["webhookId", "channelId", "guildId"]
    : connection.provider === "slack_webhook" ? ["teamId", "serviceId", "host"] : ["accountId", "instanceOrigin", "host"];
  const identity = object(connection.identity, "$.connection.identity", identityKeys);
  for (const key of identityKeys) {
    if (key === "guildId" && identity[key] === null) continue;
    string(identity[key], `$.connection.identity.${key}`, true);
    if (key === "instanceOrigin") url(identity[key], `$.connection.identity.${key}`);
  }
  if (root.destination !== null) {
    const destination = object(root.destination, "$.destination", ["id", "workspaceId", "provider", "status", "canonicalUrl"]);
    uuid(destination.id, "$.destination.id");
    uuid(destination.workspaceId, "$.destination.workspaceId");
    string(destination.provider, "$.destination.provider", true);
    choice(destination.status, "$.destination.status", ["draft", "published", "unavailable", "expired", "replaced", "archived"]);
    url(destination.canonicalUrl, "$.destination.canonicalUrl");
  }
  if (root.trackedLink !== null) {
    const link = object(root.trackedLink, "$.trackedLink", ["id", "workspaceId", "destinationId", "draftChannelPreviewId", "campaignInstanceId", "campaignStepRunId", "slug", "canonicalUrl", "utmParameters", "status", "expiresAtUtcMicros", "publicRedirectUrl"]);
    for (const key of ["id", "workspaceId", "destinationId", "draftChannelPreviewId"]) uuid(link[key], `$.trackedLink.${key}`);
    for (const key of ["campaignInstanceId", "campaignStepRunId"]) nullable(link[key], `$.trackedLink.${key}`, uuid);
    string(link.slug, "$.trackedLink.slug", true);
    if (typeof link.slug !== "string" || link.slug.length < 8 || link.slug.length > 64) invalid("$.trackedLink.slug", "invalid_schema", "Tracked-link slug must retain its bounded database identity.");
    for (const key of ["canonicalUrl", "publicRedirectUrl"]) url(link[key], `$.trackedLink.${key}`);
    const utm = object(link.utmParameters, "$.trackedLink.utmParameters");
    for (const key of Object.keys(utm)) string(utm[key], `$.trackedLink.utmParameters.${key}`);
    choice(link.status, "$.trackedLink.status", ["active", "disabled", "expired"]);
    nullable(link.expiresAtUtcMicros, "$.trackedLink.expiresAtUtcMicros", timestamp);
  }
}

/** RFC 8785: direct key traversal avoids JSON.stringify's integer-key reordering. */
function canonicalJson(value: ExactPreviewRawJson): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as JsonObject;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/**
 * Server-only pure fingerprint primitive. No DB, Date, I/O, random IDs, global
 * mutable request state, readiness decision, or authority is created here.
 * The caller must load raw JSON/text timestamps, reject lossy JSONB numeric
 * round trips, lock/recheck exact lineage/eligibility, and enforce the retained
 * token at activation and publication. A known blocked/inactive state can be
 * fingerprinted; this function does not authorize it to execute.
 */
export function createExactPreviewFingerprint(input: unknown): ExactPreviewFingerprintResult {
  const detached = detachedJson(input);
  validateSnapshot(detached);
  const canonicalSnapshot = canonicalJson(detached);
  const token = EXACT_PREVIEW_FINGERPRINT_PREFIX + createHash("sha256")
    .update(EXACT_PREVIEW_FINGERPRINT_DOMAIN, "utf8").update(canonicalSnapshot, "utf8").digest("hex");
  return Object.freeze({ token, canonicalSnapshot, snapshot: detached as unknown as ExactPreviewSnapshotV1 });
}
