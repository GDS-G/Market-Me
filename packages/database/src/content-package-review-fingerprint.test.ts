import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  CONTENT_PACKAGE_REVIEW_CONTRACT, CONTENT_PACKAGE_REVIEW_DOMAIN, CONTENT_PACKAGE_REVIEW_LIMITS,
  CONTENT_PACKAGE_REVIEW_PREFIX, CONTENT_PACKAGE_REVIEW_VERSION, ContentPackageReviewFingerprintValidationError,
  createContentPackageReviewFingerprint, validateContentPackageReviewSnapshot,
} from "./content-package-review-fingerprint";

const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const stamp = "2026-09-09T12:34:56.123456Z";
function fixture(): Record<string, unknown> {
  return {
    schemaVersion: 1, reviewContract: CONTENT_PACKAGE_REVIEW_CONTRACT,
    package: { id: id(1), workspaceId: id(2), smartSourceId: id(3), rootSourceItemId: id(4), version: 1,
      title: "Review", confidence: 0.75, contextPackVersionIds: [id(5)], createdAtUtcMicros: stamp },
    evidence: [{ id: id(6), factKey: "date", claim: "September 9", provenance: "observed", sourceReferences: ["file:notes.txt"],
      confidence: 0.9, contextPackVersionId: null, supersededByEvidenceId: null, createdAtUtcMicros: stamp }],
    conflicts: [{ id: id(7), factKey: "date", candidateEvidenceIds: [id(6)], status: "resolved", resolutionEvidenceId: id(6),
      resolutionNote: "Reviewed", createdAtUtcMicros: stamp, resolvedAtUtcMicros: stamp }],
    assets: [{ id: id(8), sourceItemId: id(9), sourceAssetId: null, role: "original", fileName: "notes.txt", mimeType: "text/plain",
      contentHash: "sha256:abc", objectKey: "objects/notes.txt", byteSizeDecimal: "9007199254740993", processingVersion: "1",
      recipe: { kind: "text", options: ["raw"] }, mediaStatus: "stored", extraction: { status: "completed", text: "September 9", error: null },
      scan: { status: "not_configured", engine: null, scannedAtUtcMicros: null, revision: 0 },
      accessibility: { altText: null, status: "not_applicable", notes: null },
      rights: { status: "unchecked", owner: null, licenseOwner: null, sourceReference: null, proofReference: null,
        commercialUseAllowed: null, derivativeUseAllowed: null, worldwideUseAllowed: null, permittedChannels: [],
        permittedChannelConnectionIds: [], permittedCampaignIds: [], permittedBrandProfileIds: [],
        validFromUtcMicros: null, expiresAtUtcMicros: null, attributionRequirement: null, watermarkRequirement: null,
        disclaimerRequirement: null, reviewNote: null, reviewedBy: null, reviewedAtUtcMicros: null, revision: 0 },
      metadata: { raw_key: true }, createdAtUtcMicros: stamp }],
  };
}
function at(input: Record<string, unknown>, path: string): Record<string, unknown> {
  let target = input;
  for (const key of path.split(".")) target = target[key] as Record<string, unknown>;
  return target;
}
function set(input: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split("."); const last = keys.pop()!;
  (keys.length ? at(input, keys.join(".")) : input)[last] = value;
}
function reverseKeys(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(reverseKeys);
  if (input !== null && typeof input === "object") return Object.fromEntries(Object.entries(input).reverse().map(([key, value]) => [key, reverseKeys(value)]));
  return input;
}
function invalid(input: unknown, code?: string): void {
  try { createContentPackageReviewFingerprint(input); throw new Error("Expected invalid review"); }
  catch (error) {
    expect(error).toBeInstanceOf(ContentPackageReviewFingerprintValidationError);
    if (code) expect(error).toMatchObject({ issues: [{ code }] });
    expect(Object.isFrozen((error as ContentPackageReviewFingerprintValidationError).issues)).toBe(true);
  }
}

