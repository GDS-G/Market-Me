import { describe, expect, it } from "vitest";
import {
  createPairingCode,
  normalizePairingCode,
  signCompanionJob,
  validateCompanionServerUrl,
  validateCompanionTargetUrl,
  verifyCompanionJob,
  type CompanionJobEnvelope,
} from "./index";

const envelope: CompanionJobEnvelope = {
  schemaVersion: 1,
  jobId: "00000000-0000-4000-8000-000000000001",
  workerId: "00000000-0000-4000-8000-000000000002",
  workspaceId: "00000000-0000-4000-8000-000000000003",
  action: "open_url",
  mode: "assisted",
  targetUrl: "https://example.com/test",
  expectedOrigin: "https://example.com",
  allowedDomains: ["example.com"],
  instructions: "Open the test page.",
  idempotencyKey: "companion-test-1",
  claimToken: "claim-token-that-is-long-enough-for-the-test",
  issuedAt: "2026-08-05T12:00:00.000Z",
  expiresAt: "2026-08-05T12:05:00.000Z",
};

describe("companion protocol", () => {
  it("creates normalized human-readable one-time pairing codes", () => {
    const code = createPairingCode();
    expect(code.displayCode).toMatch(/^MM-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    expect(normalizePairingCode(code.displayCode)).toBe(code.normalizedCode);
  });

  it("allows HTTPS and localhost development control planes only", () => {
    expect(validateCompanionServerUrl("https://market.example/ ".trim())).toBe("https://market.example");
    expect(validateCompanionServerUrl("http://localhost:3000/")).toBe("http://localhost:3000");
    expect(() => validateCompanionServerUrl("http://market.example")).toThrow(/HTTPS/);
  });

  it("enforces the exact job domain allowlist", () => {
    expect(validateCompanionTargetUrl(envelope.targetUrl, envelope.allowedDomains)).toBe(envelope.targetUrl);
    expect(() => validateCompanionTargetUrl("https://sub.example.com", ["example.com"])).toThrow(/allowlist/);
    expect(() => validateCompanionTargetUrl("https://example.com:8443", ["example.com"])).toThrow(/custom port/);
  });

  it("signs canonical job envelopes and rejects tampering or expiry", () => {
    const signature = signCompanionJob("worker-secret", envelope);
    expect(signature).toBe("ATE_Q9GU17cg96JWcgjfX9NiH-EOY39Lxwewoy3xvrY");
    expect(verifyCompanionJob("worker-secret", envelope, signature, new Date("2026-08-05T12:01:00Z"))).toBe(true);
    expect(verifyCompanionJob("worker-secret", { ...envelope, targetUrl: "https://evil.example" }, signature, new Date("2026-08-05T12:01:00Z"))).toBe(false);
    expect(verifyCompanionJob("worker-secret", envelope, signature, new Date("2026-08-05T12:06:00Z"))).toBe(false);
  });
});
