import { createHash } from "node:crypto";
import { types } from "node:util";

export const CONTENT_PACKAGE_REVIEW_VERSION = 1;
export const CONTENT_PACKAGE_REVIEW_CONTRACT = "content-package-review-v1";
export const CONTENT_PACKAGE_REVIEW_DOMAIN = "market-me:content-package-review:v1\n";
export const CONTENT_PACKAGE_REVIEW_PREFIX = "mm-package-review-v1:sha256:";
/** Frozen v1 bounds; root depth is zero. Raw projection bytes are enforced by the SQL loader. */
export const CONTENT_PACKAGE_REVIEW_LIMITS = Object.freeze({
  depth: 32, nodes: 200_000, stringCodeUnits: 1_048_576,
  canonicalBytes: 8_388_608, rawProjectionBytes: 16_777_216,
  evidenceItems: 10_000, conflicts: 2_000, assets: 1_000,
  contextPackVersions: 1_000, candidatesPerConflict: 1_000,
  sourceReferencesPerEvidence: 1_000, scopeIdsPerAsset: 10_000,
});

export type ContentPackageReviewRawJson = null | boolean | number | string
  | readonly ContentPackageReviewRawJson[] | { readonly [key: string]: ContentPackageReviewRawJson };
export type ContentPackageReviewRawJsonObject = { readonly [key: string]: ContentPackageReviewRawJson };
export type ContentPackageReviewProvenance = "observed" | "authoritative_context" | "inferred" | "unresolved";
export interface ContentPackageReviewPackageV1 {
  readonly id: string; readonly workspaceId: string; readonly smartSourceId: string; readonly rootSourceItemId: string;
  readonly version: number; readonly title: string; readonly confidence: number | null;
  readonly contextPackVersionIds: readonly string[]; readonly createdAtUtcMicros: string;
}
export interface ContentPackageReviewEvidenceV1 {
  readonly id: string; readonly factKey: string | null; readonly claim: string;
  readonly provenance: ContentPackageReviewProvenance; readonly sourceReferences: readonly string[];
  readonly confidence: number | null; readonly contextPackVersionId: string | null;
  readonly supersededByEvidenceId: string | null; readonly createdAtUtcMicros: string;
}
export interface ContentPackageReviewConflictV1 {
  readonly id: string; readonly factKey: string; readonly candidateEvidenceIds: readonly string[];
  readonly status: "open" | "resolved" | "dismissed"; readonly resolutionEvidenceId: string | null;
  readonly resolutionNote: string | null; readonly createdAtUtcMicros: string; readonly resolvedAtUtcMicros: string | null;
}
export interface ContentPackageReviewRightsV1 {
  readonly status: "unchecked" | "cleared" | "restricted" | "expired";
  readonly owner: string | null; readonly licenseOwner: string | null;
  readonly sourceReference: string | null; readonly proofReference: string | null;
  readonly commercialUseAllowed: boolean | null; readonly derivativeUseAllowed: boolean | null;
  readonly worldwideUseAllowed: boolean | null; readonly permittedChannels: readonly string[];
  readonly permittedChannelConnectionIds: readonly string[]; readonly permittedCampaignIds: readonly string[];
  readonly permittedBrandProfileIds: readonly string[]; readonly validFromUtcMicros: string | null;
  readonly expiresAtUtcMicros: string | null; readonly attributionRequirement: string | null;
  readonly watermarkRequirement: string | null; readonly disclaimerRequirement: string | null;
  readonly reviewNote: string | null; readonly reviewedBy: string | null;
  readonly reviewedAtUtcMicros: string | null; readonly revision: number;
}
export interface ContentPackageReviewAssetV1 {
  readonly id: string; readonly sourceItemId: string | null; readonly sourceAssetId: string | null;
  readonly role: "original" | "supporting" | "derivative";
  readonly fileName: string; readonly mimeType: string; readonly contentHash: string;
  readonly objectKey: string | null; readonly byteSizeDecimal: string | null; readonly processingVersion: string | null;
  readonly recipe: ContentPackageReviewRawJsonObject; readonly mediaStatus: "stored" | "processed" | "unsupported" | "failed";
  readonly extraction: { readonly status: "pending" | "completed" | "skipped" | "failed"; readonly text: string | null; readonly error: string | null };
  readonly scan: { readonly status: "clean" | "infected" | "not_configured" | "failed"; readonly engine: string | null; readonly scannedAtUtcMicros: string | null; readonly revision: number };
  readonly accessibility: { readonly altText: string | null; readonly status: "not_applicable" | "needs_review" | "approved" | "decorative"; readonly notes: string | null };
  readonly rights: ContentPackageReviewRightsV1;
  readonly metadata: ContentPackageReviewRawJsonObject; readonly createdAtUtcMicros: string;
}
export interface ContentPackageReviewSnapshotV1 {
  readonly schemaVersion: typeof CONTENT_PACKAGE_REVIEW_VERSION;
  readonly reviewContract: typeof CONTENT_PACKAGE_REVIEW_CONTRACT;
  readonly package: ContentPackageReviewPackageV1;
  readonly evidence: readonly ContentPackageReviewEvidenceV1[];
  readonly conflicts: readonly ContentPackageReviewConflictV1[];
  readonly assets: readonly ContentPackageReviewAssetV1[];
}
export interface ContentPackageReviewFingerprintResult {
  readonly token: string; readonly canonicalSnapshot: string; readonly snapshot: ContentPackageReviewSnapshotV1;
}
export interface ContentPackageReviewFingerprintIssue {
  readonly field: string;
  readonly code: "invalid_json" | "invalid_schema" | "unsupported_version" | "unsupported_contract"
    | "invalid_reference" | "invalid_timestamp" | "invalid_number" | "limit_exceeded";
  readonly message: string;
}
export class ContentPackageReviewFingerprintValidationError extends Error {
  readonly issues: readonly ContentPackageReviewFingerprintIssue[];
  constructor(issue: ContentPackageReviewFingerprintIssue) {
    super(issue.message);
    this.name = "ContentPackageReviewFingerprintValidationError";
    this.issues = Object.freeze([Object.freeze(issue)]);
  }
}