describe("content-package review v1 fingerprint", () => {
  it("freezes the separate domain and known complete-snapshot vector", () => {
    const result = createContentPackageReviewFingerprint(fixture());
    expect(result.token).toBe("mm-package-review-v1:sha256:57c7380bc15848b24b16c612b15003460acdb2906c9383db0c892987d888898e");
    expect(CONTENT_PACKAGE_REVIEW_VERSION).toBe(1);
    expect(CONTENT_PACKAGE_REVIEW_DOMAIN).toBe("market-me:content-package-review:v1\n");
    expect(CONTENT_PACKAGE_REVIEW_PREFIX).toBe("mm-package-review-v1:sha256:");
    expect(result.token).toBe(CONTENT_PACKAGE_REVIEW_PREFIX + createHash("sha256").update(Buffer.concat([
      Buffer.from("market-me:content-package-review:v1\n", "utf8"), Buffer.from(result.canonicalSnapshot, "utf8"),
    ])).digest("hex"));
    expect(JSON.parse(result.canonicalSnapshot)).toEqual(result.snapshot);
    expect(createContentPackageReviewFingerprint(reverseKeys(fixture()))).toEqual(result);
  });
  it("matches an independently written empty-collection canonical vector", () => {
    const input = fixture(); input.assets = []; input.evidence = []; input.conflicts = [];
    const canonical = '{"assets":[],"conflicts":[],"evidence":[],"package":{"confidence":0.75,"contextPackVersionIds":["00000005-0000-4000-8000-000000000000"],"createdAtUtcMicros":"2026-09-09T12:34:56.123456Z","id":"00000001-0000-4000-8000-000000000000","rootSourceItemId":"00000004-0000-4000-8000-000000000000","smartSourceId":"00000003-0000-4000-8000-000000000000","title":"Review","version":1,"workspaceId":"00000002-0000-4000-8000-000000000000"},"reviewContract":"content-package-review-v1","schemaVersion":1}';
    const result = createContentPackageReviewFingerprint(input);
    expect(result.canonicalSnapshot).toBe(canonical);
    expect(result.token).toBe("mm-package-review-v1:sha256:cc1f4ca449785066782896f02f9b8254471183aff2bcfa82d30b204f38584078");
    expect(result.token).toBe(CONTENT_PACKAGE_REVIEW_PREFIX + createHash("sha256").update(CONTENT_PACKAGE_REVIEW_DOMAIN + canonical).digest("hex"));
  });
  it("retains JCS numeric-looking/UTF-16 key order, primitives and exact Unicode", () => {
    const input = fixture();
    set(input, "assets.0.metadata", { "2": "two", "10": "ten", "\uE000": "private", "😀": "emoji", a: "\b\t\n\f\r\"\\/",
      numbers: [333333333.33333329, 1e30, 4.5, 0.002, 1e-27, -0, 5e-324, Number.MAX_VALUE], literals: [true, false, null] });
    const expected = '{"10":"ten","2":"two","a":"\\b\\t\\n\\f\\r\\\"\\\\/","literals":[true,false,null],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0,5e-324,1.7976931348623157e+308],"😀":"emoji","\uE000":"private"}';
    expect(createContentPackageReviewFingerprint(input).canonicalSnapshot).toContain(`"metadata":${expected}`);
    const composed = fixture(); set(composed, "package.title", "Café");
    const decomposed = fixture(); set(decomposed, "package.title", "Cafe\u0301");
    expect(createContentPackageReviewFingerprint(composed).token).not.toBe(createContentPackageReviewFingerprint(decomposed).token);
  });
  const mutations: [string, unknown][] = [
    ...["id", "workspaceId", "smartSourceId", "rootSourceItemId"].map((key): [string, unknown] => [`package.${key}`, id(90)]),
    ["package.version", 2], ["package.title", " Review "], ["package.confidence", null], ["package.contextPackVersionIds", [id(90)]], ["package.createdAtUtcMicros", "2026-09-09T12:34:56.123457Z"],
    ["evidence.0.id", id(90)], ["evidence.0.factKey", null], ["evidence.0.claim", "Different"], ["evidence.0.provenance", "inferred"],
    ["evidence.0.sourceReferences", ["other"]], ["evidence.0.confidence", null], ["evidence.0.contextPackVersionId", id(90)], ["evidence.0.supersededByEvidenceId", id(90)], ["evidence.0.createdAtUtcMicros", "2026-09-09T12:34:56.123457Z"],
    ["conflicts.0.id", id(90)], ["conflicts.0.factKey", "other"], ["conflicts.0.candidateEvidenceIds", [id(90)]], ["conflicts.0.status", "open"],
    ["conflicts.0.resolutionEvidenceId", null], ["conflicts.0.resolutionNote", null], ["conflicts.0.createdAtUtcMicros", "2026-09-09T12:34:56.123457Z"], ["conflicts.0.resolvedAtUtcMicros", null],
    ["assets.0.id", id(90)], ["assets.0.sourceItemId", null], ["assets.0.sourceAssetId", id(90)], ["assets.0.role", "derivative"],
    ["assets.0.fileName", "other.txt"], ["assets.0.mimeType", "other/type"], ["assets.0.contentHash", "other"], ["assets.0.objectKey", null],
    ["assets.0.byteSizeDecimal", "9007199254740994"], ["assets.0.processingVersion", null], ["assets.0.recipe", { kind: "other" }], ["assets.0.mediaStatus", "failed"],
    ["assets.0.extraction.status", "failed"], ["assets.0.extraction.text", null], ["assets.0.extraction.error", "Error"],
    ["assets.0.scan.status", "clean"], ["assets.0.scan.engine", "scanner"], ["assets.0.scan.scannedAtUtcMicros", stamp], ["assets.0.scan.revision", 1],
    ["assets.0.accessibility.altText", "Alt"], ["assets.0.accessibility.status", "approved"], ["assets.0.accessibility.notes", "Notes"],
    ["assets.0.rights.status", "cleared"],
    ...["owner", "licenseOwner", "sourceReference", "proofReference", "attributionRequirement", "watermarkRequirement", "disclaimerRequirement", "reviewNote"].map((key): [string, unknown] => [`assets.0.rights.${key}`, "raw value"]),
    ...["commercialUseAllowed", "derivativeUseAllowed", "worldwideUseAllowed"].map((key): [string, unknown] => [`assets.0.rights.${key}`, true]),
    ["assets.0.rights.permittedChannels", ["discord_webhook"]],
    ...["permittedChannelConnectionIds", "permittedCampaignIds", "permittedBrandProfileIds"].map((key): [string, unknown] => [`assets.0.rights.${key}`, [id(90)]]),
    ...["validFromUtcMicros", "expiresAtUtcMicros", "reviewedAtUtcMicros"].map((key): [string, unknown] => [`assets.0.rights.${key}`, stamp]),
    ["assets.0.rights.reviewedBy", id(90)], ["assets.0.rights.revision", 1], ["assets.0.metadata", { rawKey: true }], ["assets.0.createdAtUtcMicros", "2026-09-09T12:34:56.123457Z"],
  ];
  it.each(mutations)("binds exact review field %s", (path, value) => {
    const original = fixture(); const changed = fixture(); set(changed, path, value);
    expect(createContentPackageReviewFingerprint(changed).token).not.toBe(createContentPackageReviewFingerprint(original).token);
  });
  it("preserves arrays and raw dictionaries without interpretation or input mutation", () => {
    const input = fixture(); set(input, "evidence.0.sourceReferences", ["a", "b"]);
    const before = JSON.stringify(input); const result = createContentPackageReviewFingerprint(input);
    expect(JSON.stringify(input)).toBe(before);
    set(input, "evidence.0.sourceReferences", ["b", "a"]);
    expect(createContentPackageReviewFingerprint(input).token).not.toBe(result.token);
    expect(result.snapshot.evidence[0]!.sourceReferences).toEqual(["a", "b"]);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.snapshot.assets[0]!.rights)).toBe(true);
    expect(Object.isFrozen(result.snapshot.evidence[0]!.sourceReferences)).toBe(true);
    expect(() => (result.snapshot.assets[0]!.metadata as Record<string, unknown>).changed = true).toThrow();
  });
  it("retains own __proto__ safely and copies repeated ordinary references independently", () => {
    const input = fixture(); const metadata = JSON.parse('{"__proto__":{"safe":true},"constructor":"raw"}') as unknown;
    set(input, "assets.0.metadata", metadata); set(input, "assets.0.recipe", metadata);
    const result = createContentPackageReviewFingerprint(input);
    expect(Object.getPrototypeOf(result.snapshot.assets[0]!.metadata)).toBe(Object.prototype);
    expect(Object.hasOwn(result.snapshot.assets[0]!.metadata, "__proto__")).toBe(true);
    expect(result.snapshot.assets[0]!.metadata).not.toBe(result.snapshot.assets[0]!.recipe);
    expect(({} as Record<string, unknown>).safe).toBeUndefined();
  });
  it.each([undefined, () => 1, Symbol("bad"), 1n, new Date(), new Map(), new Set(), /x/u, Object.create(null)])("rejects non-JSON input %s", (value) => {
    const input = fixture(); set(input, "assets.0.metadata.bad", value); invalid(input, "invalid_json");
  });
  it.each([NaN, Infinity, -Infinity])("rejects nonfinite raw number %s", (value) => { const input = fixture(); set(input, "assets.0.metadata.bad", value); invalid(input, "invalid_number"); });
  it.each(["\uD800", "\uDC00", "a\uD800b"])("rejects unpaired Unicode %s", (value) => { const input = fixture(); set(input, "package.title", value); invalid(input, "invalid_json"); });
  it("rejects unpaired Unicode keys", () => { const input = fixture(); set(input, "assets.0.metadata", { "\uD800": true }); invalid(input, "invalid_json"); });
  it("rejects getters, toJSON, proxies and revoked proxies without invoking code", () => {
    const getter = vi.fn(() => { throw new Error("getter must not execute"); });
    const input = fixture(); Object.defineProperty(at(input, "package"), "title", { get: getter, enumerable: true }); invalid(input, "invalid_json");
    const toJSON = vi.fn(() => ({})); const second = fixture(); set(second, "assets.0.metadata", { toJSON }); invalid(second, "invalid_json");
    const trap = vi.fn(() => { throw new Error("proxy must not execute"); }); invalid(new Proxy({}, { ownKeys: trap, getPrototypeOf: trap }), "invalid_json");
    const revoked = Proxy.revocable({}, {}); revoked.revoke(); invalid(revoked.proxy, "invalid_json");
    expect(getter).not.toHaveBeenCalled(); expect(toJSON).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled();
  });
  it("rejects sparse arrays, extra/hidden/symbol properties, custom prototypes and cycles", () => {
    const cases: unknown[] = [new Array(2), Object.assign([], { extra: true }), Object.create({ inherited: true }), Object.defineProperty({}, "hidden", { value: 1 }), { [Symbol("x")]: 1 }];
    const cycle: unknown[] = []; cycle.push(cycle); cases.push(cycle);
    const accessor: unknown[] = [0]; Object.defineProperty(accessor, "0", { get: () => { throw new Error("must not run"); }, enumerable: true }); cases.push(accessor);
    for (const value of cases) { const input = fixture(); set(input, "assets.0.metadata.bad", value); invalid(input, "invalid_json"); }
  });
  const invalidFields: [string, unknown, string][] = [
    ["schemaVersion", 2, "unsupported_version"], ["reviewContract", "other", "unsupported_contract"],
    ["package.version", 0, "invalid_number"], ["package.version", 2_147_483_648, "invalid_number"], ["package.version", "1", "invalid_number"],
    ["package.confidence", 1.01, "invalid_number"], ["evidence.0.confidence", -0.1, "invalid_number"],
    ["package.title", " ", "invalid_schema"], ["evidence.0.factKey", "", "invalid_schema"], ["assets.0.fileName", "", "invalid_schema"],
    ["package.id", "00000000-0000-0000-0000-000000000000", "invalid_reference"], ["package.id", id(10).toUpperCase(), "invalid_reference"],
    ["assets.0.byteSizeDecimal", 123, "invalid_number"], ["assets.0.byteSizeDecimal", "00", "invalid_number"], ["assets.0.byteSizeDecimal", "1e3", "invalid_number"],
    ["assets.0.byteSizeDecimal", "-1", "invalid_number"], ["assets.0.byteSizeDecimal", "9223372036854775808", "invalid_number"],
    ["assets.0.rights.commercialUseAllowed", "true", "invalid_schema"], ["assets.0.scan.revision", -1, "invalid_number"], ["assets.0.rights.revision", 0.5, "invalid_number"],
    ["assets.0.recipe", [], "invalid_schema"], ["assets.0.metadata", null, "invalid_schema"], ["assets.0.scan.status", "pending", "invalid_schema"],
    ["assets.0.role", "attachment", "invalid_schema"], ["evidence.0.provenance", "trusted", "invalid_schema"], ["conflicts.0.status", "approved", "invalid_schema"],
  ];
  it.each(invalidFields)("rejects invalid field %s=%s", (path, value, code) => { const input = fixture(); set(input, path, value); invalid(input, code); });
  it.each(["2026-09-09T12:34:56.123Z", "2026-09-09T12:34:56.123456+00:00", "0000-01-01T00:00:00.000000Z", "2026-02-29T00:00:00.000000Z", "1900-02-29T00:00:00.000000Z", "2026-13-01T00:00:00.000000Z", "2026-01-00T00:00:00.000000Z", "2026-01-01T24:00:00.000000Z", "2026-01-01T00:60:00.000000Z", "2026-01-01T00:00:60.000000Z", "infinity"])("rejects invalid timestamp %s", (value) => {
    const input = fixture(); set(input, "package.createdAtUtcMicros", value); invalid(input, "invalid_timestamp");
  });
  it.each(["0001-01-01T00:00:00.000000Z", "2000-02-29T23:59:59.999999Z", "9999-12-31T23:59:59.999999Z"])("retains valid timestamp without Date precision loss %s", (value) => {
    const input = fixture(); set(input, "package.createdAtUtcMicros", value); expect(validateContentPackageReviewSnapshot(input).package.createdAtUtcMicros).toBe(value);
  });
  it("requires every field and rejects authority/status additions at any typed level", () => {
    for (const path of ["", "package", "evidence.0", "conflicts.0", "assets.0", "assets.0.rights", "assets.0.scan", "assets.0.extraction", "assets.0.accessibility"]) {
      const input = fixture(); (path ? at(input, path) : input).approved = true; invalid(input, "invalid_schema");
      const missing = fixture(); const row = path ? at(missing, path) : missing; delete row[Object.keys(row)[0]!]; invalid(missing, "invalid_schema");
    }
  });
  it("accepts exact bigint bounds and explicit nullable optional values", () => {
    for (const value of [null, "0", "9223372036854775807"]) { const input = fixture(); set(input, "assets.0.byteSizeDecimal", value); expect(validateContentPackageReviewSnapshot(input).assets[0]!.byteSizeDecimal).toBe(value); }
  });
  it("bounds the combined three rights-scope collections per asset", () => {
    const input = fixture();
    for (const key of ["permittedChannelConnectionIds", "permittedCampaignIds", "permittedBrandProfileIds"]) set(input, `assets.0.rights.${key}`, new Array(3_334).fill(id(90)));
    invalid(input, "limit_exceeded");
  });
  it("enforces string, escaped byte, depth and node limits", () => {
    const long = fixture(); set(long, "package.title", "a".repeat(CONTENT_PACKAGE_REVIEW_LIMITS.stringCodeUnits + 1)); invalid(long, "limit_exceeded");
    const escaped = fixture(); set(escaped, "assets.0.metadata", { a: "\0".repeat(800_000), b: "\0".repeat(800_000) }); invalid(escaped, "limit_exceeded");
    let nested: unknown = null; for (let n = 0; n <= CONTENT_PACKAGE_REVIEW_LIMITS.depth; n += 1) nested = [nested];
    const deep = fixture(); set(deep, "assets.0.metadata.nested", nested); invalid(deep, "limit_exceeded");
    const many = fixture(); set(many, "assets.0.metadata.many", new Array(CONTENT_PACKAGE_REVIEW_LIMITS.nodes).fill(null)); invalid(many, "limit_exceeded");
    expect(Object.isFrozen(CONTENT_PACKAGE_REVIEW_LIMITS)).toBe(true);
  });
  it.each([
    ["evidence", CONTENT_PACKAGE_REVIEW_LIMITS.evidenceItems, "evidence.0"], ["conflicts", CONTENT_PACKAGE_REVIEW_LIMITS.conflicts, "conflicts.0"],
    ["assets", CONTENT_PACKAGE_REVIEW_LIMITS.assets, "assets.0"], ["package.contextPackVersionIds", CONTENT_PACKAGE_REVIEW_LIMITS.contextPackVersions, null],
    ["conflicts.0.candidateEvidenceIds", CONTENT_PACKAGE_REVIEW_LIMITS.candidatesPerConflict, null],
    ["evidence.0.sourceReferences", CONTENT_PACKAGE_REVIEW_LIMITS.sourceReferencesPerEvidence, null],
    ["assets.0.rights.permittedCampaignIds", CONTENT_PACKAGE_REVIEW_LIMITS.scopeIdsPerAsset, null], ["assets.0.rights.permittedChannels", 20, null],
  ] as const)("bounds collection %s", (path, maximum, rowPath) => {
    const input = fixture(); set(input, path, new Array(maximum + 1).fill(rowPath ? at(input, rowPath) : id(99))); invalid(input, "limit_exceeded");
  });
});
