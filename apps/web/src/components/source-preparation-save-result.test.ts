import { describe, expect, it } from "vitest";
import { readSourcePreparationSaveResult } from "./source-preparation-save-result";
import { initialSourcePreparationBindingValues } from "./source-preparation-binding-request";
const scope = { workspaceId: "11111111-1111-4111-8111-111111111111", smartSourceId: "22222222-2222-4222-8222-222222222222" };
const binding = { ...initialSourcePreparationBindingValues(scope.workspaceId), ...scope,
  id: "33333333-3333-4333-8333-333333333333", revision: 1, updatedAt: "2026-10-01T00:00:00.000Z" };

describe("bounded source binding save confirmation", () => {
  it("accepts only a scoped saved binding", async () => {
    expect(await readSourcePreparationSaveResult(Response.json({ data: binding }), scope)).toEqual({ kind: "saved", binding });
    expect(await readSourcePreparationSaveResult(Response.json({ data: { ...binding, smartSourceId: binding.id } }), scope))
      .toMatchObject({ kind: "uncertain" });
  });
  it.each([401, 403, 409, 422])("keeps definitive HTTP %i denials separate from uncertain success", async status => {
    expect(await readSourcePreparationSaveResult(Response.json({ error: { message: "Review current settings." } }, { status }), scope))
      .toEqual({ kind: "rejected", message: "Review current settings." });
  });
  it.each([500, 503])("requires current-state reload after HTTP %i", async status => {
    expect(await readSourcePreparationSaveResult(Response.json({ error: { message: "Result unavailable." } }, { status }), scope))
      .toEqual({ kind: "uncertain", message: "Result unavailable." });
  });
  it("treats invalid, missing, mismatched and oversized confirmation as uncertain without trusting arbitrary messages", async () => {
    for (const response of [new Response("{"), Response.json({}), Response.json({ data: {} }), new Response(" ".repeat(65_537)),
      new Response(new Uint8Array([0xc3, 0x28])), new Response(null, { status: 503 })]) {
      expect(await readSourcePreparationSaveResult(response, scope)).toMatchObject({ kind: "uncertain" });
    }
  });
});
