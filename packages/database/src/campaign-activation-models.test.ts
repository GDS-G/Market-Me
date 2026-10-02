import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CAMPAIGN_ACTIVATION_LIMITS, CampaignActivationError, campaignActivationUuid, isCampaignActivationError, normalizeCampaignActivationRequest } from "./campaign-activation-models";

const valid = () => ({ workspaceId: randomUUID(), campaignId: randomUUID(), requestId: randomUUID(), expectedVersionId: randomUUID(), expectedActorIncarnationId: randomUUID() });
describe("durable activation intent", () => {
  it("normalizes exact UUIDs into frozen fixed-order bytes independent of input order", () => {
    const input = valid(), reverse = Object.fromEntries(Object.entries(input).reverse().map(([k,v]) => [k,v.toUpperCase()]));
    const result = normalizeCampaignActivationRequest(reverse);
    expect(result).toEqual(input); expect(JSON.stringify(result)).toBe(JSON.stringify(input)); expect(Object.isFrozen(result)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(CAMPAIGN_ACTIVATION_LIMITS.requestBytes);
    expect(Object.isFrozen(CAMPAIGN_ACTIVATION_LIMITS)).toBe(true);
  });
  it.each([null, undefined, true, [], "request", new Date(), Object.create(null)])("rejects nonordinary input %#", input => {
    expect(() => normalizeCampaignActivationRequest(input)).toThrow(CampaignActivationError);
  });
  it.each(["workspaceId", "campaignId", "requestId", "expectedVersionId", "expectedActorIncarnationId"])("requires exact %s", field => {
    const input: Record<string, unknown> = valid(); delete input[field];
    expect(() => normalizeCampaignActivationRequest(input)).toThrow(CampaignActivationError);
    for (const value of [null, 5, {}, [], "", "bad", ` ${randomUUID()}`, `${randomUUID()} `]) {
      expect(() => normalizeCampaignActivationRequest({ ...valid(), [field]: value })).toThrow(CampaignActivationError);
    }
  });
  it.each(["actorUserId", "role", "instanceId", "initialStatus", "approved"])("does not accept client authority %s", field => {
    expect(() => normalizeCampaignActivationRequest({ ...valid(), [field]: "forged" })).toThrow(CampaignActivationError);
  });
  it("rejects hidden, symbol and accessor fields without invoking getters", () => {
    let called = false; const input = valid();
    Object.defineProperty(input, "workspaceId", { enumerable: true, get() { called = true; throw new Error("never"); } });
    expect(() => normalizeCampaignActivationRequest(input)).toThrow(CampaignActivationError); expect(called).toBe(false);
    const hidden = valid(); Object.defineProperty(hidden, "requestId", { enumerable: false });
    expect(() => normalizeCampaignActivationRequest(hidden)).toThrow(CampaignActivationError);
    expect(() => normalizeCampaignActivationRequest({ ...valid(), [Symbol("hidden")]: true })).toThrow(CampaignActivationError);
  });
  it.each(["00000000-0000-0000-8000-000000000000", "00000000-0000-9000-8000-000000000000", "00000000-0000-4000-7000-000000000000"])("rejects nonstandard UUID %s", value => {
    expect(() => campaignActivationUuid(value)).toThrow(CampaignActivationError);
  });
  it("requires a real branded Error rather than a lookalike payload", () => {
    expect(isCampaignActivationError(new CampaignActivationError("request_conflict", "safe"))).toBe(true);
    expect(isCampaignActivationError(new Error("other"))).toBe(false);
    expect(isCampaignActivationError({ name: "CampaignActivationError", code: "request_conflict" })).toBe(false);
  });
});
