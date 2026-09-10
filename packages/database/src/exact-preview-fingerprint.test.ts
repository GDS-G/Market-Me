import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createExactPreviewFingerprint,
  EXACT_PREVIEW_FINGERPRINT_DOMAIN,
  EXACT_PREVIEW_FINGERPRINT_LIMITS,
  EXACT_PREVIEW_FINGERPRINT_PREFIX,
  EXACT_PREVIEW_RENDERER_CONTRACT,
  ExactPreviewFingerprintValidationError,
} from "./exact-preview-fingerprint";

const id = (number: number) => `${number.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const stamp = "2026-09-09T12:34:56.123456Z";
function fixture(): Record<string, unknown> {
  return {
    schemaVersion: 1, rendererContract: EXACT_PREVIEW_RENDERER_CONTRACT,
    lineage: { workspaceId: id(1), campaignId: id(2), sourceCampaignVersionId: id(3), generationId: id(4),
      previewId: id(5), contentDraftId: id(6), contentDraftVersionId: id(7) },
    preview: { provider: "discord_webhook", channelConnectionId: id(8), destinationId: id(9), linkMode: "tracked", status: "ready",
      renderedSubject: null, renderedContent: "Hello", subjectCount: null, subjectLimit: null, characterCount: 5, characterLimit: 2000,
      validationIssues: [], capabilityVersion: "2026-08-05", capabilityObservedAtUtcMicros: stamp,
      capabilitySnapshot: { limits: { contentCharacters: 2000 }, provider: "discord_webhook", supportedActions: { publish_content: true } },
      createdBy: id(11), createdAtUtcMicros: stamp, assets: [] },
    connection: { id: id(8), workspaceId: id(1), provider: "discord_webhook", status: "active",
      identity: { webhookId: "webhook-1", channelId: "channel-1", guildId: null } },
    destination: { id: id(9), workspaceId: id(1), provider: "manual", status: "published", canonicalUrl: "https://example.test/event" },
    trackedLink: { id: id(10), workspaceId: id(1), destinationId: id(9), draftChannelPreviewId: id(5), campaignInstanceId: null,
      campaignStepRunId: null, slug: "abcdefgh", canonicalUrl: "https://example.test/event", utmParameters: { utm_source: "discord", utm_campaign: id(2) },
      status: "active", expiresAtUtcMicros: stamp, publicRedirectUrl: "https://market.example.test/r/abcdefgh" },
  };
}
function record(input: Record<string, unknown>, key: string): Record<string, unknown> {
  return input[key] as Record<string, unknown>;
}
function set(input: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let target = input;
  for (const key of keys.slice(0, -1)) target = record(target, key);
  target[keys.at(-1)!] = value;
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  return value;
}
function expectInvalid(value: unknown, code?: string) {
  try { createExactPreviewFingerprint(value); throw new Error("Expected invalid snapshot"); }
  catch (error) {
    expect(error).toBeInstanceOf(ExactPreviewFingerprintValidationError);
    if (code) expect(error).toMatchObject({ issues: [{ code }] });
  }
}

describe("exact-preview v1 pure fingerprint", () => {
  it("uses the fixed domain-separated SHA-256 byte contract", () => {
    const result = createExactPreviewFingerprint(fixture());
    expect(result.token).toBe("mm-preview-v1:sha256:52011054e9673f31b78c824e8add429044b27541d9438dfa417e4ec9f6c78789");
    expect(EXACT_PREVIEW_FINGERPRINT_DOMAIN).toBe("market-me:exact-preview:v1\n");
    expect(EXACT_PREVIEW_FINGERPRINT_PREFIX).toBe("mm-preview-v1:sha256:");
    expect(result.token).toBe(EXACT_PREVIEW_FINGERPRINT_PREFIX + createHash("sha256")
      .update(Buffer.concat([Buffer.from("market-me:exact-preview:v1\n", "utf8"), Buffer.from(result.canonicalSnapshot, "utf8")])).digest("hex"));
    expect(result.token).toMatch(/^mm-preview-v1:sha256:[0-9a-f]{64}$/u);
    expect(JSON.parse(result.canonicalSnapshot)).toEqual(result.snapshot);
    expect(createExactPreviewFingerprint(reverseKeys(fixture()))).toEqual(result);
  });

  it("matches fixed JCS primitive and UTF-16/numeric-looking property ordering vectors", () => {
    const input = fixture();
    record(input, "preview").capabilitySnapshot = {
      "2": "two", "10": "ten", "\uE000": "private", "😀": "emoji", "a": "\b\t\n\f\r\"\\/",
      "numbers": [333333333.33333329, 1e30, 4.5, 0.002, 1e-27, -0, 5e-324, Number.MAX_VALUE],
      "literals": [true, false, null],
    };
    const expected = '{"10":"ten","2":"two","a":"\\b\\t\\n\\f\\r\\\"\\\\/","literals":[true,false,null],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27,0,5e-324,1.7976931348623157e+308],"😀":"emoji","\uE000":"private"}';
    expect(createExactPreviewFingerprint(input).canonicalSnapshot).toContain(`"capabilitySnapshot":${expected}`);
  });

  it("preserves raw action keys, unknown raw fields and array ordering without Unicode/URL/whitespace normalization", () => {
    const base = createExactPreviewFingerprint(fixture());
    for (const [path, value] of [
      ["preview.capabilitySnapshot.supportedActions", { publishContent: true }],
      ["preview.capabilitySnapshot.extra", { retained: ["a", "b"] }],
      ["preview.renderedContent", " Hello\r\n"],
      ["destination.canonicalUrl", "https://EXAMPLE.test/event"],
    ] as const) {
      const input = fixture(); set(input, path, value);
      expect(createExactPreviewFingerprint(input).token).not.toBe(base.token);
    }
    const one = fixture(); set(one, "preview.renderedContent", "Café");
    const two = fixture(); set(two, "preview.renderedContent", "Cafe\u0301");
    expect(createExactPreviewFingerprint(one).token).not.toBe(createExactPreviewFingerprint(two).token);
    set(one, "preview.capabilitySnapshot.ordered", ["a", "b"]);
    set(two, "preview.renderedContent", "Café"); set(two, "preview.capabilitySnapshot.ordered", ["b", "a"]);
    expect(createExactPreviewFingerprint(one).token).not.toBe(createExactPreviewFingerprint(two).token);
  });

  const mutations: [string, unknown][] = [
    ...["workspaceId", "campaignId", "sourceCampaignVersionId", "generationId", "previewId", "contentDraftId", "contentDraftVersionId"].map((key): [string, unknown] => [`lineage.${key}`, id(90)]),
    ["preview.provider", "slack_webhook"], ["preview.channelConnectionId", id(90)], ["preview.destinationId", null],
    ["preview.linkMode", "canonical"], ["preview.status", "blocked"], ["preview.renderedSubject", "Subject"],
    ["preview.renderedContent", "Changed"], ["preview.subjectCount", 7], ["preview.subjectLimit", 150],
    ["preview.characterCount", 6], ["preview.characterLimit", 1999], ["preview.validationIssues", [{ code: "changed", message: "Changed" }]],
    ["preview.capabilityVersion", "next"], ["preview.capabilityObservedAtUtcMicros", "2026-09-09T12:34:56.123457Z"],
    ["preview.capabilitySnapshot.limits.contentCharacters", 1999], ["preview.createdBy", id(90)],
    ["preview.createdAtUtcMicros", "2026-09-09T12:34:56.123457Z"],
    ["connection.id", id(90)], ["connection.workspaceId", id(90)], ["connection.status", "error"],
    ["connection.identity.webhookId", "webhook-2"], ["connection.identity.channelId", "channel-2"], ["connection.identity.guildId", "guild-1"],
    ["destination", null], ["destination.id", id(90)], ["destination.workspaceId", id(90)], ["destination.provider", "other"],
    ["destination.status", "archived"], ["destination.canonicalUrl", "https://example.test/changed"],
    ["trackedLink", null], ["trackedLink.id", id(90)], ["trackedLink.workspaceId", id(90)], ["trackedLink.destinationId", id(90)],
    ["trackedLink.draftChannelPreviewId", id(90)], ["trackedLink.campaignInstanceId", id(90)], ["trackedLink.campaignStepRunId", id(90)],
    ["trackedLink.slug", "changed1"], ["trackedLink.canonicalUrl", "https://example.test/changed"], ["trackedLink.utmParameters.utm_source", "changed"],
    ["trackedLink.status", "disabled"], ["trackedLink.expiresAtUtcMicros", null], ["trackedLink.publicRedirectUrl", "https://other.example.test/r/abcdefgh"],
  ];
  it.each(mutations)("binds the exact included field %s", (path, value) => {
    const input = fixture(); set(input, path, value);
    expect(createExactPreviewFingerprint(input).token).not.toBe(createExactPreviewFingerprint(fixture()).token);
  });

  it.each([
    ["discord_webhook", { webhookId: "webhook", channelId: "channel", guildId: null }],
    ["slack_webhook", { teamId: "team", serviceId: "service", host: "hooks.slack.com" }],
    ["mastodon_account", { accountId: "account", instanceOrigin: "https://social.example.test", host: "social.example.test" }],
  ] as const)("accepts exact %s identity shape without establishing readiness", (provider, identity) => {
    const input = fixture();
    Object.assign(record(input, "connection"), { provider, identity, status: "revoked" });
    Object.assign(record(input, "preview"), { provider, status: "blocked" });
    const result = createExactPreviewFingerprint(input);
    expect(result.snapshot.connection).toMatchObject({ provider, identity, status: "revoked" });
    expect(result.snapshot.preview.status).toBe("blocked");
  });

  it("supports explicit null routing and no subject/count/limit without inventing defaults", () => {
    const input = fixture(); input.destination = null; input.trackedLink = null;
    Object.assign(record(input, "preview"), { destinationId: null, linkMode: "canonical", characterLimit: null });
    expect(createExactPreviewFingerprint(input).snapshot).toMatchObject({ destination: null, trackedLink: null,
      preview: { renderedSubject: null, subjectCount: null, subjectLimit: null, characterLimit: null } });
  });

  it("detaches and deeply freezes every returned object without mutating or freezing callers", () => {
    const input = fixture(); const before = structuredClone(input);
    const result = createExactPreviewFingerprint(input);
    expect(input).toEqual(before);
    expect(Object.isFrozen(input)).toBe(false);
    const visit = (value: unknown) => {
      if (value && typeof value === "object") { expect(Object.isFrozen(value)).toBe(true); Object.values(value).forEach(visit); }
    };
    visit(result);
    expect(result.snapshot.preview).not.toBe(input.preview);
    set(input, "preview.capabilitySnapshot.limits.contentCharacters", 1);
    expect(result.snapshot.preview.capabilitySnapshot).toMatchObject({ limits: { contentCharacters: 2000 } });
    expect(() => { (result.snapshot.preview as unknown as Record<string, unknown>).renderedContent = "mutation"; }).toThrow();
  });

  it("permits repeated noncyclic references but returns separately detached immutable values", () => {
    const input = fixture(); const shared = { retained: true };
    set(input, "preview.capabilitySnapshot", { first: shared, second: shared });
    const result = createExactPreviewFingerprint(input);
    expect(result.snapshot.preview.capabilitySnapshot.first).toEqual(shared);
    expect(result.snapshot.preview.capabilitySnapshot.first).not.toBe(shared);
    expect(result.snapshot.preview.capabilitySnapshot.first).not.toBe(result.snapshot.preview.capabilitySnapshot.second);
  });

  it.each(["schemaVersion", "rendererContract", "destination", "trackedLink", "preview.assets", "preview.subjectCount", "connection.identity.guildId"])("requires the explicit v1 field %s", (path) => {
    const input = fixture(); const keys = path.split("."); let target = input;
    for (const key of keys.slice(0, -1)) target = record(target, key);
    delete target[keys.at(-1)!]; expectInvalid(input, "invalid_schema");
  });

  it.each([
    ["schemaVersion", 2, "unsupported_version"], ["schemaVersion", "1", "unsupported_version"],
    ["rendererContract", "next", "unsupported_renderer"], ["connection.provider", "mailchimp_email", "invalid_schema"],
    ["preview.provider", "manual", "invalid_schema"], ["connection.identity", { webhookId: "x", channelId: "y" }, "invalid_schema"],
    ["connection.identity.channelId", " ", "invalid_schema"], ["preview.assets", [{ contentAssetId: id(1) }], "invalid_schema"],
    ["preview.characterCount", -1, "invalid_number"], ["preview.characterCount", 0.5, "invalid_number"],
    ["preview.characterCount", "5", "invalid_number"], ["preview.characterCount", 2_147_483_648, "invalid_number"],
    ["preview.characterLimit", 0, "invalid_number"], ["preview.subjectLimit", -1, "invalid_number"],
    ["preview.validationIssues", [{ code: "x", message: "y", extra: true }], "invalid_schema"],
    ["trackedLink.utmParameters", { utm_source: 123 }, "invalid_schema"],
    ["trackedLink.slug", "short", "invalid_schema"], ["trackedLink.slug", "a".repeat(65), "invalid_schema"],
    ["destination.canonicalUrl", "", "invalid_url"], ["destination.canonicalUrl", "https://a.test/ path", "invalid_url"],
    ["destination.canonicalUrl", "javascript:alert(1)", "invalid_url"], ["destination.canonicalUrl", "https://user:pass@example.test", "invalid_url"],
  ] as const)("rejects invalid schema value %s = %s", (path, value, code) => {
    const input = fixture(); set(input, path, value); expectInvalid(input, code);
  });

  it.each(["", id(1).toUpperCase().replace("00000001", "AAAAAAAA"), ` ${id(1)}`, "00000000-0000-0000-0000-000000000000", "not-an-id"])("rejects a noncanonical reference %s", (value) => {
    const input = fixture(); set(input, "lineage.workspaceId", value); expectInvalid(input, "invalid_reference");
  });

  it.each(["2026-09-09T12:34:56.123Z", "2026-09-09T12:34:56.123456+00:00", "2026-09-09 12:34:56.123456Z", "infinity",
    "0000-01-01T00:00:00.000000Z", "1900-02-29T00:00:00.000000Z", "2026-02-29T00:00:00.000000Z", "2026-04-31T00:00:00.000000Z",
    "2026-00-01T00:00:00.000000Z", "2026-13-01T00:00:00.000000Z", "2026-01-00T00:00:00.000000Z", "2026-01-01T24:00:00.000000Z",
    "2026-01-01T00:60:00.000000Z", "2026-01-01T00:00:60.000000Z"])("rejects an imprecise/nonfinite/invalid UTC timestamp %s", (value) => {
    const input = fixture(); set(input, "preview.capabilityObservedAtUtcMicros", value); expectInvalid(input, "invalid_timestamp");
  });

  it.each(["0001-01-01T00:00:00.000000Z", "2000-02-29T23:59:59.999999Z", "2024-02-29T00:00:00.000001Z", "9999-12-31T23:59:59.999999Z"])("preserves exact valid Gregorian microseconds %s", (value) => {
    const input = fixture(); set(input, "preview.capabilityObservedAtUtcMicros", value);
    expect(createExactPreviewFingerprint(input).snapshot.preview.capabilityObservedAtUtcMicros).toBe(value);
  });

  it.each(["preview.createdAtUtcMicros", "trackedLink.expiresAtUtcMicros"])("also enforces exact timestamp shape for %s", (path) => {
    const input = fixture(); set(input, path, "2026-09-09T12:34:56.123Z"); expectInvalid(input, "invalid_timestamp");
  });

  it("rejects unknown authority and incidental display/health properties instead of silently excluding them", () => {
    for (const path of ["autonomyMode", "preview.approvalGranted", "connection.updatedAt", "connection.encryptedCredentials", "destination.title"]) {
      const input = fixture(); set(input, path, "untrusted"); expectInvalid(input, "invalid_schema");
    }
  });

  it("never invokes getters, inherited getters, toJSON, or proxy traps", () => {
    const getter = vi.fn(() => "secret");
    const own = fixture(); Object.defineProperty(own, "destination", { get: getter, enumerable: true }); expectInvalid(own);
    const nested = fixture(); Object.defineProperty(record(nested, "preview"), "renderedContent", { get: getter, enumerable: true }); expectInvalid(nested);
    const inherited = Object.create({ get destination() { return getter(); } }); expectInvalid(inherited);
    const withToJson = fixture(); set(withToJson, "preview.capabilitySnapshot.toJSON", getter); expectInvalid(withToJson);
    const trapped = new Proxy(fixture(), { getPrototypeOf: () => { getter(); return Object.prototype; }, ownKeys: () => { getter(); return []; } }); expectInvalid(trapped);
    expect(getter).not.toHaveBeenCalled();
  });

  it("rejects symbols, hidden fields, sparse/custom/accessor arrays, and cycles", () => {
    const symbol = fixture(); Object.defineProperty(symbol, Symbol("hidden"), { value: true }); expectInvalid(symbol);
    const hidden = fixture(); Object.defineProperty(hidden, "hidden", { value: true }); expectInvalid(hidden);
    for (const array of [Array(2), Object.assign([1], { extra: true }), Object.assign([1], { "01": true })]) {
      const input = fixture(); set(input, "preview.capabilitySnapshot.array", array); expectInvalid(input);
    }
    const getter = vi.fn(() => 1); const array = [1]; Object.defineProperty(array, "0", { get: getter, enumerable: true });
    const input = fixture(); set(input, "preview.capabilitySnapshot.array", array); expectInvalid(input); expect(getter).not.toHaveBeenCalled();
    const cyclic = fixture(); set(cyclic, "preview.capabilitySnapshot.cycle", cyclic); expectInvalid(cyclic);
  });

  it.each([undefined, NaN, Infinity, -Infinity, 1n, () => null, new Date(), new Map(), new Set(), /x/u, new Uint8Array(1), Object.create(null)])("rejects non-JSON raw value %#", (value) => {
    const input = fixture(); set(input, "preview.capabilitySnapshot.raw", value); expectInvalid(input);
  });

  it.each(["\ud800", "\udfff", "a\ud800b", "\ud800\ud800", "\udc00\ud800"])("rejects unpaired Unicode in data or raw keys %#", (value) => {
    const input = fixture(); set(input, "preview.renderedContent", value); expectInvalid(input, "invalid_json");
    const keyInput = fixture(); set(keyInput, "preview.capabilitySnapshot", { [value]: "x" }); expectInvalid(keyInput, "invalid_json");
  });

  it("retains __proto__/constructor raw data without mutating prototypes", () => {
    const input = fixture(); set(input, "preview.capabilitySnapshot", JSON.parse('{"__proto__":{"safe":true},"constructor":"data","toJSON":"data"}'));
    const result = createExactPreviewFingerprint(input);
    expect(result.canonicalSnapshot).toContain('"capabilitySnapshot":{"__proto__":{"safe":true},"constructor":"data","toJSON":"data"}');
    expect(Object.getPrototypeOf(result.snapshot.preview.capabilitySnapshot)).toBe(Object.prototype);
    expect(Object.hasOwn(Object.prototype, "safe")).toBe(false);
  });

  it("bounds UTF-16 string length, escaped UTF-8 output bytes, nodes and depth before returning a hash", () => {
    const stringInput = fixture(); set(stringInput, "preview.renderedContent", "a".repeat(EXACT_PREVIEW_FINGERPRINT_LIMITS.stringCodeUnits + 1)); expectInvalid(stringInput, "limit_exceeded");
    const byteInput = fixture(); set(byteInput, "preview.renderedContent", "\u0000".repeat(200_000)); expectInvalid(byteInput, "limit_exceeded");
    const nodeInput = fixture(); set(nodeInput, "preview.capabilitySnapshot.nodes", Array.from({ length: EXACT_PREVIEW_FINGERPRINT_LIMITS.nodes }, () => 0)); expectInvalid(nodeInput, "limit_exceeded");
    let nested: unknown = 0; for (let index = 0; index < EXACT_PREVIEW_FINGERPRINT_LIMITS.depth; index += 1) nested = { nested };
    const depthInput = fixture(); set(depthInput, "preview.capabilitySnapshot.nested", nested); expectInvalid(depthInput, "limit_exceeded");
    expect(Object.isFrozen(EXACT_PREVIEW_FINGERPRINT_LIMITS)).toBe(true);
  });
});
