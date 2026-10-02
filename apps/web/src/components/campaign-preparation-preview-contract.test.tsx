import { createHash } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignPreparationPreview } from "./campaign-preparation-preview";
import { parsePreparationPreview, preparationPreviewBody, preparationPreviewDigest, readPreparationPreviewResponse, requestPreparationPreview, PREPARATION_PREVIEW_BROWSER_LIMITS, type PreparationPreview } from "./campaign-preparation-preview-contract";
import { previewTestData, previewTestFingerprint as fingerprint, previewTestInput as input } from "./campaign-preparation-preview.test-fixture";
import { reviewTestUuid as uuid } from "./content-package-review.test-fixture";

const body = preparationPreviewBody(input, fingerprint), digest = createHash("sha256").update(body).digest("hex");
const envelope = (data = previewTestData()) => ({ data, meta: { requestDigest: digest } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("read-only preparation preview browser contract", () => {
  it("binds exact request bytes and preserves the complete verified preview", async () => {
    expect(await preparationPreviewDigest(body)).toBe(digest);
    expect(JSON.parse(body)).toEqual({ input, expectedReviewFingerprint: fingerprint });
    expect(parsePreparationPreview(envelope(), input, fingerprint, digest)).toEqual(previewTestData());
    expect(body).not.toContain("idempotencyKey");
  });
  it.each([
    ["workspace", (d: PreparationPreview) => { d.workspaceId = uuid(4); }],
    ["package", (d: PreparationPreview) => { d.contentPackage.id = uuid(4); }],
    ["revision", (d: PreparationPreview) => { d.contentPackage.version = 3; }],
    ["approval", (d: PreparationPreview) => { d.contentPackage.reviewFingerprint = `mm-package-review-v1:sha256:${"b".repeat(64)}`; }],
    ["name", (d: PreparationPreview) => { d.configuration.name = "Different name"; }],
    ["description", (d: PreparationPreview) => { d.configuration.description = "Different copy"; }],
    ["timezone", (d: PreparationPreview) => { d.configuration.timezone = "America/Chicago"; }],
    ["depth", (d: PreparationPreview) => { d.configuration.informationDepth = "minimal"; }],
    ["promotion", (d: PreparationPreview) => { d.configuration.promotionalStrength = "strong"; }],
    ["brand", (d: PreparationPreview) => { d.brand = { versionId: uuid(4), name: "Unexpected", versionNumber: 1 }; }],
    ["destination", (d: PreparationPreview) => { d.destination = { id: uuid(4), title: "Unexpected" }; }],
    ["variant position", (d: PreparationPreview) => { d.variants[0]!.position = 1; }],
    ["evidence text", (d: PreparationPreview) => { d.evidence[0]!.claim = "Contradiction"; }],
    ["evidence identity", (d: PreparationPreview) => { d.evidence[0]!.id = uuid(4); }],
    ["duplicate evidence", (d: PreparationPreview) => { d.evidence.push(d.evidence[0]!); }],
  ] as const)("rejects a mixed or stale %s response", (_label, mutate) => {
    const data = previewTestData(); mutate(data); expect(() => parsePreparationPreview(envelope(data), input, fingerprint, digest)).toThrow();
  });
  it("rejects a different digest, extra authority and effects that imply persistence", () => {
    expect(() => parsePreparationPreview(envelope(), input, fingerprint, "b".repeat(64))).toThrow();
    for (const value of [{ ...envelope(), idempotencyKey: uuid(4) }, { ...envelope(), data: { ...previewTestData(), approved: true } },
      { ...envelope(), data: { ...previewTestData(), effects: { ...previewTestData().effects, persisted: true } } }])
      expect(() => parsePreparationPreview(value, input, fingerprint, digest)).toThrow();
  });
  it("accepts compiler-normalized display text and explicit optional references", () => {
    const raw = { ...input, name: "  Cafe\u0301  announcement\n today ", description: "  Text\r\nnext  ", timezone: " UTC ",
      workspaceId: input.workspaceId.toUpperCase(), brandProfileVersionId: uuid(4).toUpperCase(), destinationId: uuid(5) };
    const data = previewTestData(); data.configuration = { ...input, name: "Café announcement today", description: "Text\nnext", brandProfileVersionId: uuid(4), destinationId: uuid(5) };
    data.brand = { versionId: uuid(4), name: "Brand", versionNumber: 1 }; data.destination = { id: uuid(5), title: "Destination" };
    expect(parsePreparationPreview(envelope(data), raw, fingerprint, digest)).toEqual(data);
  });
  it("preserves selected audience order and refuses swaps, missing variants and misleading CTA citations", () => {
    const raw = { ...input, audienceProfileVersionIds: [uuid(5), uuid(4)] }, data = previewTestData();
    data.configuration.audienceProfileVersionIds = raw.audienceProfileVersionIds;
    data.variants = raw.audienceProfileVersionIds.map((versionId, position) => ({ ...structuredClone(data.variants[0]!), position,
      audience: { kind: "audience", versionId, name: `Audience ${position}`, versionNumber: 1 } }));
    expect(parsePreparationPreview(envelope(data), raw, fingerprint, digest).variants).toEqual(data.variants);
    const swapped = structuredClone(data); swapped.variants.reverse(); expect(() => parsePreparationPreview(envelope(swapped), raw, fingerprint, digest)).toThrow();
    const missing = structuredClone(data); missing.variants.pop(); expect(() => parsePreparationPreview(envelope(missing), raw, fingerprint, digest)).toThrow();
    data.variants[0]!.draft.claims.push({ kind: "call_to_action", text: "Explore", evidenceItemIds: [uuid(6)] });
    expect(() => parsePreparationPreview(envelope(data), raw, fingerprint, digest)).toThrow();
  });
  it("bounds requests by UTF-8 bytes without truncation", () => {
    expect(() => preparationPreviewBody({ ...input, description: "🚀".repeat(9000) }, fingerprint)).toThrow();
    expect(() => preparationPreviewBody(input, "unapproved")).toThrow();
  });
  it("bounds streamed JSON bytes, validates content type and requires intact UTF-8", async () => {
    expect(await readPreparationPreviewResponse(Response.json(envelope()))).toEqual(envelope());
    const headers = { "content-type": "application/json" };
    for (const response of [new Response("{}"), new Response("{}", { headers: { ...headers, "content-length": "1048577" } }),
      new Response(" ".repeat(1048577), { headers }), new Response(new Uint8Array([0xc3, 0x28]), { headers }), new Response("{", { headers })])
      await expect(readPreparationPreviewResponse(response)).rejects.toThrow();
  });
  it("sends once without an attempt or redirect and never retries failures", async () => {
    const send = vi.fn().mockResolvedValue(Response.json(envelope())); vi.stubGlobal("fetch", send);
    const controller = new AbortController(); expect(await requestPreparationPreview(input, fingerprint, controller)).toEqual(previewTestData());
    expect(send).toHaveBeenCalledExactlyOnceWith("/api/v1/campaign-preparations/preview", { method: "POST", headers: { "content-type": "application/json" }, body, cache: "no-store", credentials: "same-origin", redirect: "error", signal: controller.signal });
    send.mockClear().mockResolvedValue(Response.json({ error: { message: "private failure" } }, { status: 503 }));
    await expect(requestPreparationPreview(input, fingerprint, new AbortController())).rejects.toThrow("Preview is unavailable");
    expect(send).toHaveBeenCalledOnce();
  });
  it("aborts a timed-out request and clears its timer", async () => {
    vi.useFakeTimers(); const controller = new AbortController(), send = vi.fn().mockReturnValue(new Promise(() => {})); vi.stubGlobal("fetch", send);
    const result = requestPreparationPreview(input, fingerprint, controller).catch(error => error);
    await vi.advanceTimersByTimeAsync(PREPARATION_PREVIEW_BROWSER_LIMITS.timeoutMs);
    expect(await result).toMatchObject({ message: "Preview timed out." }); expect(controller.signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
    expect(send.mock.calls.length).toBeLessThanOrEqual(1);
  });
  it("does not send an already canceled request", async () => {
    const send = vi.fn(); vi.stubGlobal("fetch", send); const controller = new AbortController(); controller.abort();
    await expect(requestPreparationPreview(input, fingerprint, controller)).rejects.toThrow("canceled"); expect(send).not.toHaveBeenCalled();
  });
  it("renders escaped grounded copy and citations without publishing links or hidden effects", () => {
    const data = previewTestData(); data.variants[0]!.draft.headline = "<script>never execute</script>"; data.evidence[0]!.sourceReferences = ["javascript:alert(1)"];
    const html = renderToStaticMarkup(createElement(CampaignPreparationPreview, { preview: data }));
    for (const text of ["Unsaved campaign and draft preview", "Nothing was saved", "manual review step", "General audience", "Evidence behind this draft", "not independent verification", fingerprint, "&lt;script&gt;never execute&lt;/script&gt;"]) expect(html).toContain(text);
    expect(html).not.toContain("<script>"); expect(html).not.toContain("<a "); expect(html).not.toContain("<button");
  });
});
