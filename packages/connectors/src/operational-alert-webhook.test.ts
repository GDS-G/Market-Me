import { describe, expect, it, vi } from "vitest";
import {
  deliverOperationalAlertWebhook,
  parseOperationalAlertAllowedHosts,
  signOperationalAlertWebhook,
  validateOperationalAlertEndpoint,
  verifyOperationalAlertWebhookSignature,
} from "./operational-alert-webhook";

const input = {
  endpointUrl: "https://alerts.example.test/market-me",
  signingSecret: "a-secret-value-that-is-long-enough-for-tests",
  eventId: "event-1",
  occurredAt: "2026-08-11T12:00:00.000Z",
  payload: { eventType: "incident_opened", version: "1" },
};

describe("operational alert webhook", () => {
  it("parses and deduplicates the deployment host allowlist", () => {
    expect(parseOperationalAlertAllowedHosts(" Alerts.Example.test,alerts.example.test, secondary.test "))
      .toEqual(["alerts.example.test", "secondary.test"]);
  });

  it("requires an exact allowlisted HTTPS host and rejects URL smuggling surfaces", () => {
    expect(validateOperationalAlertEndpoint(input.endpointUrl, ["alerts.example.test"]).href)
      .toBe(input.endpointUrl);
    for (const endpointUrl of [
      "http://alerts.example.test/hook",
      "https://user:pass@alerts.example.test/hook",
      "https://alerts.example.test:8443/hook",
      "https://alerts.example.test/hook?next=internal",
      "https://sub.alerts.example.test/hook",
    ]) expect(() => validateOperationalAlertEndpoint(endpointUrl, ["alerts.example.test"])).toThrow();
  });

  it("creates and verifies the versioned canonical signature", () => {
    const body = JSON.stringify(input.payload);
    const signature = `v1=${signOperationalAlertWebhook(body, input.occurredAt, input.signingSecret)}`;
    expect(verifyOperationalAlertWebhookSignature(body, input.occurredAt, signature, input.signingSecret)).toBe(true);
    expect(verifyOperationalAlertWebhookSignature(`${body} `, input.occurredAt, signature, input.signingSecret)).toBe(false);
  });

  it("sends fixed signed headers and never follows redirects", async () => {
    const fetchImpl = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("manual");
      expect(init?.cache).toBe("no-store");
      const headers = init?.headers as Record<string, string>;
      expect(headers["idempotency-key"]).toBe(input.eventId);
      expect(headers["x-market-me-signature"]).toMatch(/^v1=[0-9a-f]{64}$/);
      return new Response(null, { status: 204 });
    });
    await expect(deliverOperationalAlertWebhook(input, {
      allowedHosts: ["alerts.example.test"], fetchImpl: fetchImpl as typeof fetch,
    })).resolves.toEqual({ status: "delivered", responseStatus: 204 });
  });

  it("classifies permanent, retryable, redirect, and ambiguous failures safely", async () => {
    const call = (fetchImpl: typeof fetch) => deliverOperationalAlertWebhook(input, {
      allowedHosts: ["alerts.example.test"], fetchImpl,
    });
    await expect(call(vi.fn(async () => new Response(null, { status: 400 }))))
      .resolves.toMatchObject({ status: "failed", retryable: false, responseStatus: 400 });
    await expect(call(vi.fn(async () => new Response(null, { status: 503 }))))
      .resolves.toMatchObject({ status: "failed", retryable: true, responseStatus: 503 });
    await expect(call(vi.fn(async () => new Response(null, { status: 302 }))))
      .resolves.toMatchObject({ status: "failed", retryable: false, responseStatus: 302 });
    await expect(call(vi.fn(async () => { throw new TypeError("private detail"); })))
      .resolves.toEqual({ status: "failed", retryable: true,
        safeError: "Webhook delivery could not be confirmed." });
  });
});