type Json = ContentPackageReviewRawJson;
type JsonObject = ContentPackageReviewRawJsonObject;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
function invalid(field: string, code: ContentPackageReviewFingerprintIssue["code"], message: string): never {
  throw new ContentPackageReviewFingerprintValidationError({ field, code, message });
}
function unicode(value: string, field: string): void {
  if (value.length > CONTENT_PACKAGE_REVIEW_LIMITS.stringCodeUnits) invalid(field, "limit_exceeded", "Review string exceeds the v1 limit.");
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(field, "invalid_json", "Review strings must contain valid Unicode scalar values.");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) invalid(field, "invalid_json", "Review strings must contain valid Unicode scalar values.");
  }
}
/** Deliberately independent of exact-preview v1: changing this schema cannot alter its bytes/errors. */
function detachedJson(input: unknown): Json {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  let bytes = 0;
  const charge = (amount: number, field: string) => {
    bytes += amount;
    if (bytes > CONTENT_PACKAGE_REVIEW_LIMITS.canonicalBytes) invalid(field, "limit_exceeded", "Canonical review exceeds the v1 byte limit.");
  };
  function copy(value: unknown, field: string, depth: number): Json {
    if (++nodes > CONTENT_PACKAGE_REVIEW_LIMITS.nodes || depth > CONTENT_PACKAGE_REVIEW_LIMITS.depth) invalid(field, "limit_exceeded", "Review exceeds the v1 node/depth limit.");
    if (value === null || typeof value === "boolean") { charge(value === null ? 4 : value ? 4 : 5, field); return value; }
    if (typeof value === "string") { unicode(value, field); charge(Buffer.byteLength(JSON.stringify(value), "utf8"), field); return value; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid(field, "invalid_number", "Review numbers must be finite IEEE-754 values.");
      charge(JSON.stringify(value).length, field); return value;
    }
    if (typeof value !== "object" || types.isProxy(value)) invalid(field, "invalid_json", "Provide ordinary JSON without proxies or executable properties.");
    const array = Array.isArray(value);
    if (Object.getPrototypeOf(value) !== (array ? Array.prototype : Object.prototype)) invalid(field, "invalid_json", "Review containers must be ordinary JSON objects or arrays.");
    if (ancestors.has(value)) invalid(field, "invalid_json", "Review JSON must not contain cycles.");
    ancestors.add(value);
    try {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.length > CONTENT_PACKAGE_REVIEW_LIMITS.nodes) invalid(field, "limit_exceeded", "Review container exceeds the v1 node limit.");
      if (keys.some((key) => typeof key === "symbol")) invalid(field, "invalid_json", "Review JSON cannot contain symbol properties.");
      if (array) {
        const length = descriptors.length!.value as number;
        if (length > CONTENT_PACKAGE_REVIEW_LIMITS.nodes) invalid(field, "limit_exceeded", "Review array exceeds the v1 node limit.");
        if (keys.length !== length + 1 || keys.some((key) => key !== "length"
          && (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length))) invalid(field, "invalid_json", "Review arrays must be dense without extra properties.");
        charge(2 + Math.max(0, length - 1), field);
        const result: Json[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = descriptors[String(index)];
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) invalid(field, "invalid_json", "Array entries must be ordinary enumerable values.");
          result.push(copy(descriptor.value, `${field}.${index}`, depth + 1));
        }
        return Object.freeze(result);
      }
      charge(2 + Math.max(0, keys.length - 1) + keys.length, field);
      const result: Record<string, Json> = {};
      for (const key of keys as string[]) {
        unicode(key, field); charge(Buffer.byteLength(JSON.stringify(key), "utf8"), field);
        const descriptor = descriptors[key]!;
        if (!("value" in descriptor) || !descriptor.enumerable) invalid(`${field}.${key}`, "invalid_json", "Object properties must be ordinary enumerable values.");
        Object.defineProperty(result, key, { value: copy(descriptor.value, `${field}.${key}`, depth + 1), enumerable: true });
      }
      return Object.freeze(result);
    } finally { ancestors.delete(value); }
  }
  return copy(input, "$", 0);
}
function object(value: Json, field: string, fields?: readonly string[]): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(field, "invalid_schema", "Expected a review object.");
  const result = value as JsonObject;
  if (fields && (Object.keys(result).length !== fields.length || fields.some((key) => !Object.hasOwn(result, key)))) invalid(field, "invalid_schema", "Provide exactly the v1 fields, including explicit nulls.");
  return result;
}
function string(value: Json, field: string, nonempty = false): void {
  if (typeof value !== "string" || (nonempty && !value.trim())) invalid(field, "invalid_schema", "Expected a review string with the required content.");
}
function choice(value: Json, field: string, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(field, "invalid_schema", "Unsupported review value.");
}
function uuid(value: Json, field: string): void {
  if (typeof value !== "string" || !uuidPattern.test(value)) invalid(field, "invalid_reference", "Use a canonical lowercase nonzero UUID reference.");
}
function count(value: Json, field: string, minimum = 0): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < minimum || value > 2_147_483_647) invalid(field, "invalid_number", "Use a bounded database integer.");
}
function confidence(value: Json, field: string): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) invalid(field, "invalid_number", "Confidence must be between zero and one.");
}
function timestamp(value: Json, field: string): void {
  if (typeof value !== "string") invalid(field, "invalid_timestamp", "Use a six-digit UTC timestamp string.");
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/u.exec(value);
  if (!match) invalid(field, "invalid_timestamp", "Use a six-digit UTC timestamp string.");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year! < 1 || month! < 1 || month! > 12 || day! < 1 || day! > days[month! - 1]!
    || hour! > 23 || minute! > 59 || second! > 59) invalid(field, "invalid_timestamp", "Timestamp is outside the finite Gregorian UTC range.");
}
function nullable(value: Json, field: string, check: (value: Json, field: string) => void): void { if (value !== null) check(value, field); }
function array(value: Json, field: string, limit: number, check: (value: Json, field: string) => void): void {
  if (!Array.isArray(value)) invalid(field, "invalid_schema", "Expected a review array.");
  if (value.length > limit) invalid(field, "limit_exceeded", "Review collection exceeds the v1 limit.");
  value.forEach((item, index) => check(item, `${field}.${index}`));
}
function rights(value: Json, field: string): void {
  const row = object(value, field, ["status", "owner", "licenseOwner", "sourceReference", "proofReference", "commercialUseAllowed", "derivativeUseAllowed", "worldwideUseAllowed", "permittedChannels", "permittedChannelConnectionIds", "permittedCampaignIds", "permittedBrandProfileIds", "validFromUtcMicros", "expiresAtUtcMicros", "attributionRequirement", "watermarkRequirement", "disclaimerRequirement", "reviewNote", "reviewedBy", "reviewedAtUtcMicros", "revision"]);
  choice(row.status, `${field}.status`, ["unchecked", "cleared", "restricted", "expired"]);
  for (const key of ["owner", "licenseOwner", "sourceReference", "proofReference", "attributionRequirement", "watermarkRequirement", "disclaimerRequirement", "reviewNote"]) nullable(row[key], `${field}.${key}`, string);
  for (const key of ["commercialUseAllowed", "derivativeUseAllowed", "worldwideUseAllowed"]) nullable(row[key], `${field}.${key}`, (item, path) => { if (typeof item !== "boolean") invalid(path, "invalid_schema", "Expected a nullable boolean."); });
  array(row.permittedChannels, `${field}.permittedChannels`, 20, (item, path) => string(item, path, true));
  const scopeFields = ["permittedChannelConnectionIds", "permittedCampaignIds", "permittedBrandProfileIds"];
  let scopeCount = 0;
  for (const key of scopeFields) {
    array(row[key], `${field}.${key}`, CONTENT_PACKAGE_REVIEW_LIMITS.scopeIdsPerAsset, uuid);
    scopeCount += (row[key] as readonly Json[]).length;
  }
  if (scopeCount > CONTENT_PACKAGE_REVIEW_LIMITS.scopeIdsPerAsset) invalid(field, "limit_exceeded", "Combined asset rights scopes exceed the v1 limit.");
  for (const key of ["validFromUtcMicros", "expiresAtUtcMicros", "reviewedAtUtcMicros"]) nullable(row[key], `${field}.${key}`, timestamp);
  nullable(row.reviewedBy, `${field}.reviewedBy`, uuid); count(row.revision, `${field}.revision`);
}
function asset(value: Json, field: string): void {
  const row = object(value, field, ["id", "sourceItemId", "sourceAssetId", "role", "fileName", "mimeType", "contentHash", "objectKey", "byteSizeDecimal", "processingVersion", "recipe", "mediaStatus", "extraction", "scan", "accessibility", "rights", "metadata", "createdAtUtcMicros"]);
  uuid(row.id, `${field}.id`);
  for (const key of ["sourceItemId", "sourceAssetId"]) nullable(row[key], `${field}.${key}`, uuid);
  choice(row.role, `${field}.role`, ["original", "supporting", "derivative"]);
  for (const key of ["fileName", "mimeType", "contentHash"]) string(row[key], `${field}.${key}`, true);
  for (const key of ["objectKey", "processingVersion"]) nullable(row[key], `${field}.${key}`, string);
  nullable(row.byteSizeDecimal, `${field}.byteSizeDecimal`, (item, path) => {
    if (typeof item !== "string" || !/^(0|[1-9][0-9]*)$/u.test(item) || item.length > 19 || (item.length === 19 && item > "9223372036854775807")) invalid(path, "invalid_number", "Byte size must be exact unsigned PostgreSQL bigint decimal text.");
  });
  object(row.recipe, `${field}.recipe`); object(row.metadata, `${field}.metadata`);
  choice(row.mediaStatus, `${field}.mediaStatus`, ["stored", "processed", "unsupported", "failed"]);
  const extraction = object(row.extraction, `${field}.extraction`, ["status", "text", "error"]);
  choice(extraction.status, `${field}.extraction.status`, ["pending", "completed", "skipped", "failed"]);
  for (const key of ["text", "error"]) nullable(extraction[key], `${field}.extraction.${key}`, string);
  const scan = object(row.scan, `${field}.scan`, ["status", "engine", "scannedAtUtcMicros", "revision"]);
  choice(scan.status, `${field}.scan.status`, ["clean", "infected", "not_configured", "failed"]);
  nullable(scan.engine, `${field}.scan.engine`, string); nullable(scan.scannedAtUtcMicros, `${field}.scan.scannedAtUtcMicros`, timestamp); count(scan.revision, `${field}.scan.revision`);
  const accessibility = object(row.accessibility, `${field}.accessibility`, ["altText", "status", "notes"]);
  choice(accessibility.status, `${field}.accessibility.status`, ["not_applicable", "needs_review", "approved", "decorative"]);
  for (const key of ["altText", "notes"]) nullable(accessibility[key], `${field}.accessibility.${key}`, string);
  rights(row.rights, `${field}.rights`); timestamp(row.createdAtUtcMicros, `${field}.createdAtUtcMicros`);
}
function validateSnapshot(value: Json): void {
  const root = object(value, "$", ["schemaVersion", "reviewContract", "package", "evidence", "conflicts", "assets"]);
  if (root.schemaVersion !== CONTENT_PACKAGE_REVIEW_VERSION) invalid("$.schemaVersion", "unsupported_version", "Unsupported package review snapshot version.");
  if (root.reviewContract !== CONTENT_PACKAGE_REVIEW_CONTRACT) invalid("$.reviewContract", "unsupported_contract", "Unsupported package review contract.");
  const pkg = object(root.package, "$.package", ["id", "workspaceId", "smartSourceId", "rootSourceItemId", "version", "title", "confidence", "contextPackVersionIds", "createdAtUtcMicros"]);
  for (const key of ["id", "workspaceId", "smartSourceId", "rootSourceItemId"]) uuid(pkg[key], `$.package.${key}`);
  count(pkg.version, "$.package.version", 1); string(pkg.title, "$.package.title", true); nullable(pkg.confidence, "$.package.confidence", confidence);
  array(pkg.contextPackVersionIds, "$.package.contextPackVersionIds", CONTENT_PACKAGE_REVIEW_LIMITS.contextPackVersions, uuid); timestamp(pkg.createdAtUtcMicros, "$.package.createdAtUtcMicros");
  array(root.evidence, "$.evidence", CONTENT_PACKAGE_REVIEW_LIMITS.evidenceItems, (value, field) => {
    const row = object(value, field, ["id", "factKey", "claim", "provenance", "sourceReferences", "confidence", "contextPackVersionId", "supersededByEvidenceId", "createdAtUtcMicros"]);
    uuid(row.id, `${field}.id`); nullable(row.factKey, `${field}.factKey`, (item, path) => string(item, path, true)); string(row.claim, `${field}.claim`, true);
    choice(row.provenance, `${field}.provenance`, ["observed", "authoritative_context", "inferred", "unresolved"]);
    array(row.sourceReferences, `${field}.sourceReferences`, CONTENT_PACKAGE_REVIEW_LIMITS.sourceReferencesPerEvidence, string);
    nullable(row.confidence, `${field}.confidence`, confidence);
    for (const key of ["contextPackVersionId", "supersededByEvidenceId"]) nullable(row[key], `${field}.${key}`, uuid);
    timestamp(row.createdAtUtcMicros, `${field}.createdAtUtcMicros`);
  });
  array(root.conflicts, "$.conflicts", CONTENT_PACKAGE_REVIEW_LIMITS.conflicts, (value, field) => {
    const row = object(value, field, ["id", "factKey", "candidateEvidenceIds", "status", "resolutionEvidenceId", "resolutionNote", "createdAtUtcMicros", "resolvedAtUtcMicros"]);
    uuid(row.id, `${field}.id`); string(row.factKey, `${field}.factKey`, true);
    array(row.candidateEvidenceIds, `${field}.candidateEvidenceIds`, CONTENT_PACKAGE_REVIEW_LIMITS.candidatesPerConflict, uuid);
    choice(row.status, `${field}.status`, ["open", "resolved", "dismissed"]);
    nullable(row.resolutionEvidenceId, `${field}.resolutionEvidenceId`, uuid); nullable(row.resolutionNote, `${field}.resolutionNote`, string);
    timestamp(row.createdAtUtcMicros, `${field}.createdAtUtcMicros`); nullable(row.resolvedAtUtcMicros, `${field}.resolvedAtUtcMicros`, timestamp);
  });
  array(root.assets, "$.assets", CONTENT_PACKAGE_REVIEW_LIMITS.assets, asset);
}
/** Validates raw structure, not conflict/asset eligibility, database scope, or human authority. */
export function validateContentPackageReviewSnapshot(input: unknown): ContentPackageReviewSnapshotV1 {
  const detached = detachedJson(input); validateSnapshot(detached);
  return detached as unknown as ContentPackageReviewSnapshotV1;
}
/** Direct sorted UTF-16 traversal prevents JSON.stringify from reordering numeric-looking keys. */
function canonicalJson(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value as JsonObject;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`).join(",")}}`;
}
/** Pure server-only byte contract: no Date/I/O, normalization, readiness decision or authorization. */
export function createContentPackageReviewFingerprint(input: unknown): ContentPackageReviewFingerprintResult {
  const snapshot = validateContentPackageReviewSnapshot(input);
  const canonicalSnapshot = canonicalJson(snapshot as unknown as Json);
  const token = CONTENT_PACKAGE_REVIEW_PREFIX + createHash("sha256").update(CONTENT_PACKAGE_REVIEW_DOMAIN, "utf8").update(canonicalSnapshot, "utf8").digest("hex");
  return Object.freeze({ token, canonicalSnapshot, snapshot });
}
